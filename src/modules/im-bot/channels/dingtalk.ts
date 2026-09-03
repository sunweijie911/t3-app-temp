import type { UnifiedMessage } from '../core/types';
import type { ChannelAdapter, DecodeResult } from './types';

/**
 * 钉钉群机器人回复上下文。
 * 钉钉不像飞书那样能用 token 主动往会话发消息：群机器人必须回调
 * body 里带的 `sessionWebhook`（一次性、约 3s~1h 有效期内可用几次）。
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
  if (typeof webhook !== 'string' || !webhook) return null;
  return {
    sessionWebhook: webhook,
    sessionWebhookExpiredTime:
      typeof obj.sessionWebhookExpiredTime === 'number'
        ? obj.sessionWebhookExpiredTime
        : undefined,
  };
}

/**
 * 钉钉 Channel Adapter — 尚未实现。
 *
 * 实现时需要（不能照抄飞书）：
 * 1. **验签**：header 里的 `timestamp` + `sign`，用 botSecret 做
 *    HmacSHA256(`${timestamp}\n${secret}`) 后 base64 比对；
 *    timestamp 与当前时间差超 1h 直接拒绝。
 * 2. **回复**：POST 到 `readDingtalkReplyContext(msg.raw).sessionWebhook`，
 *    body 为 `{ msgtype: 'text', text: { content } }`。**不要**用 tenant token。
 * 3. **会话类型**：body 的 `conversationType`，'1' = 单聊，'2' = 群聊。
 * 4. **去重键**：body 的 `msgId`（钉钉没有 eventId）。
 * 5. Stream 模式（WebSocket 长连接）是钉钉官方更推荐的接入方式，
 *    与本 HTTP webhook 路径并行，需要另起一个常驻连接的入口，不走 decode()。
 */
export class DingtalkChannelAdapter implements ChannelAdapter {
  readonly platform = 'dingtalk' as const;

  async decode(): Promise<DecodeResult> {
    return {
      kind: 'reject',
      status: 501,
      reason: '钉钉 Channel Adapter 尚未实现',
    };
  }

  async reply(_msg: UnifiedMessage, _content: string): Promise<void> {
    throw new Error('钉钉适配器尚未实现');
  }
}
