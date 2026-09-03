import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_ACTION_TTL_MS } from '@/modules/im-bot/constants';
import { MemoryPendingActionStore } from '@/modules/im-bot/core/pending-action';
import {
  type PendingKeyParts,
  serializePendingKey,
} from '@/modules/im-bot/core/stores';
import type { UnifiedMessage } from '@/modules/im-bot/core/types';

const mockMsg: UnifiedMessage = {
  platform: 'feishu',
  eventId: 'ev1',
  messageId: 'msg1',
  chatId: 'chat1',
  chatType: 'group',
  senderId: 'u1',
  senderName: '张三',
  content: 'hi',
  timestamp: Date.now(),
};

const key: PendingKeyParts = {
  platform: 'feishu',
  chatId: 'chat1',
  senderId: 'u1',
};

const baseAction = {
  sceneId: 's1',
  bindingAlias: 'default',
  type: 'confirm_delete' as const,
  candidates: [{ recordId: 'r1', fields: {} }],
  message: mockMsg,
};

describe('serializePendingKey', () => {
  it('带 platform 前缀，跨平台的同名 chatId 不会撞键', () => {
    expect(serializePendingKey(key)).toBe('feishu:chat1:u1');
    expect(serializePendingKey({ ...key, platform: 'wecom' })).toBe(
      'wecom:chat1:u1',
    );
  });
});

describe('MemoryPendingActionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未 set 时 get 返回 null', async () => {
    const store = new MemoryPendingActionStore();
    await expect(store.get(key)).resolves.toBeNull();
  });

  it('set 后 get 返回完整 action（含 expiresAt 与 bindingAlias）', async () => {
    const store = new MemoryPendingActionStore();
    await store.set(key, baseAction);
    const got = await store.get(key);
    expect(got).toMatchObject({
      sceneId: 's1',
      bindingAlias: 'default',
      type: 'confirm_delete',
    });
    expect(got?.expiresAt).toBe(Date.now() + PENDING_ACTION_TTL_MS);
  });

  it('platform / chatId / senderId 任一不同都不串', async () => {
    const store = new MemoryPendingActionStore();
    await store.set(key, baseAction);
    await expect(store.get({ ...key, platform: 'wecom' })).resolves.toBeNull();
    await expect(store.get({ ...key, chatId: 'other' })).resolves.toBeNull();
    await expect(store.get({ ...key, senderId: 'other' })).resolves.toBeNull();
  });

  it('TTL 过期后 get 自动清掉并返回 null', async () => {
    const store = new MemoryPendingActionStore();
    await store.set(key, baseAction);
    vi.advanceTimersByTime(PENDING_ACTION_TTL_MS + 1);
    await expect(store.get(key)).resolves.toBeNull();
  });

  it('delete 显式清除', async () => {
    const store = new MemoryPendingActionStore();
    await store.set(key, baseAction);
    await store.delete(key);
    await expect(store.get(key)).resolves.toBeNull();
  });

  it('重复 set 覆盖旧 action（同一人同一会话只保留一个待确认）', async () => {
    const store = new MemoryPendingActionStore();
    await store.set(key, baseAction);
    await store.set(key, {
      ...baseAction,
      type: 'confirm_update',
      sceneId: 's2',
    });
    const got = await store.get(key);
    expect(got?.type).toBe('confirm_update');
    expect(got?.sceneId).toBe('s2');
  });
});
