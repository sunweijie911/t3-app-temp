import type { BotPlatform } from '../constants';
import { DEDUP_TTL_MS } from '../constants';
import { type DedupStore, serializeDedupKey } from './stores';

/**
 * 进程内幂等存储。
 *
 * ⚠️ 只适用于单实例部署和测试。多实例/多 Pod 下平台重试可能落到别的实例，
 * 那边查不到记录就会重复处理 —— 生产环境请用 DbDedupStore。
 */
export class MemoryDedupStore implements DedupStore {
  private map = new Map<string, number>();

  async claim(
    platform: BotPlatform,
    eventId: string,
    ttlMs: number = DEDUP_TTL_MS,
  ): Promise<boolean> {
    const key = serializeDedupKey(platform, eventId);
    const expiresAt = this.map.get(key);
    if (expiresAt !== undefined && Date.now() <= expiresAt) return false;
    this.map.set(key, Date.now() + ttlMs);
    if (this.map.size > 1000) this.cleanup();
    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.map) {
      if (now > expiresAt) this.map.delete(key);
    }
  }
}
