import crypto from 'node:crypto';
import { feishuTokenManager } from '../auth/feishu-token';
import { getFeishuUserName } from '../auth/feishu-user';
import type { UnifiedMessage } from '../core/types';
import { getFeishuCredentials } from '../services/credentials';
import type { ChannelAdapter, VerifyResult } from './types';

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

  async verify(_req: Request, body: unknown): Promise<VerifyResult> {
    const obj = body as Record<string, unknown>;
    const creds = await getFeishuCredentials();

    if (typeof obj.encrypt === 'string') {
      if (!creds.encryptKey) {
        console.warn('[FeishuChannel] 收到加密事件但未配置 encryptKey');
        return { ok: false, status: 403 };
      }
      try {
        const decrypted = decryptFeishuEvent(obj.encrypt, creds.encryptKey);
        const parsed = JSON.parse(decrypted) as Record<string, unknown>;
        Object.assign(obj, parsed);
      } catch (err) {
        console.error(
          '[FeishuChannel] 解密事件失败，可能是 encryptKey 配置错误:',
          err,
        );
        return { ok: false, status: 403 };
      }
    }

    if (typeof obj.challenge === 'string') {
      return { challenge: obj.challenge };
    }

    // verification_token 必须配置（DB 或 env），否则拒绝以避免 webhook 裸奔
    if (!creds.verificationToken) {
      console.warn(
        '[FeishuChannel] 拒绝请求：未配置 verificationToken，webhook 不能裸奔',
      );
      return { ok: false, status: 403 };
    }

    const token = (obj.header as Record<string, unknown>)?.token as
      | string
      | undefined;
    if (!token || token !== creds.verificationToken) {
      return { ok: false, status: 403 };
    }

    return { ok: true };
  }

  async parse(body: unknown): Promise<UnifiedMessage | null> {
    const obj = body as Record<string, unknown>;
    const header = obj.header as Record<string, unknown> | undefined;
    const event = obj.event as Record<string, unknown> | undefined;
    if (!header || !event) return null;

    if (header.event_type !== 'im.message.receive_v1') return null;

    const message = event.message as Record<string, unknown> | undefined;
    const sender = event.sender as Record<string, unknown> | undefined;
    if (!message || !sender) return null;

    if (message.message_type !== 'text') return null;

    const mentions = message.mentions as
      | Array<{ key: string; name: string; id: { open_id: string } }>
      | undefined;
    if (!mentions || mentions.length === 0) return null;

    let content = '';
    try {
      const parsed = JSON.parse(message.content as string) as { text?: string };
      content = parsed.text ?? '';
    } catch (err) {
      console.warn(
        '[FeishuChannel] message.content 解析失败，raw:',
        String(message.content).slice(0, 200),
        err,
      );
      return null;
    }

    content = content.replace(/@_user_\d+/g, '').trim();
    if (!content) return null;

    const senderInfo = sender.sender_id as Record<string, string> | undefined;
    const senderId = senderInfo?.open_id ?? senderInfo?.user_id ?? '';

    let senderName = senderId;
    if (
      (sender as Record<string, unknown>).sender_type === 'user' &&
      senderId
    ) {
      const realName = await getFeishuUserName(senderId);
      if (realName) senderName = realName;
    } else if ((sender as Record<string, unknown>).sender_type !== 'user') {
      senderName = '未知用户';
    }

    return {
      platform: 'feishu',
      eventId: header.event_id as string,
      messageId: message.message_id as string,
      chatId: message.chat_id as string,
      senderId,
      senderName,
      content,
      timestamp: Number(header.create_time) || Date.now(),
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
        );
      }
    } catch (err) {
      console.error('[FeishuChannel] 回复失败:', err);
    }
  }
}
