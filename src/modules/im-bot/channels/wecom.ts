import type { ChatType, UnifiedMessage } from '../core/types';
import { getWecomCredentials } from '../services/credentials';
import type { ChannelAdapter, DecodeResult } from './types';
import {
  callbackSignature,
  decryptMessage,
  readXmlField,
  verifySignature,
} from './wecom-crypto';

/**
 * 回调时间戳容忍窗口。超出即拒绝，避免抓到的旧回调被无限重放。
 * 企微不像飞书带 eventId 幂等，这一层是重放防护的第一道。
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 企微回复上下文。
 *
 * 企微智能机器人的回调体里带一个一次性的 `webhook_url`，回复要 POST 到它，
 * 而不是像飞书那样用 token 主动往会话发消息。所以 decode 必须把它塞进
 * `UnifiedMessage.raw` —— 这正是上一轮给 UnifiedMessage 加 raw 的原因。
 */
export interface WecomReplyContext {
  webhookUrl: string;
  chatId: string;
  chatType: ChatType;
}

export function readWecomReplyContext(raw: unknown): WecomReplyContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const url = o.webhook_url;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  return {
    webhookUrl: url,
    chatId: typeof o.chatid === 'string' ? o.chatid : '',
    chatType: o.chattype === 'single' ? 'p2p' : 'group',
  };
}

/** 企微智能机器人回调的明文结构（解密后是 JSON，不是 XML） */
interface WecomBotPayload {
  msgid?: string;
  chatid?: string;
  chattype?: string;
  from?: { userid?: string; name?: string };
  msgtype?: string;
  text?: { content?: string };
  webhook_url?: string;
}

export class WecomChannelAdapter implements ChannelAdapter {
  readonly platform = 'wecom' as const;

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

    // 时间戳窗口：企微回调无 eventId 幂等，先挡掉明显的重放
    const tsMs = Number(timestamp) * 1000;
    if (
      !Number.isFinite(tsMs) ||
      Math.abs(Date.now() - tsMs) > TIMESTAMP_TOLERANCE_MS
    ) {
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
      // webhook_url，回复要走 message/send，本 adapter 暂不支持。
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
    const content = body.text?.content?.trim();
    if (!content) return { kind: 'ignored', reason: '正文为空' };

    const senderId = body.from?.userid;
    if (!senderId) return { kind: 'ignored', reason: '缺少发送者 userid' };

    const msgId = body.msgid;
    if (!msgId) return { kind: 'ignored', reason: '缺少 msgid' };

    const chatType: ChatType = body.chattype === 'single' ? 'p2p' : 'group';

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

  async reply(msg: UnifiedMessage, content: string): Promise<void> {
    const ctx = readWecomReplyContext(msg.raw);
    if (!ctx) {
      // 拿不到 webhook_url 说明这条消息不是智能机器人回调，或 raw 在
      // 跨实例传递中丢了字段。不静默失败，日志里说清原因。
      console.error(
        '[WecomChannel] 回复失败：raw 中没有可用的 webhook_url，msgId=',
        msg.messageId,
      );
      return;
    }

    try {
      const res = await fetch(ctx.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: { content },
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
      }
    } catch (err) {
      console.error('[WecomChannel] 回复失败:', err);
    }
  }
}
