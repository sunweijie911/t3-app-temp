import { getFeishuBotOpenId } from '../auth/feishu-bot';
import { getFeishuChatName } from '../auth/feishu-chat';
import { feishuTokenManager } from '../auth/feishu-token';
import { getFeishuUserName } from '../auth/feishu-user';
import { clampReplyBytes } from '../core/field-render';
import type { ChatType, UnifiedMessage } from '../core/types';
import { getFeishuCredentials } from '../services/credentials';
import {
  decryptFeishuEvent,
  eventSignature,
  verifyEventSignature,
} from './feishu-crypto';
import { isTimestampFresh, timestampFreshness } from './replay-window';
import type { ChannelAdapter, DecodeResult } from './types';

/**
 * 陈旧回调按 `ignored`（→ HTTP 200）处理，而**不是** 403。
 *
 * 安全性完全一样：这条事件不会被处理。区别只在给平台的答复 ——
 * 飞书把非 2xx 当投递失败会不断重试，**连续失败还会自动摘掉事件订阅**
 * （bot-engine 里"停用平台也回 200"就是为了这个）。而"太旧了"恰恰是
 * 重试永远修不好的一类失败：服务器时钟一旦漂移超过窗口，每一条事件都会
 * 403，正好凑成"连续失败"，代价从"丢几条消息"升级成"订阅没了、要人工
 * 去开放平台重配"。
 *
 * 但必须留日志：`ignored` 在 bot-engine 里只回 200、不落审计日志，
 * 不打这行的话现象就是"机器人不吭声，哪儿都查不出原因"。
 */
function staleIgnored(reason: string): DecodeResult {
  console.warn(
    `[FeishuChannel] 丢弃陈旧回调（疑似重放，或服务器时钟漂移）: ${reason}`,
  );
  return { kind: 'ignored', reason };
}

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly platform = 'feishu' as const;
  /** 飞书文本消息 content 上限约 30KB，取整留余量 */
  readonly maxReplyBytes = 30_000;

  async decode(req: Request): Promise<DecodeResult> {
    // 必须拿**请求体原文**：X-Lark-Signature 覆盖的是原始字节，
    // 先 req.json() 再 stringify 回去得到的串与原文不一定一致
    // （键序、空白、Unicode 转义都可能变），签名会恒不通过。
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return { kind: 'reject', status: 400, reason: '读取请求体失败' };
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { kind: 'reject', status: 400, reason: '请求体不是合法 JSON' };
    }

    const creds = await getFeishuCredentials();

    // 0. 验签 + 时间戳窗口。
    //
    // 开启事件加密后飞书会带 X-Lark-Signature / -Request-Timestamp /
    // -Request-Nonce 三个头。以前这里**一个头都不读**：飞书是三家里唯一
    // 既没有验签、也没有时间戳窗口的 —— 抓到的回调只要过了 5 分钟幂等
    // TTL 就能原样重放，一条 CREATE 重放一次多写一条记录
    // （钉钉/企微都用 replay-window 挡住了这段区间）。
    //
    // 做在解密**之前**：签名覆盖的是密文原文，先验签能让伪造的请求连
    // 解密都不用跑。
    const signature = req.headers.get('x-lark-signature');
    const sigTimestamp = req.headers.get('x-lark-request-timestamp');
    const nonce = req.headers.get('x-lark-request-nonce');
    /**
     * 是否**必须**验签。
     *
     * 判据只能是「本地配了 encryptKey」，绝不能是「请求带了签名头」——
     * 后者由**攻击者**说了算：少发一个 X-Lark-Request-Nonce 就整个绕过
     * 这一段，落回只查静态 verification_token 的老路，验签等于白加。
     *
     * 用配置当判据是安全的：飞书「配了 Encrypt Key 就必带这三个头」，
     * 所以没开加密的存量部署 mustVerify 为 false，行为与升级前一致。
     */
    const mustVerify = Boolean(creds.encryptKey);
    let signatureVerified = false;

    if (signature && sigTimestamp && nonce) {
      if (!creds.encryptKey) {
        console.warn(
          '[FeishuChannel] 收到带签名的请求但未配置 encryptKey，无法验签',
        );
        return {
          kind: 'reject',
          status: 403,
          reason: '未配置 encryptKey，无法验签',
        };
      }
      const expected = eventSignature(
        sigTimestamp,
        nonce,
        creds.encryptKey,
        rawBody,
      );
      if (!verifyEventSignature(expected, signature)) {
        return { kind: 'reject', status: 403, reason: '验签失败' };
      }
      // 这个头是**秒**，而 header.create_time 是毫秒；单位由 timestampToMs
      // 按数量级判别，不在调用方各乘一次 1000（猜错单位的表现是
      // 「整个平台永久拒收」，不是报错）
      if (!isTimestampFresh(sigTimestamp)) {
        return staleIgnored('签名时间戳超出容忍窗口');
      }
      signatureVerified = true;
    }

    // 1. 解密（开启了事件加密时）
    if (typeof body.encrypt === 'string') {
      if (!creds.encryptKey) {
        console.warn('[FeishuChannel] 收到加密事件但未配置 encryptKey');
        return { kind: 'reject', status: 403, reason: '未配置 encryptKey' };
      }
      try {
        const decrypted = decryptFeishuEvent(body.encrypt, creds.encryptKey);
        body = JSON.parse(decrypted) as Record<string, unknown>;
      } catch (err) {
        console.error(
          '[FeishuChannel] 解密事件失败，可能是 encryptKey 配置错误:',
          err,
        );
        return { kind: 'reject', status: 403, reason: '解密失败' };
      }
    }

    // 2. URL challenge
    if (typeof body.challenge === 'string') {
      return {
        kind: 'respond',
        response: Response.json({ challenge: body.challenge }),
      };
    }

    // 2.5 配了 encryptKey 却没能验签 —— 缺头、或头不齐。
    //
    // 放在 challenge **之后**：URL 有效性验证只是把 challenge 原样回写，
    // 没有任何数据访问和副作用，不该被这道闸挡住配置流程（万一某类
    // 验证请求不带签名头，管理员会卡在"回调地址配不上"且毫无头绪）。
    // 到这里还没验成签的，就是一条要真正执行业务的事件了。
    if (mustVerify && !signatureVerified) {
      console.warn(
        '[FeishuChannel] 已配置 encryptKey，但请求缺少完整的签名头，拒绝',
      );
      return { kind: 'reject', status: 403, reason: '缺少签名头，无法验签' };
    }

    // 3. verification_token 必须配置（DB 或 env），否则拒绝以避免 webhook 裸奔
    if (!creds.verificationToken) {
      console.warn(
        '[FeishuChannel] 拒绝请求：未配置 verificationToken，webhook 不能裸奔',
      );
      return {
        kind: 'reject',
        status: 403,
        reason: '未配置 verificationToken',
      };
    }
    const header = body.header as Record<string, unknown> | undefined;
    const token = header?.token as string | undefined;
    if (!token || token !== creds.verificationToken) {
      return { kind: 'reject', status: 403, reason: 'token 校验失败' };
    }

    // 4. 事件新鲜度。
    //
    // 只在**没验过签**时做：验过签的请求已经用签名头的时间戳查过窗口了，
    // 再拿另一个时钟的字段查一遍只会平白多一种拒收原因。
    //
    // 没有签名头时这是唯一的重放防护 —— verification_token 是个静态
    // 密钥，body 原样重放照样通过。header.create_time 是**毫秒**字符串。
    //
    // 用三态判定而不是布尔：`unknown`（字段缺失或形状变了）必须**放行**。
    // 这个字段不是协议要求我们校验的东西，因为它变形就把整个飞书通道
    // 关掉，代价远大于收益。
    if (
      !signatureVerified &&
      timestampFreshness(header?.create_time) === 'stale'
    ) {
      return staleIgnored('事件时间戳超出容忍窗口');
    }

    // 5. 解析为统一消息
    return this.parseEvent(body);
  }

  private async parseEvent(
    body: Record<string, unknown>,
  ): Promise<DecodeResult> {
    const header = body.header as Record<string, unknown> | undefined;
    const event = body.event as Record<string, unknown> | undefined;
    if (!header || !event)
      return { kind: 'ignored', reason: '缺少 header/event' };

    if (header.event_type !== 'im.message.receive_v1') {
      return {
        kind: 'ignored',
        reason: `事件类型 ${String(header.event_type)}`,
      };
    }

    const message = event.message as Record<string, unknown> | undefined;
    const sender = event.sender as Record<string, unknown> | undefined;
    if (!message || !sender) {
      return { kind: 'ignored', reason: '缺少 message/sender' };
    }
    if (message.message_type !== 'text') {
      return { kind: 'ignored', reason: '非文本消息' };
    }

    // 机器人自己发的消息不处理，否则会与自己的回复形成回环
    if (sender.sender_type !== 'user') {
      return { kind: 'ignored', reason: '非用户发送' };
    }

    const chatType: ChatType = message.chat_type === 'p2p' ? 'p2p' : 'group';

    const mentions = message.mentions as
      | Array<{ key: string; id?: { open_id?: string } }>
      | undefined;
    // 群聊要求 @机器人；单聊天然是对机器人说话，不该要求 @
    // （以前无条件要求 mentions 非空，导致所有私聊消息被静默丢弃）
    if (chatType === 'group' && (!mentions || mentions.length === 0)) {
      return { kind: 'ignored', reason: '群聊未 @机器人' };
    }

    let content = '';
    try {
      const parsed = JSON.parse(message.content as string) as { text?: string };
      content = parsed.text ?? '';
    } catch (err) {
      console.warn(
        '[FeishuChannel] message.content 解析失败, raw:',
        String(message.content).slice(0, 200),
        err,
      );
      return { kind: 'ignored', reason: 'content 解析失败' };
    }

    content = content.replace(/@_user_\d+/g, '').trim();
    if (!content) return { kind: 'ignored', reason: '@ 之后内容为空' };

    const senderInfo = sender.sender_id as Record<string, string> | undefined;
    const senderId = senderInfo?.open_id ?? senderInfo?.user_id ?? '';
    const chatId = message.chat_id as string;

    // 到这里为止**零网络调用**：用户名、群名、以及「@ 的是不是我」的判定
    // 全部挪到 enrich()（ack 之后）。它们各自 3s 超时、冷启动还要先换
    // token（10s 超时），留在 ack 之前会让首条消息几乎必然触发飞书重试。
    // senderName 先用 senderId 占位，enrich 里再替换成真名。
    return {
      kind: 'ok',
      message: {
        platform: 'feishu',
        eventId: header.event_id as string,
        messageId: message.message_id as string,
        chatId,
        chatType,
        senderId,
        senderName: senderId,
        content,
        timestamp: Number(header.create_time) || Date.now(),
        raw: body,
      },
    };
  }

  /**
   * ack 之后补齐用户名 / 群名，并完成需要网络往返的 @ 判定。
   */
  async enrich(msg: UnifiedMessage): Promise<UnifiedMessage | null> {
    const body = msg.raw as Record<string, unknown> | undefined;
    const event = body?.event as Record<string, unknown> | undefined;
    const message = event?.message as Record<string, unknown> | undefined;
    const mentions = message?.mentions as
      | Array<{ key: string; id?: { open_id?: string } }>
      | undefined;
    const isGroup = msg.chatType === 'group';

    // 三个查询一起发。各自都有独立缓存、3s 超时、失败各自降级，但**串行**
    // 起来会叠成 9s+。机器人自身 open_id 只有群聊的 @ 判定要用，单聊不查。
    const [botOpenId, senderName, chatName] = await Promise.all([
      isGroup ? getFeishuBotOpenId() : Promise.resolve(null),
      msg.senderId ? getFeishuUserName(msg.senderId) : Promise.resolve(null),
      isGroup ? getFeishuChatName(msg.chatId) : Promise.resolve(null),
    ]);

    // mentions 里是**所有**被 @ 的人。标准权限下平台只推送 @机器人 的消息，
    // 但开通"接收群里所有消息"后，只判断非空会让机器人去应答
    // 「@张三 帮我看下」这类跟它无关的消息。
    // 拿不到自身 open_id 时 fail-open（退回旧行为）—— 见 auth/feishu-bot.ts
    if (
      isGroup &&
      botOpenId &&
      !mentions?.some((m) => m.id?.open_id === botOpenId)
    ) {
      console.log('[FeishuChannel] 群聊 @ 的不是机器人，忽略');
      return null;
    }

    return {
      ...msg,
      senderName: senderName ?? msg.senderId,
      chatName: chatName ?? undefined,
    };
  }

  async reply(msg: UnifiedMessage, rawContent: string): Promise<void> {
    const content = clampReplyBytes(rawContent, this.maxReplyBytes);
    const token = await feishuTokenManager.getToken();
    try {
      const res = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: msg.chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: content }),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        console.error(
          '[FeishuChannel] 回复 HTTP 失败:',
          res.status,
          res.statusText,
        );
        return;
      }
      const data = (await res.json()) as { code: number; msg?: string };
      if (data.code !== 0) {
        console.error(
          '[FeishuChannel] 回复业务失败: code=',
          data.code,
          data.msg,
          '文本长度=',
          content.length,
        );
      }
    } catch (err) {
      console.error('[FeishuChannel] 回复失败:', err);
    }
  }
}
