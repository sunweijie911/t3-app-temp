import { clampReplyBytes } from '../core/field-render';
import type { ChatType, UnifiedMessage } from '../core/types';
import { getWecomCredentials } from '../services/credentials';
import { stripLeadingMention } from './mention';
import { isTimestampFresh } from './replay-window';
import type { ChannelAdapter, DecodeResult } from './types';
import {
  callbackSignature,
  decryptMessage,
  readXmlField,
  verifySignature,
} from './wecom-crypto';

/**
 * 企微回复上下文。
 *
 * 企微智能机器人的回调体里带一个**一次性**的 `response_url`（官方文档
 * path/101138「主动回复」），回复要 POST 到它，而不是像飞书那样用 token
 * 主动往会话发消息。所以 decode 必须把它塞进 `UnifiedMessage.raw`
 * —— 这正是上一轮给 UnifiedMessage 加 raw 的原因。
 *
 * 该 URL 有效期 1 小时且**只能调用一次**，第二次调用会被平台拒绝，
 * 见 WecomChannelAdapter.reply 里的单次保护。
 */
export interface WecomReplyContext {
  responseUrl: string;
  chatId: string;
  chatType: ChatType;
}

/**
 * response_url 允许的域。
 *
 * 企微这边的风险比钉钉小 —— 密文经 AES 加密、签名覆盖密文，伪造 body
 * 需要 encodingAesKey。但纵深防御的成本是零，而一旦这个 URL 被换掉，
 * 泄漏出去的是整张表的查询结果。与钉钉侧保持同一道关。
 */
const WECOM_WEBHOOK_HOSTS = ['qyapi.weixin.qq.com'];

export function isWecomWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return WECOM_WEBHOOK_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export function readWecomReplyContext(raw: unknown): WecomReplyContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // 官方回调字段是 response_url；webhook_url 是本模块早期按群机器人协议
  // 猜的字段名。这个回落分支**只覆盖发版瞬间已经序列化在 PendingAction
  // 里的存量 raw** —— 那些消息是用旧代码解出来的，等它们的确认超时
  // （分钟级）之后就再也不会命中。新解码的回调一律只带 response_url。
  const url =
    typeof o.response_url === 'string' ? o.response_url : o.webhook_url;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!isWecomWebhookHost(host)) {
    console.error(
      '[WecomChannel] 拒绝非企微域的 response_url，疑似伪造回调, host=',
      host,
    );
    return null;
  }
  return {
    responseUrl: url,
    chatId: typeof o.chatid === 'string' ? o.chatid : '',
    chatType: o.chattype === 'single' ? 'p2p' : 'group',
  };
}

/**
 * 企微智能机器人回调的明文结构（解密后是 JSON，不是 XML）。
 * 字段名对齐官方文档 path/100719「接收消息」。
 */
interface WecomBotPayload {
  msgid?: string;
  /** 智能机器人 ID，官方回调必带；本模块不用，列出来是为了说明协议全貌 */
  aibotid?: string;
  chatid?: string;
  chattype?: string;
  from?: { userid?: string; name?: string };
  msgtype?: string;
  text?: { content?: string };
  response_url?: string;
  /** @deprecated 早期按群机器人协议猜的字段名，仅兼容存量 raw */
  webhook_url?: string;
}

/**
 * 已**成功回复过**的 messageId。
 *
 * response_url **只能调用一次**：第二次 POST 平台直接拒绝，而调用方
 * （dispatcher 的兜底 catch）看到的只是又一次失败，用户什么都收不到。
 * 与其让第二次调用去消耗一个已作废的 URL，不如在这里挡住并留日志 ——
 * 一旦日志里出现这行，说明上游有一条消息回了两次，那是要修的真问题。
 *
 * 记录的时机是**发送成功之后**（HTTP ok 且 errcode 为 0），不是发送之前。
 * 提前记的话，一次网络超时 / 5xx 就把这条消息永久标成"回过了"，之后任何
 * 重试都被这道闸挡掉 —— 用户从"这次回复失败"变成"永远收不到回复"。
 * 那次失败里 response_url 并没有被平台消费掉，本来就该允许再试一次。
 *
 * 用 Set + FIFO 淘汰，容量取够一个实例的短窗口即可（response_url
 * 本身只活 1 小时，超出容量的条目早就没有重放价值了）。
 */
const REPLIED_MAX = 500;
const repliedMessageIds = new Set<string>();

function markReplied(messageId: string): void {
  repliedMessageIds.add(messageId);
  if (repliedMessageIds.size > REPLIED_MAX) {
    const oldest = repliedMessageIds.values().next().value;
    if (oldest !== undefined) repliedMessageIds.delete(oldest);
  }
}

/** 仅供单测隔离用例之间的状态 */
export function __resetWecomReplyGuard(): void {
  repliedMessageIds.clear();
}

export class WecomChannelAdapter implements ChannelAdapter {
  readonly platform = 'wecom' as const;
  /**
   * 企微智能机器人 markdown.content 上限 **20480 字节**（官方文档
   * path/101138）。以前按群机器人 text 的 2048 字节裁，等于把 90% 的
   * 预算白扔了 —— 一条 10 行的查询结果会被截成半截。
   */
  readonly maxReplyBytes = 20_480;

  /**
   * URL 有效性验证（GET）：query 带 msg_signature/timestamp/nonce/echostr，
   * 验签后把 echostr 解密，**原样回写明文**（不是 JSON，不带引号）。
   */
  async verifyUrl(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const sig = url.searchParams.get('msg_signature');
    const timestamp = url.searchParams.get('timestamp');
    const nonce = url.searchParams.get('nonce');
    const echostr = url.searchParams.get('echostr');
    if (!sig || !timestamp || !nonce || !echostr) {
      return new Response('missing verification params', { status: 400 });
    }

    const { botToken, encodingAesKey } = await getWecomCredentials();
    if (!botToken || !encodingAesKey) {
      console.warn('[WecomChannel] 未配置 botToken / encodingAesKey');
      return new Response('wecom credentials not configured', { status: 403 });
    }

    if (
      !verifySignature(
        callbackSignature(botToken, timestamp, nonce, echostr),
        sig,
      )
    ) {
      console.warn('[WecomChannel] URL 验证签名不匹配');
      return new Response('invalid signature', { status: 403 });
    }

    try {
      const { payload } = decryptMessage(echostr, encodingAesKey);
      // 企微要求返回解密后的明文本身，Content-Type 用 text/plain
      return new Response(payload, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch (err) {
      console.error('[WecomChannel] echostr 解密失败:', err);
      return new Response('decrypt failed', { status: 403 });
    }
  }

  async decode(req: Request): Promise<DecodeResult> {
    const url = new URL(req.url);
    const sig = url.searchParams.get('msg_signature');
    const timestamp = url.searchParams.get('timestamp');
    const nonce = url.searchParams.get('nonce');
    if (!sig || !timestamp || !nonce) {
      return { kind: 'reject', status: 400, reason: '缺少验签参数' };
    }

    // 企微回调体是 XML，不能预设 JSON —— 这是 decode(req) 取代
    // verify(req, body) 两段式的直接原因
    let xml: string;
    try {
      xml = await req.text();
    } catch {
      return { kind: 'reject', status: 400, reason: '读取请求体失败' };
    }

    const encrypt = readXmlField(xml, 'Encrypt');
    if (!encrypt) {
      return { kind: 'reject', status: 400, reason: 'XML 中缺少 Encrypt 字段' };
    }

    const { botToken, encodingAesKey, corpId } = await getWecomCredentials();
    if (!botToken || !encodingAesKey) {
      console.warn(
        '[WecomChannel] 拒绝请求：未配置 botToken / encodingAesKey，webhook 不能裸奔',
      );
      return { kind: 'reject', status: 403, reason: '企微凭证未配置' };
    }

    if (
      !verifySignature(
        callbackSignature(botToken, timestamp, nonce, encrypt),
        sig,
      )
    ) {
      return { kind: 'reject', status: 403, reason: '验签失败' };
    }

    // 时间戳窗口：企微回调无 eventId 幂等，先挡掉明显的重放。
    //
    // 窗口常量与钉钉/飞书共用 replay-window（必须始终等于幂等 TTL，
    // 理由见那个文件）。这里以前是本地的一个 `5 * 60 * 1000` 字面量 ——
    // 值虽然碰巧相同，但 DEDUP_TTL_MS 一被调整，三家里就只有企微会
    // 悄悄失配，重新开出那段「验签通过、幂等已过期」的重放区间。
    // 单位换算也交给 timestampToMs：企微这个 query 参数是**秒**。
    if (!isTimestampFresh(timestamp)) {
      return { kind: 'reject', status: 403, reason: '时间戳超出容忍窗口' };
    }

    let payload: string;
    let receiveId: string;
    try {
      const dec = decryptMessage(encrypt, encodingAesKey);
      payload = dec.payload;
      receiveId = dec.receiveId;
    } catch (err) {
      console.error('[WecomChannel] 解密失败:', err);
      return { kind: 'reject', status: 403, reason: '解密失败' };
    }

    // receiveId 必须是本企业的 corpId，防止别的企业的回调被当成自己的
    if (corpId && receiveId && receiveId !== corpId) {
      console.warn('[WecomChannel] receiveId 与 corpId 不匹配，拒绝');
      return { kind: 'reject', status: 403, reason: 'receiveId 不匹配' };
    }

    return this.parsePayload(payload, timestamp);
  }

  private parsePayload(payload: string, timestamp: string): DecodeResult {
    let body: WecomBotPayload;
    try {
      body = JSON.parse(payload) as WecomBotPayload;
    } catch {
      // 自建应用（非智能机器人）的回调明文是 XML。这类回调没有
      // response_url，回复要走 message/send，本 adapter 暂不支持。
      const msgType = readXmlField(payload, 'MsgType');
      return {
        kind: 'ignored',
        reason: `明文为 XML 格式（自建应用回调, MsgType=${msgType ?? '未知'}），当前只支持智能机器人回调`,
      };
    }

    if (body.msgtype !== 'text') {
      return {
        kind: 'ignored',
        reason: `非文本消息 (${String(body.msgtype)})`,
      };
    }

    const senderId = body.from?.userid;
    if (!senderId) return { kind: 'ignored', reason: '缺少发送者 userid' };

    const msgId = body.msgid;
    if (!msgId) return { kind: 'ignored', reason: '缺少 msgid' };

    const chatType: ChatType = body.chattype === 'single' ? 'p2p' : 'group';

    // 群聊剥掉开头的 "@机器人昵称"。飞书剥 `@_user_N` 占位符、钉钉剥
    // `@昵称`，唯独企微以前是原样透传 —— 带 @ 的正文会进 LLM，也会原样
    // 落进审计日志。正文不以 @ 开头时该函数原样返回，所以即便企微某些
    // 场景下本来就不带前缀，这一步也是无害的。
    let content = (body.text?.content ?? '').trim();
    if (chatType === 'group') content = stripLeadingMention(content);
    if (!content) return { kind: 'ignored', reason: '正文为空' };

    return {
      kind: 'ok',
      message: {
        platform: 'wecom',
        // 企微没有独立的 eventId，用 msgid 做幂等键
        eventId: msgId,
        messageId: msgId,
        // 单聊没有 chatid，用发送者 userid 兜底，保证 PendingAction 的键稳定
        chatId: body.chatid || `p2p:${senderId}`,
        chatType,
        senderId,
        senderName: body.from?.name || senderId,
        content,
        timestamp: Number(timestamp) * 1000 || Date.now(),
        raw: body,
      },
    };
  }

  async reply(msg: UnifiedMessage, rawContent: string): Promise<void> {
    const content = clampReplyBytes(rawContent, this.maxReplyBytes);
    const ctx = readWecomReplyContext(msg.raw);
    if (!ctx) {
      // 拿不到 response_url 说明这条消息不是智能机器人回调，或 raw 在
      // 跨实例传递中丢了字段。不静默失败，日志里说清原因。
      console.error(
        '[WecomChannel] 回复失败：raw 中没有可用的 response_url，msgId=',
        msg.messageId,
      );
      return;
    }

    // response_url 单次有效：同一条消息的第二次回复必然失败，挡在这里
    // 至少能留下"上游回了两次"的证据，而不是让用户以为回复丢了
    if (repliedMessageIds.has(msg.messageId)) {
      console.warn(
        '[WecomChannel] 跳过重复回复：response_url 只能调用一次，msgId=',
        msg.messageId,
      );
      return;
    }

    try {
      const res = await fetch(ctx.responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 主动回复只接受 markdown / template_card，**不支持 msgtype text**。
          // 普通文本原样塞进 markdown.content 即可：企微的 markdown 子集里
          // 未成对的 * _ ` 等符号会按普通字符渲染，转义反而会把用户看到的
          // 反斜杠加进正文。
          msgtype: 'markdown',
          markdown: { content },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(
          '[WecomChannel] 回复 HTTP 失败:',
          res.status,
          res.statusText,
        );
        return;
      }
      const data = (await res.json()) as { errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        console.error(
          '[WecomChannel] 回复业务失败: errcode=',
          data.errcode,
          data.errmsg,
          '文本长度=',
          content.length,
        );
        return;
      }
      // 只有确认平台收下了，这个 response_url 才算被消费掉
      markReplied(msg.messageId);
    } catch (err) {
      console.error('[WecomChannel] 回复失败:', err);
    }
  }
}
