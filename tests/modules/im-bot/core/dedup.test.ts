import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEDUP_TTL_MS } from '@/modules/im-bot/constants';
import { MemoryDedupStore } from '@/modules/im-bot/core/dedup';

describe('MemoryDedupStore.claim', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次 claim 抢到处理权', async () => {
    const store = new MemoryDedupStore();
    await expect(store.claim('feishu', 'ev1')).resolves.toBe(true);
  });

  it('同一 eventId 二次 claim 抢不到（平台重试被拦截）', async () => {
    const store = new MemoryDedupStore();
    await store.claim('feishu', 'ev1');
    await expect(store.claim('feishu', 'ev1')).resolves.toBe(false);
  });

  it('不同平台的同名 eventId 互不干扰', async () => {
    const store = new MemoryDedupStore();
    await expect(store.claim('feishu', 'same-id')).resolves.toBe(true);
    // 各平台 eventId 命名空间独立，不能因为字符串相同就误判为重复
    await expect(store.claim('wecom', 'same-id')).resolves.toBe(true);
  });

  it('TTL 过期后可以重新 claim', async () => {
    const store = new MemoryDedupStore();
    await store.claim('feishu', 'ev1');
    vi.advanceTimersByTime(DEDUP_TTL_MS + 1);
    await expect(store.claim('feishu', 'ev1')).resolves.toBe(true);
  });

  it('TTL 边界内仍然拦截', async () => {
    const store = new MemoryDedupStore();
    await store.claim('feishu', 'ev1', 1000);
    vi.advanceTimersByTime(1000);
    await expect(store.claim('feishu', 'ev1')).resolves.toBe(false);
  });

  it('超过 1000 条触发 cleanup，过期项被回收且不影响未过期项', async () => {
    const store = new MemoryDedupStore();
    // 先塞 1000 条短 TTL 的
    for (let i = 0; i < 1000; i++) {
      await store.claim('feishu', `old-${i}`, 1000);
    }
    await store.claim('feishu', 'fresh', 60_000);
    vi.advanceTimersByTime(2000);
    // 触发 cleanup
    await store.claim('feishu', 'trigger');
    // 过期的可以重新 claim
    await expect(store.claim('feishu', 'old-0')).resolves.toBe(true);
    // 未过期的仍被拦截
    await expect(store.claim('feishu', 'fresh')).resolves.toBe(false);
  });
});
