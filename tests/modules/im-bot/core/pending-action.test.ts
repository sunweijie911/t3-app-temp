import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPendingActionStore } from '@/modules/im-bot/core/pending-action';
import type { UnifiedMessage } from '@/modules/im-bot/core/types';

const mockMsg: UnifiedMessage = {
  platform: 'feishu',
  eventId: 'ev1',
  messageId: 'msg1',
  chatId: 'chat1',
  senderId: 'u1',
  senderName: '张三',
  content: 'hi',
  timestamp: Date.now(),
};

describe('MemoryPendingActionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未 set 时 get 返回 null', () => {
    const s = new MemoryPendingActionStore();
    expect(s.get('chat1', 'u1')).toBeNull();
  });

  it('set 后 get 返回完整 action（含 expiresAt）', () => {
    const s = new MemoryPendingActionStore();
    s.set('chat1', 'u1', {
      sceneId: 'sales',
      type: 'confirm_delete',
      candidates: [{ recordId: 'r1', fields: {} }],
      message: mockMsg,
    });
    const got = s.get('chat1', 'u1');
    expect(got?.sceneId).toBe('sales');
    expect(got?.type).toBe('confirm_delete');
    expect(got?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('不同 chatId 或 senderId 不串', () => {
    const s = new MemoryPendingActionStore();
    s.set('chatA', 'u1', {
      sceneId: 'sales',
      type: 'confirm_delete',
      candidates: [],
      message: mockMsg,
    });
    expect(s.get('chatA', 'u2')).toBeNull();
    expect(s.get('chatB', 'u1')).toBeNull();
  });

  it('TTL 过期后 get 自动清掉返回 null', () => {
    const s = new MemoryPendingActionStore();
    s.set(
      'chat1',
      'u1',
      {
        sceneId: 'sales',
        type: 'confirm_delete',
        candidates: [],
        message: mockMsg,
      },
      1000,
    );
    vi.advanceTimersByTime(1001);
    expect(s.get('chat1', 'u1')).toBeNull();
  });

  it('delete 显式清除', () => {
    const s = new MemoryPendingActionStore();
    s.set('chat1', 'u1', {
      sceneId: 'sales',
      type: 'confirm_delete',
      candidates: [],
      message: mockMsg,
    });
    s.delete('chat1', 'u1');
    expect(s.get('chat1', 'u1')).toBeNull();
  });
});
