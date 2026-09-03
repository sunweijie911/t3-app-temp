import { PENDING_ACTION_TTL_MS } from '../constants';
import {
  type PendingActionStore,
  type PendingKeyParts,
  serializePendingKey,
} from './stores';
import type { PendingAction } from './types';

/**
 * 进程内待确认交互存储。
 *
 * ⚠️ 只适用于单实例部署和测试。多实例下用户回的"确认删除"可能落到
 * 另一个实例，那边查不到 pending 就会把它当成新业务消息送去 LLM
 * —— 生产环境请用 DbPendingActionStore。
 */
export class MemoryPendingActionStore implements PendingActionStore {
  private map = new Map<string, PendingAction>();

  async get(key: PendingKeyParts): Promise<PendingAction | null> {
    const k = serializePendingKey(key);
    const action = this.map.get(k);
    if (!action) return null;
    if (Date.now() > action.expiresAt) {
      this.map.delete(k);
      return null;
    }
    return action;
  }

  async set(
    key: PendingKeyParts,
    action: Omit<PendingAction, 'expiresAt'>,
    ttlMs = PENDING_ACTION_TTL_MS,
  ): Promise<void> {
    this.map.set(serializePendingKey(key), {
      ...action,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async delete(key: PendingKeyParts): Promise<void> {
    this.map.delete(serializePendingKey(key));
  }
}
