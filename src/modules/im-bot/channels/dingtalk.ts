import { clampReplyBytes } from '../core/field-render';
import type { ChatType, UnifiedMessage } from '../core/types';
import { getDingtalkCredentials } from '../services/credentials';
import {
  isTimestampFresh,
  robotSignature,
  verifyRobotSignature,
} from './dingtalk-crypto';
import type { ChannelAdapter, DecodeResult } from './types';

/**
 * 钉钉群机器人回复上下文。
 * 钉钉不像飞书那样能用 token 主动往会话发消息：群机器人必须回调
 * body 里带的 `sessionWebhook`（一次性、有时效）。
 * 所以 decode 时必须把它塞进 `UnifiedMessage.raw`，reply 才拿得到。
 */
export interface DingtalkReplyContext {
  sessionWebhook: string;
  sessionWebhookExpiredTime?: number;
}

export function readDingtalkReplyContext(
  raw: unknown,
): DingtalkReplyContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const webhook = obj.sessionWebhook;
  if (typeof webhook !== 'string' || !webhook.startsWith('https://')) {
    return null;
  }
  return {
    sessionWebhook: webhook,
    sessionWebhookExpiredTime:
      typeof obj.sessionWebhookExpiredTime === 'number'
        ? obj.sessionWebhookExpiredTime
        : undefined,
  };
}

/**
 * 转义正则元字符。robotCode 来自后台配置，直接拼进 `new RegExp()` 时
 * 含 `.` `*` `(` 之类的值会被当成模式解析，轻则剥错前缀重则抛异常。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 钉钉机器人 HTTP 回调体 */
interface DingtalkRobotPayload {
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  /** '1' = 单聊，'2' = 群聊 */
  conversationType?: string;
  conversationId?: string;
  conversationTitle?: string;
  senderId?: string;
  senderNick?: string;
  senderStaffId?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  atUsers?: Array<{ dingtalkId?: string; staffId?: string }>;
  chatbotUserId?: string;
}

/**
 * 钉钉 Channel Adapter（企业内部机器人 HTTP 回调模式）。
 *
 * 说明：钉钉官方另有 Stream 模式（WebSocket 长连接），需要一个常驻连接的
 * 入口，不走 decode(req) 这条 HTTP 路径。这里实现的是 HTTP 回调模式，
 * 两者在钉钉侧是二选一的接入方式，功能上覆盖群 @机器人 与单聊。
 */
export class DingtalkChannelAdapter implements ChannelAdapter {
  readonly platform = 'dingtalk' as const;
  /** 钉钉机器人文本消息上限 20000 字节 */
  readonly maxReplyBytes = 20_000;

  async decode(req: Request): Promise<DecodeResult> {
    const timestamp = req.headers.get('timestamp');
    const sign = req.headers.get('sign');
    if (!timestamp || !sign) {
      return {
        kind: 'reject',
        status: 400,
        reason: '缺少 timestamp / sign 请求头',
      };
    }

    const { botSecret, robotCode } = await getDingtalkCredentials();
    if (!botSecret) {
      console.warn(
        '[DingtalkChannel] 拒绝请求：未配置 botSecret，webhook 不能裸奔',
      );
      return { kind: 'reject', status: 403, reason: '未配置 botSecret' };
    }

    if (!verifyRobotSignature(robotSignature(timestamp, botSecret), sign)) {
      return { kind: 'reject', status: 403, reason: '验签失败' };
    }

    // 钉钉回调无 eventId 幂等，时间戳窗口是重放防护第一道
    if (!isTimestampFresh(timestamp)) {
      return { kind: 'reject', status: 403, reason: '时间戳超出容忍窗口' };
    }

    let body: DingtalkRobotPayload;
    try {
      body = (await req.json()) as DingtalkRobotPayload;
    } catch {
      return { kind: 'reject', status: 400, reason: '请求体不是合法 JSON' };
    }

    if (body.msgtype !== 'text') {
      return {
        kind: 'ignored',
        reason: `非文本消息 (${String(body.msgtype)})`,
      };
    }

    const msgId = body.msgId;
    if (!msgId) {
      return { kind: 'ignored', reason: '缺少 msgId（无幂等键）' };
    }

    // 优先用企业内唯一的 staffId；senderId 是会话内的临时 ID，
    // 换群会变，用它做 PendingAction 的键不稳定
    const senderId = body.senderStaffId || body.senderId;
    if (!senderId) {
      return { kind: 'ignored', reason: '缺少发送者标识' };
    }

    const chatType: ChatType = body.conversationType === '1' ? 'p2p' : 'group';

    let content = (body.text?.content ?? '').trim();
    // 只在群聊剥 @ 前缀。单聊钉钉不会加 @机器人，照剥会吃掉用户正文的第一个
    // token：私聊「@张三 的项目进度」变成「的项目进度」，只发「@张三」
    // 会被剥空后当成"内容为空"直接丢弃。
    if (chatType === 'group') {
      // 群聊里钉钉已经只在 @机器人 时才回调，但正文仍含 @昵称 前缀，需剥掉
      if (robotCode) {
        content = content
          .replace(new RegExp(`^@?${escapeRegExp(robotCode)}\\s*`), '')
          .trim();
      }
      // 剥掉开头的 "@昵称"：后面跟空白（正常情况），或者整条消息就只有这个 @
      // （只 @ 了机器人什么都没写 —— 这时不能让 "@昵称" 残留成业务正文）。
      // 只剥一次，所以 "@机器人 @张三的进度" 会保留后面那个 @张三。
      content = content.replace(/^@\S+(?:\s+|$)/, '').trim();
    }
    if (!content) {
      return { kind: 'ignored', reason: '正文为空' };
    }

    if (!body.sessionWebhook) {
      // 没有 sessionWebhook 就无法回复，提前拒掉比处理完发不出去要好
      return {
        kind: 'ignored',
        reason: '回调中缺少 sessionWebhook，无法回复',
      };
    }

    return {
      kind: 'ok',
      message: {
        platform: 'dingtalk',
        // 钉钉没有独立 eventId，msgId 兼作幂等键
        eventId: msgId,
        messageId: msgId,
        // 单聊没有稳定的 conversationId 时用发送者兜底，保证 pending 键稳定
        chatId: body.conversationId || `p2p:${senderId}`,
        chatName: body.conversationTitle || undefined,
        chatType,
        senderId,
        senderName: body.senderNick || senderId,
        content,
        timestamp: Number(timestamp) || Date.now(),
        raw: body,
      },
    };
  }

  async reply(msg: UnifiedMessage, rawContent: string): Promise<void> {
    const content = clampReplyBytes(rawContent, this.maxReplyBytes);
    const ctx = readDingtalkReplyContext(msg.raw);
    if (!ctx) {
      console.error(
        '[DingtalkChannel] 回复失败：raw 中没有可用的 sessionWebhook，msgId=',
        msg.messageId,
      );
      return;
    }
    // sessionWebhook 有时效。过期后 POST 会返回业务错误码，
    // 这里提前判断以便日志里给出准确原因（而不是笼统的"回复失败"）
    if (
      ctx.sessionWebhookExpiredTime &&
      Date.now() > ctx.sessionWebhookExpiredTime
    ) {
      console.error(
        '[DingtalkChannel] 回复失败：sessionWebhook 已过期 (expiredAt=',
        new Date(ctx.sessionWebhookExpiredTime).toISOString(),
        ')，msgId=',
        msg.messageId,
      );
      return;
    }

    try {
      const res = await fetch(ctx.sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(
          '[DingtalkChannel] 回复 HTTP 失败:',
          res.status,
          res.statusText,
        );
        return;
      }
      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
      };
      if (data.errcode && data.errcode !== 0) {
        console.error(
          '[DingtalkChannel] 回复业务失败: errcode=',
          data.errcode,
          data.errmsg,
          '文本长度=',
          content.length,
        );
      }
    } catch (err) {
      console.error('[DingtalkChannel] 回复失败:', err);
    }
  }
}
