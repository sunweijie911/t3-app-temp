import { PENDING_ACTION_TTL_MS } from '../constants';
import type { PendingAction } from './types';

export class MemoryPendingActionStore {
  private map = new Map<string, PendingAction>();

  private key(chatId: string, senderId: string) {
    return `${chatId}:${senderId}`;
  }

  get(chatId: string, senderId: string): PendingAction | null {
    const action = this.map.get(this.key(chatId, senderId));
    if (!action) return null;
    if (Date.now() > action.expiresAt) {
      this.map.delete(this.key(chatId, senderId));
      return null;
    }
    return action;
  }

  set(
    chatId: string,
    senderId: string,
    action: Omit<PendingAction, 'expiresAt'>,
    ttlMs = PENDING_ACTION_TTL_MS,
  ): void {
    this.map.set(this.key(chatId, senderId), {
      ...action,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(chatId: string, senderId: string): void {
    this.map.delete(this.key(chatId, senderId));
  }
}
