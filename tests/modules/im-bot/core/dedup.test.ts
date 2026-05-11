import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDedupStore } from '@/modules/im-bot/core/dedup';

describe('MemoryDedupStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未 set 时 has 返回 false', () => {
    const s = new MemoryDedupStore();
    expect(s.has('e1')).toBe(false);
  });

  it('set 后立即 has 返回 true', () => {
    const s = new MemoryDedupStore();
    s.set('e1');
    expect(s.has('e1')).toBe(true);
  });

  it('TTL 过期后 has 返回 false 并清掉', () => {
    const s = new MemoryDedupStore();
    s.set('e1', 1000);
    vi.advanceTimersByTime(1001);
    expect(s.has('e1')).toBe(false);
  });

  it('超过 1000 条会触发 cleanup', () => {
    const s = new MemoryDedupStore();
    // 写入 500 条短 TTL，已过期
    for (let i = 0; i < 500; i++) s.set(`short-${i}`, 100);
    vi.advanceTimersByTime(200);
    // 再写 600 条长 TTL，触发 size > 1000 的 cleanup
    for (let i = 0; i < 600; i++) s.set(`long-${i}`, 60_000);
    // 已过期的应被清理；新写入仍有效
    expect(s.has('short-0')).toBe(false);
    expect(s.has('long-0')).toBe(true);
  });
});
