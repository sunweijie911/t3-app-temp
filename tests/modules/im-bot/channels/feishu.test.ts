import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/services/credentials', () => ({
  getFeishuCredentials: vi.fn(),
}));
vi.mock('@/modules/im-bot/auth/feishu-user', () => ({
  getFeishuUserName: vi.fn(),
}));
vi.mock('@/modules/im-bot/auth/feishu-chat', () => ({
  getFeishuChatName: vi.fn(),
  resetFeishuChatNameCache: vi.fn(),
}));
// 不 mock 的话 decode 会真的去打 /bot/v3/info（凭证是 mock 的，但 fetch 是真的）
vi.mock('@/modules/im-bot/auth/feishu-bot', () => ({
  getFeishuBotOpenId: vi.fn(),
  resetFeishuBotOpenIdCache: vi.fn(),
}));

import { getFeishuBotOpenId } from '@/modules/im-bot/auth/feishu-bot';
import { getFeishuChatName } from '@/modules/im-bot/auth/feishu-chat';
import { getFeishuUserName } from '@/modules/im-bot/auth/feishu-user';
import { FeishuChannelAdapter } from '@/modules/im-bot/channels/feishu';
import { getFeishuCredentials } from '@/modules/im-bot/services/credentials';

const mockCreds = vi.mocked(getFeishuCredentials);
const mockUserName = vi.mocked(getFeishuUserName);
const mockChatName = vi.mocked(getFeishuChatName);
const mockBotOpenId = vi.mocked(getFeishuBotOpenId);

const adapter = new FeishuChannelAdapter();

function makeReq(body: unknown): Request {
  return new Request('https://example.com/api/bot/feishu/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeEvent(opts: {
  chatType?: string;
  mentions?: unknown[];
  text?: string;
  senderType?: string;
  messageType?: string;
}) {
  return {
    header: {
      event_id: 'ev-1',
      event_type: 'im.message.receive_v1',
      token: 'good-token',
      create_time: '1700000000000',
    },
    event: {
      sender: {
        sender_type: opts.senderType ?? 'user',
        sender_id: { open_id: 'ou_abc' },
      },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: opts.chatType ?? 'group',
        message_type: opts.messageType ?? 'text',
        content: JSON.stringify({ text: opts.text ?? '@_user_1 新增项目 A' }),
        mentions: opts.mentions ?? [{ key: '@_user_1' }],
      },
    },
  };
}

beforeEach(() => {
  mockCreds.mockReset();
  mockUserName.mockReset();
  mockChatName.mockReset();
  mockBotOpenId.mockReset();
  // 默认拿不到自身 open_id → fail-open，与加这层判定之前的行为一致
  mockBotOpenId.mockResolvedValue(null);
  mockCreds.mockResolvedValue({
    appId: 'a',
    appSecret: 'b',
    verificationToken: 'good-token',
  });
  mockUserName.mockResolvedValue('张三');
  mockChatName.mockResolvedValue('前端项目群');
});

describe('FeishuChannelAdapter.decode — 验签与 challenge', () => {
  it('非法 JSON body → reject 400（不再由调用方预解析）', async () => {
    const req = new Request('https://example.com/x', {
      method: 'POST',
      body: 'not-json',
    });
    const r = await adapter.decode(req);
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });

  it('URL challenge → respond，原样回写 challenge', async () => {
    const r = await adapter.decode(
      makeReq({ challenge: 'c123', type: 'url_verification' }),
    );
    expect(r.kind).toBe('respond');
    if (r.kind !== 'respond') throw new Error('expected respond');
    await expect(r.response.json()).resolves.toEqual({ challenge: 'c123' });
  });

  it('未配置 verificationToken 时拒绝，不让 webhook 裸奔', async () => {
    mockCreds.mockResolvedValue({ appId: 'a', appSecret: 'b' });
    const r = await adapter.decode(makeReq(makeEvent({})));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('token 不匹配 → 403', async () => {
    const body = makeEvent({});
    body.header.token = 'wrong';
    const r = await adapter.decode(makeReq(body));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });
});

describe('FeishuChannelAdapter.decode — 消息解析', () => {
  it('群聊 @机器人 → ok，剥离 @ 占位符并带上群名', async () => {
    const r = await adapter.decode(makeReq(makeEvent({})));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.content).toBe('新增项目 A');
    expect(r.message.chatType).toBe('group');
    expect(r.message.senderName).toBe('张三');
    expect(r.message.chatName).toBe('前端项目群');
    expect(r.message.eventId).toBe('ev-1');
  });

  it('单聊免 @：以前无条件要求 mentions，导致所有私聊被丢弃', async () => {
    const r = await adapter.decode(
      makeReq(
        makeEvent({ chatType: 'p2p', mentions: [], text: '查一下项目 A' }),
      ),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatType).toBe('p2p');
    expect(r.message.content).toBe('查一下项目 A');
    // 单聊不查群名
    expect(mockChatName).not.toHaveBeenCalled();
  });

  it('群聊未 @机器人 → ignored', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ mentions: [] })));
    expect(r.kind).toBe('ignored');
  });

  it('保留平台原始事件体到 raw（钉钉/企微 reply 依赖此字段）', async () => {
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.raw).toMatchObject({
      header: { event_id: 'ev-1' },
    });
  });

  it('机器人自己发的消息被忽略，避免回环', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ senderType: 'app' })));
    expect(r.kind).toBe('ignored');
  });

  it('非文本消息 → ignored', async () => {
    const r = await adapter.decode(
      makeReq(makeEvent({ messageType: 'image' })),
    );
    expect(r.kind).toBe('ignored');
  });

  it('非目标事件类型 → ignored', async () => {
    const body = makeEvent({});
    body.header.event_type = 'im.chat.updated_v1';
    const r = await adapter.decode(makeReq(body));
    expect(r.kind).toBe('ignored');
  });

  it('@ 之后内容为空 → ignored，不浪费 LLM token', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ text: '@_user_1  ' })));
    expect(r.kind).toBe('ignored');
  });

  it('用户名查询失败时回退到 open_id，不阻塞处理', async () => {
    mockUserName.mockResolvedValue(null);
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.senderName).toBe('ou_abc');
  });

  it('群名查询失败时 chatName 为 undefined，不阻塞处理', async () => {
    mockChatName.mockResolvedValue(null);
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatName).toBeUndefined();
  });
});

describe('群聊 @ 判定：被 @ 的必须是机器人自己（P2）', () => {
  const botOpenId = 'ou_bot';

  it('@ 的是机器人 → 正常处理', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: botOpenId } }],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('@ 的是别人 → 忽略（开通"接收群里所有消息"后才会遇到）', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: 'ou_someone' } }],
          text: '@_user_1 帮我看下这个',
        }),
      ),
    );

    expect(r.kind).toBe('ignored');
    if (r.kind === 'ignored') expect(r.reason).toContain('不是机器人');
  });

  it('同时 @ 了机器人和别人 → 仍然处理', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [
            { key: '@_user_1', id: { open_id: 'ou_someone' } },
            { key: '@_user_2', id: { open_id: botOpenId } },
          ],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('拿不到自身 open_id → fail-open，不因此把群消息全丢掉', async () => {
    mockBotOpenId.mockResolvedValue(null);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: 'ou_someone' } }],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('单聊不做这层判定（本来就没有 mentions）', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({ chatType: 'p2p', mentions: [], text: '查一下项目 A' }),
      ),
    );

    expect(r.kind).toBe('ok');
  });
});
