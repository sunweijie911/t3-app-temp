import { RATE_LIMIT_WINDOW_MS } from '../constants';
import {
  type PendingKeyParts,
  type RateLimitStore,
  serializeRateLimitKey,
} from './stores';

/**
 * 进程内限流存储。
 *
 * ⚠️ 只适用于单实例部署和测试。多实例下每个实例各记一份，
 * 实际放行量是配额 × 实例数 —— 生产环境请用 DbRateLimitStore。
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, { count: number; expiresAt: number }>();

  async hit(
    key: PendingKeyParts,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
  ): Promise<number> {
    const now = Date.now();
    const k = serializeRateLimitKey(key, windowMs, now);
    const entry = this.map.get(k);
    if (entry && now <= entry.expiresAt) {
      entry.count += 1;
      return entry.count;
    }
    this.map.set(k, { count: 1, expiresAt: now + windowMs });
    if (this.map.size > 1000) this.cleanup(now);
    return 1;
  }

  private cleanup(now: number) {
    for (const [k, v] of this.map) {
      if (now > v.expiresAt) this.map.delete(k);
    }
  }
}
