import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getDispatcher 的熔断降级行为。
 *
 * 这里只关心「配置加载失败时机器人还说不说话」，所以 db / 渠道 adapter /
 * Dispatcher 全部替身化 —— 真实的验签与 SQL 不是本用例的被测对象。
 */

const selectMock = vi.fn();
/** 落进审计表的行，用例据此断言"这条消息有没有留下记录" */
const insertedEvents: Record<string, unknown>[] = [];
/** 让兜底回复自己也炸一次，验证兜底不会再抛 */
let replyShouldThrow = false;

vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => selectMock(),
        // botScenes 那条查询是 select().from().where()，两条都走 selectMock
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedEvents.push(row);
        return { execute: async () => undefined };
      },
    }),
  },
}));

// after() 在非请求上下文里会抛，bot-engine 会降级为立即执行；
// 这里直接同步跑，省掉等 microtask 的不确定性
vi.mock('next/server', () => ({
  after: (fn: () => void) => {
    fn();
  },
}));

vi.mock('@/modules/im-bot/services/credentials', () => ({
  isPlatformEnabled: vi.fn(async () => true),
  resetCredentialsCache: vi.fn(),
}));

vi.mock('@/modules/im-bot/services/db-stores', () => ({
  DbDedupStore: class {},
  DbPendingActionStore: class {},
  DbRateLimitStore: class {},
}));

const processMock = vi.fn(async () => undefined);
/** 每次成功初始化都新建一个实例，用序号认出「这条消息用的是哪一版配置」 */
let dispatcherSeq = 0;
const dispatcherIds: number[] = [];

vi.mock('@/modules/im-bot/core/dispatcher', () => ({
  Dispatcher: class {
    id = ++dispatcherSeq;
    registry = { register: vi.fn() };
    process = async (...args: unknown[]) => {
      dispatcherIds.push(this.id);
      return processMock(...(args as []));
    };
  },
}));

const decodedMessage = {
  platform: 'feishu' as const,
  eventId: 'e1',
  messageId: 'm1',
  chatId: 'c1',
  chatType: 'group' as const,
  senderId: 's1',
  senderName: '张三',
  content: 'hi',
  timestamp: Date.now(),
};

/** 兜底回复的落点，用例据此断言"用户到底收没收到话" */
const replies: string[] = [];

function stubAdapter() {
  return class {
    platform = 'feishu';
    maxReplyBytes = 30_000;
    async decode() {
      return { kind: 'ok' as const, message: decodedMessage };
    }
    async reply(_msg: unknown, content: string) {
      if (replyShouldThrow) throw new Error('reply down');
      replies.push(content);
    }
  };
}

vi.mock('@/modules/im-bot/channels/feishu', () => ({
  FeishuChannelAdapter: stubAdapter(),
}));
vi.mock('@/modules/im-bot/channels/dingtalk', () => ({
  DingtalkChannelAdapter: stubAdapter(),
}));
vi.mock('@/modules/im-bot/channels/wecom', () => ({
  WecomChannelAdapter: stubAdapter(),
}));

const req = () =>
  new Request('https://example.com/api/bot/feishu/webhook', {
    method: 'POST',
    body: '{}',
  });

/** 等 after() 里那段 fire-and-forget 的异步跑完 */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 每个用例都要一份干净的模块级缓存（dispatcher / lastInitError 都是模块状态） */
async function freshEngine() {
  vi.resetModules();
  return import('@/modules/im-bot/services/bot-engine');
}

beforeEach(() => {
  selectMock.mockReset();
  processMock.mockReset();
  dispatcherIds.length = 0;
  replies.length = 0;
  insertedEvents.length = 0;
  replyShouldThrow = false;
  vi.useRealTimers();
});

describe('getDispatcher — 配置加载失败时的降级', () => {
  it('从没成功初始化过时抛错（没有旧配置可用）', async () => {
    const engine = await freshEngine();
    selectMock.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await engine.handleBotWebhook('feishu', req());
    await flush();

    expect(processMock).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('★ 一次都起不来时，用户至少收到一句话、后台至少留一条 error 审计', async () => {
    // 以前这条路径只有 console.error：用户那边是彻底没回音，
    // 后台也查不到任何记录，现象只剩"机器人不理人"
    const engine = await freshEngine();
    selectMock.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await engine.handleBotWebhook('feishu', req());
    await flush();

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('服务暂时繁忙');
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]?.result).toBe('error');
    expect(insertedEvents[0]?.eventId).toBe(decodedMessage.eventId);
    err.mockRestore();
  });

  it('兜底回复自己再失败也不会把异常抛出去', async () => {
    const engine = await freshEngine();
    selectMock.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    replyShouldThrow = true;

    // 不抛 = 不会变成 unhandledRejection 打挂整个进程
    await expect(
      engine.handleBotWebhook('feishu', req()),
    ).resolves.toBeDefined();
    await flush();

    replyShouldThrow = false;
    err.mockRestore();
  });

  it('★ 触发重载的那一条也拿到旧实例 —— 重载在后台跑，消息不等它', async () => {
    // 以前它是唯一被牺牲的一条：走的是初始化路径，还没有 lastInitError
    // 可依，DB 一挂它就直接失声。现在有旧实例就先拿旧的走。
    const engine = await freshEngine();
    selectMock.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    await engine.handleBotWebhook('feishu', req());
    await flush();
    expect(processMock).toHaveBeenCalledTimes(1);
    const firstId = dispatcherIds[0];

    // 配置缓存过期（TTL 60s）之后 DB 挂了
    vi.setSystemTime(new Date('2026-05-11T00:02:00Z'));
    selectMock.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await engine.handleBotWebhook('feishu', req());
    await flush();

    expect(processMock).toHaveBeenCalledTimes(2);
    expect(dispatcherIds[1]).toBe(firstId);
    expect(replies).toHaveLength(0); // 没有触发"服务暂时繁忙"兜底
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('沿用上一版配置'),
      expect.anything(),
    );

    // 熔断窗口内的后续消息同样沿用上一版配置
    vi.setSystemTime(new Date('2026-05-11T00:02:10Z'));
    await engine.handleBotWebhook('feishu', req());
    await flush();
    expect(dispatcherIds[2]).toBe(firstId);

    err.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('★ 重载进行中并发到达的消息也拿到旧实例，不跟着一起失败', async () => {
    const engine = await freshEngine();
    selectMock.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    await engine.handleBotWebhook('feishu', req());
    await flush();
    const firstId = dispatcherIds[0];

    // 让这次重载"卡住"：DB 慢查询期间到达的消息不该被它拖住或拖垮
    let release: (v: unknown) => void = () => {};
    const blocked = new Promise((r) => {
      release = r;
    });
    vi.setSystemTime(new Date('2026-05-11T00:02:00Z'));
    selectMock.mockImplementation(() => blocked);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 第一条把重载踢起来，第二、三条在重载还没回来时到达
    await engine.handleBotWebhook('feishu', req());
    await engine.handleBotWebhook('feishu', req());
    await engine.handleBotWebhook('feishu', req());
    await flush();

    expect(dispatcherIds).toEqual([firstId, firstId, firstId, firstId]);
    expect(replies).toHaveLength(0);

    // 重载最终成功：下一条才用上新配置
    release([]);
    selectMock.mockResolvedValue([]);
    await flush();
    await engine.handleBotWebhook('feishu', req());
    await flush();
    expect(dispatcherIds.at(-1)).not.toBe(firstId);

    err.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('★ DB 持续失败 30s，一条消息都不丢', async () => {
    // 以前每个熔断窗口到期都要拿一条消息去当探针（它走初始化路径、没有
    // 旧实例可依），DB 持续慢时等于每 30s 稳定牺牲一条
    const engine = await freshEngine();
    selectMock.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-05-11T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    await engine.handleBotWebhook('feishu', req());
    await flush();
    const firstId = dispatcherIds[0];

    selectMock.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 从 TTL 过期起，每 10s 来一条，连打 3 分钟（跨 6 个熔断窗口）
    let sent = 0;
    for (let ms = 61_000; ms <= 180_000; ms += 10_000) {
      vi.setSystemTime(t0 + ms);
      await engine.handleBotWebhook('feishu', req());
      await flush();
      sent++;
    }

    expect(processMock).toHaveBeenCalledTimes(sent + 1);
    expect(dispatcherIds.every((id) => id === firstId)).toBe(true);
    expect(replies).toHaveLength(0);

    err.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('DB 恢复后重新加载出新实例', async () => {
    const engine = await freshEngine();
    selectMock.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    await engine.handleBotWebhook('feishu', req());
    await flush();
    const firstId = dispatcherIds[0];

    vi.setSystemTime(new Date('2026-05-11T00:02:00Z'));
    selectMock.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await engine.handleBotWebhook('feishu', req());
    await flush();

    // 熔断窗口（30s）过去，DB 也好了：这一条仍拿旧实例（重载在后台跑），
    // 下一条才用上新配置
    vi.setSystemTime(new Date('2026-05-11T00:03:00Z'));
    selectMock.mockResolvedValue([]);
    await engine.handleBotWebhook('feishu', req());
    await flush();
    expect(dispatcherIds.at(-1)).toBe(firstId);

    vi.setSystemTime(new Date('2026-05-11T00:03:01Z'));
    await engine.handleBotWebhook('feishu', req());
    await flush();
    expect(dispatcherIds.at(-1)).not.toBe(firstId);

    err.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });
});
