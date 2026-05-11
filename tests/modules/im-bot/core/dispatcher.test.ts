import { beforeEach, describe, expect, it, vi } from 'vitest';

// 必须在 import dispatcher 之前 mock 子模块
vi.mock('@/modules/im-bot/core/llm', () => ({
  chatCompletion: vi.fn(),
  extractJson: (raw: string) => {
    const start = raw.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      if (raw[i] === '}') {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return null;
  },
}));

vi.mock('@/modules/im-bot/spreadsheets/factory', () => ({
  getSpreadsheetAdapter: vi.fn(),
}));

import type { ChannelAdapter } from '@/modules/im-bot/channels/types';
import { Dispatcher } from '@/modules/im-bot/core/dispatcher';
import { chatCompletion } from '@/modules/im-bot/core/llm';
import type {
  SpreadsheetTableConfig,
  UnifiedMessage,
} from '@/modules/im-bot/core/types';
import { DatabaseDrivenScene } from '@/modules/im-bot/scenes/db-scene';
import { getSpreadsheetAdapter } from '@/modules/im-bot/spreadsheets/factory';
import type { SpreadsheetAdapter } from '@/modules/im-bot/spreadsheets/types';

const mockChatCompletion = vi.mocked(chatCompletion);
const mockGetAdapter = vi.mocked(getSpreadsheetAdapter);

function makeMsg(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    platform: 'feishu',
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    messageId: 'm1',
    chatId: 'chatA',
    senderId: 'uX',
    senderName: '张三',
    content: '帮我录入',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeChannel(): ChannelAdapter & { lastReply?: string } {
  const ch = {
    platform: 'feishu' as const,
    verify: vi.fn(),
    parse: vi.fn(),
    reply: vi.fn(async (_msg: UnifiedMessage, content: string) => {
      (ch as { lastReply?: string }).lastReply = content;
    }),
  } as unknown as ChannelAdapter & { lastReply?: string };
  return ch;
}

function makeAdapter(): SpreadsheetAdapter {
  return {
    platform: 'feishu',
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    queryRecords: vi.fn(),
    deleteRecord: vi.fn(),
  };
}

const baseSceneConfig = {
  sceneId: 'devops-project',
  name: '前端项目台账',
  description: 'd',
  keywords: ['项目', '台账'],
  systemPrompt: 'prompt',
};

const baseTableConfig: SpreadsheetTableConfig = {
  platform: 'feishu',
  workspaceId: 'app1',
  tableId: 't1',
  fieldMapping: { 项目名称: '项目名称', Node版本: '项目Node' },
};

function makeDispatcher(
  tableConfig: SpreadsheetTableConfig | null = baseTableConfig,
) {
  const d = new Dispatcher({
    getTableConfig: () => tableConfig,
  });
  d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
  return d;
}

beforeEach(() => {
  mockChatCompletion.mockReset();
  mockGetAdapter.mockReset();
});

describe('Dispatcher.process — 主链路', () => {
  it('正常 CREATE：场景匹配 → LLM 解析 → createRecord → 回复', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '督导2.0' },
    });

    await d.process(makeMsg({ content: '新增项目 督导2.0' }), channel);

    expect(adapter.createRecord).toHaveBeenCalled();
    expect(channel.reply).toHaveBeenCalled();
    expect(channel.lastReply).toContain('已录入');
    expect(channel.lastReply).toContain('督导2.0');
  });

  it('置信度不足时返回引导，不调 CRUD', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{},"confidence":0.3,"summary":"模糊"}',
    );

    await d.process(makeMsg({ content: '项目 模糊语义' }), channel);

    expect(adapter.createRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('不太确定');
  });

  it('UNKNOWN 意图提前引导，不落 default 错误', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UNKNOWN","fields":{},"confidence":0.9,"summary":"看不懂"}',
    );

    await d.process(makeMsg({ content: '台账 ...' }), channel);

    expect(adapter.createRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('暂时不知道');
    expect(channel.lastReply).not.toContain('无法识别的操作意图');
  });
});

describe('Dispatcher.process — dedup 在 PendingAction 之前', () => {
  it('飞书重试同一 eventId 时，pending 已删除，应被 dedup 拦截不再调 LLM', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    // 模拟一次 confirm_delete 已完成的 pending（已被 delete 掉，dedup 已记录 eventId）
    // 通过先走一次 LLM 流程模拟历史
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: {} },
    ]);
    await d.process(
      makeMsg({ eventId: 'EV1', content: '删除项目 x' }),
      channel,
    );

    // 触发 confirm_delete 完成 pending
    await d.process(makeMsg({ eventId: 'EV2', content: '确认删除' }), channel);
    expect(adapter.deleteRecord).toHaveBeenCalledTimes(1);

    // 飞书重试 EV2：pending 已无、dedup 已记录 → 应该被 ignore，不再调 LLM
    mockChatCompletion.mockClear();
    await d.process(makeMsg({ eventId: 'EV2', content: '确认删除' }), channel);
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(adapter.deleteRecord).toHaveBeenCalledTimes(1); // 仍然 1 次，没有再删
  });
});

describe('Dispatcher.process — confirm_upsert 关键词收窄', () => {
  async function setupUpsertPending() {
    const d = makeDispatcher({
      ...baseTableConfig,
      uniqueKey: '项目名称',
    });
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'rExisting', fields: { 项目名称: '督导2.0' } },
    ]);
    // 首条触发唯一键冲突 → pending confirm_upsert
    await d.process(
      makeMsg({ eventId: 'first', content: '新增项目 督导2.0' }),
      channel,
    );
    return { d, channel, adapter };
  }

  it('"确认更新" 命中触发 updateRecord', async () => {
    const { d, channel, adapter } = await setupUpsertPending();
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'rExisting',
      fields: { 项目名称: '督导2.0' },
    });
    await d.process(
      makeMsg({ eventId: 'second', content: '确认更新' }),
      channel,
    );
    expect(adapter.updateRecord).toHaveBeenCalled();
  });

  it('"等下，把今天进度更新到表里" 不会被吞为 confirm_upsert', async () => {
    const { d, channel, adapter } = await setupUpsertPending();
    await d.process(
      makeMsg({
        eventId: 'second',
        content: '等下，把今天进度更新到表里',
      }),
      channel,
    );
    // 由于 pending 仍存在但关键词不匹配，应该提示用户回到原选择
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('确认更新');
  });

  it('"取消" 清掉 pending', async () => {
    const { d, channel, adapter } = await setupUpsertPending();
    await d.process(makeMsg({ eventId: 'second', content: '取消' }), channel);
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('已取消');
  });
});

describe('Dispatcher.process — 批量删除 Promise.allSettled', () => {
  it('全部成功时回复 "已删除 N 条记录"', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: {} },
      { recordId: 'r2', fields: {} },
      { recordId: 'r3', fields: {} },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    await d.process(makeMsg({ content: '删除项目 x' }), channel);
    await d.process(makeMsg({ content: '确认删除' }), channel);

    expect(adapter.deleteRecord).toHaveBeenCalledTimes(3);
    expect(channel.lastReply).toContain('已删除 3 条记录');
  });

  it('中途失败时报告成功/失败计数', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: {} },
      { recordId: 'r2', fields: {} },
      { recordId: 'r3', fields: {} },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('飞书 404'))
      .mockResolvedValueOnce(undefined);

    await d.process(makeMsg({ content: '删除项目 x' }), channel);
    await d.process(makeMsg({ content: '确认删除' }), channel);

    expect(adapter.deleteRecord).toHaveBeenCalledTimes(3);
    expect(channel.lastReply).toContain('已删除 2/3 条');
    expect(channel.lastReply).toContain('1 条失败');
  });
});

describe('Dispatcher.process — tableConfig 缺失', () => {
  it('PendingAction 期间表配置被删 → 清 pending + 给提示', async () => {
    // 第一次进入时有 config，触发 confirm_delete pending
    let config: SpreadsheetTableConfig | null = baseTableConfig;
    const d = new Dispatcher({ getTableConfig: () => config });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: {} },
    ]);
    await d.process(makeMsg({ content: '删除项目 x' }), channel);

    // 配置被删
    config = null;
    await d.process(makeMsg({ content: '确认删除' }), channel);
    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('表格配置已变更');
  });
});

describe('Dispatcher.process — 无场景兜底', () => {
  it('匹配不到任何场景时返回 help text', async () => {
    const d = new Dispatcher({ getTableConfig: () => baseTableConfig });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    // 关键词不命中、LLM 返回 none
    mockChatCompletion.mockResolvedValueOnce('none');
    await d.process(makeMsg({ content: 'foo bar' }), channel);
    expect(channel.lastReply).toContain('我可以帮你处理');
  });
});
