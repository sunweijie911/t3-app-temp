import { DEDUP_TTL_MS } from '../constants';

export class MemoryDedupStore {
  private map = new Map<string, number>();

  has(eventId: string): boolean {
    const expiresAt = this.map.get(eventId);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.map.delete(eventId);
      return false;
    }
    return true;
  }

  set(eventId: string, ttlMs: number = DEDUP_TTL_MS): void {
    this.map.set(eventId, Date.now() + ttlMs);
    if (this.map.size > 1000) this.cleanup();
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.map) {
      if (now > expiresAt) this.map.delete(key);
    }
  }
}
