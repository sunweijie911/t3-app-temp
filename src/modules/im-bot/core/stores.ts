import type { BotPlatform } from '../constants';
import type { PendingAction, UnifiedMessage } from './types';

/**
 * 事件幂等存储。
 *
 * 接口只有一个 `claim()`，而不是原来的 `has()` + `set()` 两步：
 * 两步式在两个并发请求之间存在竞态 —— A 查到"没有"、B 也查到"没有"，
 * 然后两者都往下走，业务数据被写两次。平台重试本身就常常是并发的。
 * `claim()` 语义是「原子地占坑」，返回 true 表示这次调用抢到了处理权。
 */
export interface DedupStore {
  /** @returns true = 本次调用抢到处理权；false = 已被处理过（应忽略） */
  claim(
    platform: BotPlatform,
    eventId: string,
    ttlMs?: number,
  ): Promise<boolean>;
}

/**
 * 限流存储。
 *
 * 只有一个 `hit()`：语义是「记一次，并告诉我现在第几次」。返回值让调用方
 * 自己判断超没超 —— 也因此能做到「只在**刚**超限那一次回一句提示，
 * 之后保持沉默」：有人刷屏时，每条都回复等于把流量翻倍。
 */
export interface RateLimitStore {
  /** @returns 本窗口内累计到第几次（含本次） */
  hit(key: PendingKeyParts, windowMs?: number): Promise<number>;
}

/** 待确认交互的定位键 */
export interface PendingKeyParts {
  platform: BotPlatform;
  chatId: string;
  senderId: string;
}

export interface PendingActionStore {
  get(key: PendingKeyParts): Promise<PendingAction | null>;
  set(
    key: PendingKeyParts,
    action: Omit<PendingAction, 'expiresAt'>,
    ttlMs?: number,
  ): Promise<void>;
  delete(key: PendingKeyParts): Promise<void>;
}

/** 从消息中取出定位键 */
export function pendingKeyOf(msg: UnifiedMessage): PendingKeyParts {
  return {
    platform: msg.platform,
    chatId: msg.chatId,
    senderId: msg.senderId,
  };
}

/** 序列化成存储键。带 platform 前缀，避免不同平台的 chatId 撞键 */
export function serializePendingKey(k: PendingKeyParts): string {
  return `${k.platform}:${k.chatId}:${k.senderId}`;
}

export function serializeDedupKey(
  platform: BotPlatform,
  eventId: string,
): string {
  return `${platform}:${eventId}`;
}

/**
 * 限流键。把**窗口起点**拼进键里 —— 于是"换窗口"等于"换一行"，
 * 计数可以用一条原子 upsert 完成，不需要读改写。
 */
export function serializeRateLimitKey(
  k: PendingKeyParts,
  windowMs: number,
  now: number = Date.now(),
): string {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return `${serializePendingKey(k)}:${windowStart}`;
}
