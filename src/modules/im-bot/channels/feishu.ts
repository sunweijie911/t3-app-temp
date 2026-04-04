import crypto from 'node:crypto';
import { env } from '@/env';
import { feishuTokenManager } from '../auth/feishu-token';
import type { UnifiedMessage } from '../core/types';
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

    if (typeof obj.encrypt === 'string') {
      const encryptKey = env.IM_BOT_FEISHU_ENCRYPT_KEY;
      if (!encryptKey) return { ok: false, status: 403 };
      try {
        const decrypted = decryptFeishuEvent(obj.encrypt, encryptKey);
        const parsed = JSON.parse(decrypted) as Record<string, unknown>;
        Object.assign(obj, parsed);
      } catch {
        return { ok: false, status: 403 };
      }
    }

    if (typeof obj.challenge === 'string') {
      return { challenge: obj.challenge };
    }

    const token = (obj.header as Record<string, unknown>)?.token as
      | string
      | undefined;
    const verificationToken = env.IM_BOT_FEISHU_VERIFICATION_TOKEN;
    if (verificationToken && (!token || token !== verificationToken)) {
      return { ok: false, status: 403 };
    }

    return { ok: true };
  }

  parse(body: unknown): UnifiedMessage | null {
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
    } catch {
      return null;
    }

    content = content.replace(/@_user_\d+/g, '').trim();
    if (!content) return null;

    const senderInfo = sender.sender_id as Record<string, string> | undefined;
    const senderId = senderInfo?.open_id ?? senderInfo?.user_id ?? '';

    // 飞书事件体中 sender.sender_id 仅含 ID，不含名字。
    // 尝试从 mentions 中提取发送者名（如果机器人也被 @ 了，mentions 里可能有其他用户信息）。
    // 兜底使用 senderId。后续可接入通讯录 API 查询用户名。
    const senderName =
      (sender as Record<string, unknown>).sender_type === 'user'
        ? senderId
        : '未知用户';

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
    await fetch(
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
      },
    ).catch((err) => {
      console.error('[FeishuChannel] 回复失败:', err);
    });
  }
}
