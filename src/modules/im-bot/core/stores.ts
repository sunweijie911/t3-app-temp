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
