import crypto from 'node:crypto';
import { getFeishuChatName } from '../auth/feishu-chat';
import { feishuTokenManager } from '../auth/feishu-token';
import { getFeishuUserName } from '../auth/feishu-user';
import type { ChatType, UnifiedMessage } from '../core/types';
import { getFeishuCredentials } from '../services/credentials';
import type { ChannelAdapter, DecodeResult } from './types';

function decryptFeishuEvent(encrypt: string, key: string): string {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const buf = Buffer.from(encrypt, 'base64');
  const iv = buf.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
  let decrypted = decipher.update(buf.subarray(16));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf-8');
}

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly platform = 'feishu' as const;

  async decode(req: Request): Promise<DecodeResult> {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return { kind: 'reject', status: 400, reason: '请求体不是合法 JSON' };
    }

    const creds = await getFeishuCredentials();

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

    // 4. 解析为统一消息
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

    const mentions = message.mentions as Array<{ key: string }> | undefined;
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

    // 用户名与群名并发查询，两者都有独立缓存与 3s 超时，失败各自降级
    const [senderName, chatName] = await Promise.all([
      senderId ? getFeishuUserName(senderId) : Promise.resolve(null),
      chatType === 'group' ? getFeishuChatName(chatId) : Promise.resolve(null),
    ]);

    return {
      kind: 'ok',
      message: {
        platform: 'feishu',
        eventId: header.event_id as string,
        messageId: message.message_id as string,
        chatId,
        chatName: chatName ?? undefined,
        chatType,
        senderId,
        senderName: senderName ?? senderId,
        content,
        timestamp: Number(header.create_time) || Date.now(),
        raw: body,
      },
    };
  }

  async reply(msg: UnifiedMessage, content: string): Promise<void> {
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
