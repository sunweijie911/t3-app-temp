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

vi.mock('@/modules/im-bot/documents/factory', () => ({
  getDocumentAdapter: vi.fn(),
  documentConfigOf: (b: {
    provider: string;
    workspaceId: string;
    resourceId: string;
  }) => ({
    platform: b.provider,
    workspaceId: b.workspaceId,
    documentId: b.resourceId,
  }),
}));

import type { ChannelAdapter } from '@/modules/im-bot/channels/types';
import {
  DESTRUCTIVE_CONCURRENCY,
  MAX_CANDIDATE_DISPLAY,
  MAX_LLM_ATTEMPTS,
  RATE_LIMIT_MAX,
} from '@/modules/im-bot/constants';
import { MemoryDedupStore } from '@/modules/im-bot/core/dedup';
import { Dispatcher } from '@/modules/im-bot/core/dispatcher';
import { chatCompletion } from '@/modules/im-bot/core/llm';
import { MemoryPendingActionStore } from '@/modules/im-bot/core/pending-action';
import { MemoryRateLimitStore } from '@/modules/im-bot/core/rate-limit';
import type {
  BotEvent,
  ResourceBinding,
  SpreadsheetRecord,
  UnifiedMessage,
} from '@/modules/im-bot/core/types';
import { getDocumentAdapter } from '@/modules/im-bot/documents/factory';
import { DatabaseDrivenScene } from '@/modules/im-bot/scenes/db-scene';
import { getSpreadsheetAdapter } from '@/modules/im-bot/spreadsheets/factory';
import type { SpreadsheetAdapter } from '@/modules/im-bot/spreadsheets/types';

const mockChatCompletion = vi.mocked(chatCompletion);
const mockGetAdapter = vi.mocked(getSpreadsheetAdapter);
const mockGetDocAdapter = vi.mocked(getDocumentAdapter);

function makeMsg(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    platform: 'feishu',
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    messageId: 'm1',
    chatId: 'chatA',
    chatType: 'group',
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
    queryHardLimit: 1000,
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

const baseBinding: ResourceBinding = {
  alias: '项目表',
  kind: 'table',
  provider: 'feishu',
  workspaceId: 'app1',
  resourceId: 't1',
  fieldMapping: { 项目名称: '项目名称', Node版本: '项目Node' },
  isDefault: true,
};

function makeDispatcher(binding: ResourceBinding | null = baseBinding) {
  const d = new Dispatcher({
    getBinding: () => binding,
  });
  d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
  return d;
}

beforeEach(() => {
  mockChatCompletion.mockReset();
  mockGetAdapter.mockReset();
  mockGetDocAdapter.mockReset();
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
      ...baseBinding,
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
    let config: ResourceBinding | null = baseBinding;
    const d = new Dispatcher({ getBinding: () => config });
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
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    // 注册第二个场景：只剩一个候选时会跳过分类直接选它
    d.registry.register(
      new DatabaseDrivenScene({
        ...baseSceneConfig,
        sceneId: 'other',
        name: '另一个场景',
      }),
    );
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    // 关键词不命中、LLM 返回 none
    mockChatCompletion.mockResolvedValueOnce('none');
    await d.process(makeMsg({ content: 'foo bar' }), channel);
    expect(channel.lastReply).toContain('我可以帮你处理');
  });
});

describe('Dispatcher.process — 破坏性操作批量上限', () => {
  function manyRecords(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 项目名称: `p${i}` },
    }));
  }

  it('DELETE 命中超过 MAX_DESTRUCTIVE_BATCH 时直接拒绝，不挂 pending', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"p"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      manyRecords(500),
    );

    await d.process(makeMsg({ eventId: 'd1', content: '删除项目 p' }), channel);
    expect(channel.lastReply).toContain('超过单次删除上限');

    // pending 未挂起：后续"确认删除"不应触发任何删除
    await d.process(makeMsg({ eventId: 'd2', content: '确认删除' }), channel);
    expect(adapter.deleteRecord).not.toHaveBeenCalled();
  });

  it('UPDATE 命中超过上限时拒绝，不把上千条记录丢进群', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      manyRecords(500),
    );

    await d.process(makeMsg({ content: '把项目 p 的 node 改成 20' }), channel);
    expect(channel.lastReply).toContain('超过单次可操作上限');
    expect(channel.lastReply?.length).toBeLessThan(500);
  });

  it('DELETE 并发受闸门限制，不会一次性打满平台 QPS', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"p"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      manyRecords(20),
    );
    let inFlight = 0;
    let peak = 0;
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    );

    await d.process(makeMsg({ eventId: 'c1', content: '删除项目 p' }), channel);
    await d.process(makeMsg({ eventId: 'c2', content: '确认删除' }), channel);

    expect(adapter.deleteRecord).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(DESTRUCTIVE_CONCURRENCY);
    expect(channel.lastReply).toContain('已删除 20 条记录');
  });
});

describe('Dispatcher.process — 候选列表不泄漏敏感字段', () => {
  const sensitiveBinding: ResourceBinding = {
    ...baseBinding,
    fieldMapping: {
      项目名称: '项目名称',
      手机号: { name: '手机号', type: 'plain', sensitive: true },
    },
  };

  it('UPDATE 多条命中时走脱敏摘要，不再 JSON.stringify 整行', async () => {
    const d = makeDispatcher(sensitiveBinding);
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"项目名称":"新名"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'p1', 手机号: '13800138000' } },
      { recordId: 'r2', fields: { 项目名称: 'p2', 手机号: '13900139000' } },
    ]);

    await d.process(makeMsg({ content: '把项目 p 改名' }), channel);

    expect(channel.lastReply).toContain('请回复序号选择');
    expect(channel.lastReply).toContain('项目名称=p1');
    expect(channel.lastReply).not.toContain('13800138000');
    expect(channel.lastReply).toContain('已脱敏');
  });

  it('DELETE 确认提示里也列出脱敏后的记录，让用户看清删的是什么', async () => {
    const d = makeDispatcher(sensitiveBinding);
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"p1"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'p1', 手机号: '13800138000' } },
    ]);

    await d.process(makeMsg({ content: '删除项目 p1' }), channel);

    expect(channel.lastReply).toContain('确认删除以下 1 条记录');
    expect(channel.lastReply).toContain('项目名称=p1');
    expect(channel.lastReply).not.toContain('13800138000');
  });
});

describe('Dispatcher.process — filters 空值守卫', () => {
  it('UPDATE 的 filters 值全为空串时视为无筛选条件，拒绝执行', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":""},"fields":{"Node版本":"20"},"confidence":0.9,"summary":""}',
    );

    await d.process(makeMsg({ content: '改一下项目的 node 版本' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('需要指定筛选条件');
  });

  it('DELETE 的 filters 只有保留键时同样被拒绝（不落全表删除）', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"_conjunction":"or"},"confidence":0.9,"summary":""}',
    );

    await d.process(makeMsg({ content: '删掉台账' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('需要指定筛选条件');
  });
});

describe('Dispatcher — 数据平台与消息来源解耦', () => {
  it('企微群里的消息也能操作飞书多维表（adapter 按 provider 选）', async () => {
    // 回归：以前 executeCrud 用 getSpreadsheetAdapter(msg.platform)，
    // 企微群的消息只能落到企微表格 adapter（未实现，直接抛错）
    const d = makeDispatcher({ ...baseBinding, provider: 'feishu' });
    const channel = makeChannel();
    const feishuAdapter = makeAdapter();
    mockGetAdapter.mockReturnValue(feishuAdapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":""}',
    );
    (feishuAdapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '督导2.0' },
    });

    await d.process(
      makeMsg({ platform: 'wecom', content: '新增项目 督导2.0' }),
      channel,
    );

    // 用 provider('feishu') 取 adapter，而不是 msg.platform('wecom')
    expect(mockGetAdapter).toHaveBeenCalledWith('feishu');
    expect(feishuAdapter.createRecord).toHaveBeenCalled();
    expect(channel.lastReply).toContain('已录入');
  });

  it('getBinding 收到 alias 时精确解析；未指定则走默认', async () => {
    const seen: Array<string | undefined> = [];
    const d = new Dispatcher({
      getBinding: (_sceneId, alias) => {
        seen.push(alias);
        return baseBinding;
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    await d.process(makeMsg({ eventId: 'a1', content: '删除项目 x' }), channel);
    // 挂 pending 阶段未指定 alias → undefined
    expect(seen).toContain(undefined);

    seen.length = 0;
    await d.process(makeMsg({ eventId: 'a2', content: '确认删除' }), channel);
    // 确认阶段必须带上挂起时记录的 alias，避免漂到别的资源
    expect(seen).toEqual([baseBinding.alias]);
    expect(adapter.deleteRecord).toHaveBeenCalledTimes(1);
  });

  it('对 doc 资源用表格动词时提示可用动词，而不是打到表格 adapter', async () => {
    const d = makeDispatcher({ ...baseBinding, kind: 'doc' });
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      // 用 mockResolvedValue（非 Once）：这类失败会触发一次纠正重试，
      // 让模型重复同一个错误，断言的是重试用光后用户看到什么
      '{"intent":"CREATE","fields":{"项目名称":"x"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '新增项目 x' }), channel);

    expect(adapter.createRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('不支持「CREATE」');
    // 提示里要给出这个资源实际可用的动词
    expect(channel.lastReply).toContain('READ');
    expect(channel.lastReply).toContain('APPEND');
  });

  it('对 table 资源用文档动词时同样被拦住', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      // 非 Once：这类失败会触发一次纠正重试，让模型重复同一个错误，
      // 断言的是「重试用光之后用户看到什么」

      '{"intent":"APPEND","fields":{"content":"x"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '记一下项目进展' }), channel);

    expect(channel.lastReply).toContain('不支持「APPEND」');
    expect(channel.lastReply).toContain('CREATE');
  });

  it('parsed.resource 指定别名时按别名解析绑定', async () => {
    const seen: Array<string | undefined> = [];
    const d = new Dispatcher({
      getBinding: (_s, alias) => {
        seen.push(alias);
        return baseBinding;
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","resource":"周报表","fields":{"项目名称":"x"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '新增项目 x' }), channel);
    expect(seen).toContain('周报表');
  });

  it('场景没有任何资源绑定时给出可懂的提示', async () => {
    const d = makeDispatcher(null);
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"x"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '新增项目 x' }), channel);
    expect(channel.lastReply).toContain('未配置数据资源绑定');
  });
});

describe('Dispatcher — 多实例共享状态', () => {
  /** 用同一组 store 建两个 Dispatcher，模拟两个 Pod */
  function makeTwoInstances(binding: ResourceBinding | null = baseBinding) {
    const dedupStore = new MemoryDedupStore();
    const pendingStore = new MemoryPendingActionStore();
    const mk = () => {
      const d = new Dispatcher({
        getBinding: () => binding,
        dedupStore,
        pendingStore,
      });
      d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
      return d;
    };
    return { a: mk(), b: mk() };
  }

  it('平台重试打到另一个实例时被幂等拦截，不重复写入', async () => {
    // 回归：dedup 原先是每个 Dispatcher 自己的 Map，
    // 实例 B 查不到实例 A 处理过的 eventId → 同一条消息被写两次
    const { a, b } = makeTwoInstances();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":""}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '督导2.0' },
    });

    const msg = makeMsg({ eventId: 'RETRY-1', content: '新增项目 督导2.0' });
    await a.process(msg, channel);
    await b.process(msg, channel);

    expect(adapter.createRecord).toHaveBeenCalledTimes(1);
  });

  it('确认消息落到另一个实例时仍能找到 pending，正常执行删除', async () => {
    // 回归：pendingAction 原先也是进程内 Map，
    // 用户回的"确认删除"落到实例 B 会被当成新业务消息送去 LLM
    const { a, b } = makeTwoInstances();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    // 实例 A 挂起 pending
    await a.process(makeMsg({ eventId: 'd1', content: '删除项目 x' }), channel);
    expect(channel.lastReply).toContain('确认删除以下 1 条记录');

    // 确认消息打到实例 B
    mockChatCompletion.mockClear();
    await b.process(makeMsg({ eventId: 'd2', content: '确认删除' }), channel);

    expect(adapter.deleteRecord).toHaveBeenCalledTimes(1);
    expect(channel.lastReply).toContain('已删除 1 条记录');
    // 关键：不该把"确认删除"当业务消息去调 LLM
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('两个实例并发处理同一事件时只有一个抢到处理权', async () => {
    const { a, b } = makeTwoInstances();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"CREATE","fields":{"项目名称":"并发"},"confidence":0.95,"summary":""}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '并发' },
    });

    const msg = makeMsg({ eventId: 'CONCURRENT-1', content: '新增项目 并发' });
    await Promise.all([a.process(msg, channel), b.process(msg, channel)]);

    expect(adapter.createRecord).toHaveBeenCalledTimes(1);
  });
});

describe('Dispatcher — 文档能力', () => {
  const docBinding: ResourceBinding = {
    alias: '周报文档',
    kind: 'doc',
    provider: 'feishu',
    workspaceId: 'fld1',
    resourceId: 'doccn123',
    fieldMapping: {},
    isDefault: true,
  };

  function makeDocAdapter() {
    return {
      platform: 'feishu' as const,
      readDocument: vi.fn(),
      appendText: vi.fn(),
    };
  }

  it('READ：读取文档并把标题/正文/链接渲染进群消息', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    doc.readDocument.mockResolvedValue({
      title: '第 36 周周报',
      text: '本周完成督导2.0 联调',
      url: 'https://feishu.cn/docx/doccn123',
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"READ","fields":{},"confidence":0.95,"summary":"读周报"}',
    );

    await d.process(makeMsg({ content: '看下项目周报' }), channel);

    expect(doc.readDocument).toHaveBeenCalledWith({
      platform: 'feishu',
      workspaceId: 'fld1',
      documentId: 'doccn123',
    });
    expect(channel.lastReply).toContain('第 36 周周报');
    expect(channel.lastReply).toContain('本周完成督导2.0 联调');
    expect(channel.lastReply).toContain('https://feishu.cn/docx/doccn123');
  });

  it('QUERY 对文档等价于 READ（兼容现有场景习惯用 QUERY 表达查看）', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    doc.readDocument.mockResolvedValue({ title: 'T', text: 'body' });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '查下项目周报' }), channel);
    expect(doc.readDocument).toHaveBeenCalled();
    expect(channel.lastReply).toContain('T');
  });

  it('空文档给出可读占位而不是空回复', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    doc.readDocument.mockResolvedValue({ title: 'T', text: '   ' });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"READ","fields":{},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '看下项目周报' }), channel);
    expect(channel.lastReply).toContain('(文档为空)');
  });

  it('APPEND：把 fields.content 追加进文档并回显写入内容', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    doc.appendText.mockResolvedValue({
      title: '第 36 周周报',
      text: '联调完成',
      url: 'https://feishu.cn/docx/doccn123',
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"APPEND","fields":{"content":"联调完成"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '项目周报记一下 联调完成' }), channel);

    expect(doc.appendText).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doccn123' }),
      '联调完成',
    );
    expect(channel.lastReply).toContain('已写入');
    expect(channel.lastReply).toContain('联调完成');
  });

  it('APPEND 也接受 fields.text / fields.正文 作为正文来源', async () => {
    for (const key of ['text', '正文']) {
      const d = makeDispatcher(docBinding);
      const channel = makeChannel();
      const doc = makeDocAdapter();
      mockGetDocAdapter.mockReturnValue(doc);
      doc.appendText.mockResolvedValue({ title: 'T', text: 'v' });
      mockChatCompletion.mockResolvedValueOnce(
        `{"intent":"APPEND","fields":{"${key}":"内容 v"},"confidence":0.95,"summary":""}`,
      );
      await d.process(
        makeMsg({ eventId: `k-${key}`, content: '项目周报记一下' }),
        channel,
      );
      expect(doc.appendText).toHaveBeenCalledWith(expect.anything(), '内容 v');
    }
  });

  it('APPEND 但没解析出正文时不调 adapter，给出引导', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"APPEND","fields":{},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '项目周报记一下' }), channel);

    expect(doc.appendText).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('没有解析出要写入文档的内容');
  });

  it('文档 adapter 按 provider 选（跨平台同样成立）', async () => {
    const d = makeDispatcher(docBinding);
    const channel = makeChannel();
    const doc = makeDocAdapter();
    mockGetDocAdapter.mockReturnValue(doc);
    doc.readDocument.mockResolvedValue({ title: 'T', text: 'b' });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"READ","fields":{},"confidence":0.95,"summary":""}',
    );

    // 消息来自钉钉，文档在飞书
    await d.process(
      makeMsg({ platform: 'dingtalk', content: '看下项目周报' }),
      channel,
    );
    expect(mockGetDocAdapter).toHaveBeenCalledWith('feishu');
  });
});

describe('Dispatcher — 场景匹配失败与 LLM 故障要区分开', () => {
  it('LLM 说"none" → 回 help 文本，记 ignored', async () => {
    const events: Array<{ result?: string; errorMsg?: string }> = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    d.registry.register(
      new DatabaseDrivenScene({
        ...baseSceneConfig,
        sceneId: 'other',
        name: '另一个场景',
      }),
    );
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    mockChatCompletion.mockResolvedValueOnce('none');

    await d.process(makeMsg({ content: '完全无关的闲聊' }), channel);

    expect(channel.lastReply).toContain('我可以帮你处理');
    expect(events[0]?.result).toBe('ignored');
    expect(events[0]?.errorMsg).toBeUndefined();
  });

  it('LLM 调不通 → 明说服务不可用，并把原因记进审计日志', async () => {
    // 回归：以前 matchByLLM 吞掉异常返回 null，用户收到的是
    // "我可以帮你处理以下业务"，日志记成 ignored 且 errorMsg 为空
    const events: Array<{ result?: string; errorMsg?: string }> = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    d.registry.register(
      new DatabaseDrivenScene({
        ...baseSceneConfig,
        sceneId: 'other',
        name: '另一个场景',
      }),
    );
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    mockChatCompletion.mockRejectedValueOnce(new Error('Connection error.'));

    await d.process(makeMsg({ content: '完全无关的闲聊' }), channel);

    expect(channel.lastReply).toContain('语义识别服务暂时不可用');
    expect(channel.lastReply).not.toContain('我可以帮你处理');
    expect(events[0]?.result).toBe('error');
    expect(events[0]?.errorMsg).toBe('Connection error.');
  });

  it('关键词命中时不受 LLM 故障影响（不走 matchByLLM）', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: 'x' },
    });
    // 只 mock 一次：意图解析用掉它；若还去调 matchByLLM 就会拿到 undefined
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"x"},"confidence":0.95,"summary":""}',
    );

    await d.process(makeMsg({ content: '新增项目 x' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(adapter.createRecord).toHaveBeenCalled();
  });
});

describe('Dispatcher — 二次确认记 pending 而不是 error', () => {
  function withEvents(binding: ResourceBinding | null = baseBinding) {
    const events: Array<{ result?: string; intent?: string }> = [];
    const d = new Dispatcher({
      getBinding: () => binding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return { d, events };
  }

  it('DELETE 挂起确认 → pending', async () => {
    // 回归：原先记 error，导致每次删除都把统计面板的错误率顶上去
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);

    await d.process(makeMsg({ content: '删除项目 x' }), channel);
    expect(events[0]?.result).toBe('pending');
    expect(events[0]?.intent).toBe('DELETE');
  });

  it('单条 UPDATE 挂起确认 → pending', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"x"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);

    await d.process(makeMsg({ content: '把项目 x 改一下' }), channel);
    expect(events[0]?.result).toBe('pending');
  });

  it('uniqueKey 撞车挂起确认 → pending', async () => {
    const { d, events } = withEvents({ ...baseBinding, uniqueKey: '项目名称' });
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"x"},"confidence":0.95,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);

    await d.process(makeMsg({ content: '新增项目 x' }), channel);
    expect(events[0]?.result).toBe('pending');
  });

  it('多条命中挂起选择 → pending', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"x"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'x1' } },
      { recordId: 'r2', fields: { 项目名称: 'x2' } },
    ]);

    await d.process(makeMsg({ content: '把项目 x 改一下' }), channel);
    expect(events[0]?.result).toBe('pending');
  });

  it('真正的失败仍记 error（超批量上限）', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Array.from({ length: 500 }, (_, i) => ({
        recordId: `r${i}`,
        fields: {},
      })),
    );

    await d.process(makeMsg({ content: '删除项目 x' }), channel);
    expect(events[0]?.result).toBe('error');
  });

  it('成功执行仍记 success', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.9,"summary":""}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [],
    );

    await d.process(makeMsg({ content: '查询项目 x' }), channel);
    expect(events[0]?.result).toBe('success');
  });
});

describe('Dispatcher — 未知字段守卫', () => {
  it('CREATE：丢掉 fieldMapping 里没有的字段，其余照写并在回复里点名', async () => {
    // 回归：adapter 用 `fieldMapping[key] ?? key` 原名透传未知字段，
    // 飞书回 InvalidFieldName —— 整条 CREATE 失败，用户只看到一句笼统报错
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0","星座":"处女座"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '督导2.0' },
    });

    await d.process(makeMsg({ content: '新增项目 督导2.0' }), channel);

    expect(adapter.createRecord).toHaveBeenCalledWith(expect.anything(), {
      项目名称: '督导2.0',
    });
    expect(channel.lastReply).toContain('已忽略未配置的字段：星座');
  });

  it('CREATE：字段全是未知的 → 不调 adapter，提示可用字段', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      // 非 Once：这类失败会触发一次纠正重试，让模型重复同一个错误，
      // 断言的是「重试用光之后用户看到什么」

      '{"intent":"CREATE","fields":{"星座":"处女座"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(makeMsg({ content: '新增项目' }), channel);

    expect(adapter.createRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('星座');
    expect(channel.lastReply).toContain('项目名称');
  });

  it('QUERY：未知筛选字段直接报错，绝不静默放宽查询范围', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      // 非 Once：这类失败会触发一次纠正重试，让模型重复同一个错误，
      // 断言的是「重试用光之后用户看到什么」

      '{"intent":"QUERY","filters":{"星座":"处女座"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('星座');
  });

  it('DELETE：未知筛选字段被拒，不会退化成"无筛选条件"后命中全表', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"星座":"处女座"},"confidence":0.95,"summary":"删"}',
    );

    await d.process(makeMsg({ content: '删除项目' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(adapter.deleteRecord).not.toHaveBeenCalled();
  });

  it('保留键 _conjunction 不会被当成未知字段', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"a","_conjunction":"or"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目' }), channel);

    expect(adapter.queryRecords).toHaveBeenCalledWith(expect.anything(), {
      项目名称: 'a',
      _conjunction: 'or',
    });
  });

  it('绑定没配 fieldMapping 时整体透传（不把这条绑定的写入全禁掉）', async () => {
    const d = makeDispatcher({ ...baseBinding, fieldMapping: {} });
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"随便什么字段":"v"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });

    await d.process(makeMsg({ content: '新增项目' }), channel);

    expect(adapter.createRecord).toHaveBeenCalledWith(expect.anything(), {
      随便什么字段: 'v',
    });
  });
});

describe('Dispatcher — 候选序号与操作人字段', () => {
  it('select_record 只把展示出来的候选存进 pending（序号不会越界到没见过的记录）', async () => {
    // 回归：候选存全量(≤20)、只列前 10 条，用户回 15 就能更新一条自己没见过的记录
    const pendingStore = new MemoryPendingActionStore();
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
      dedupStore: new MemoryDedupStore(),
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const many = Array.from({ length: 15 }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 项目名称: `p${i}` },
    }));
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue(many);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":""}',
    );

    const msg = makeMsg({ content: '把项目 p 的 Node 版本改成 20' });
    await d.process(msg, channel);

    const pending = await pendingStore.get({
      platform: msg.platform,
      chatId: msg.chatId,
      senderId: msg.senderId,
    });
    // candidates 存全量（「全部更新」要用），但可选序号只到展示出来的条数
    expect(pending?.candidates).toHaveLength(15);
    expect(pending?.selectableCount).toBe(MAX_CANDIDATE_DISPLAY);
    expect(channel.lastReply).toContain(
      `共 15 条，仅列出前 ${MAX_CANDIDATE_DISPLAY} 条`,
    );

    // 真正要守住的性质：回一个没展示过的序号必须被拒
    await d.process(makeMsg({ content: '15' }), channel);
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('请回复序号');

    // 展示范围内的序号照常生效
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r9',
      fields: { 项目名称: 'p9', Node版本: '20' },
    });
    await d.process(makeMsg({ content: '10' }), channel);
    expect(adapter.updateRecord).toHaveBeenCalledWith(expect.anything(), 'r9', {
      Node版本: '20',
    });
  });

  it('操作人字段用中文键名（录入人）时也会注入发送者', async () => {
    // 回归：以前只认字面的 'operator'，而字段选择器生成的逻辑键就是中文字段名，
    // 于是表里明明有「录入人」列，机器人却从来不写
    const d = makeDispatcher({
      ...baseBinding,
      fieldMapping: { 项目名称: '项目名称', 录入人: '录入人' },
    });
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });

    await d.process(
      makeMsg({ content: '新增项目 督导2.0', senderName: '李四' }),
      channel,
    );

    expect(adapter.createRecord).toHaveBeenCalledWith(expect.anything(), {
      项目名称: '督导2.0',
      录入人: '李四',
    });
  });

  it('没有任何操作人字段时不注入（避免写未知字段整条失败）', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });

    await d.process(makeMsg({ content: '新增项目 督导2.0' }), channel);

    expect(adapter.createRecord).toHaveBeenCalledWith(expect.anything(), {
      项目名称: '督导2.0',
    });
  });
});

describe('Dispatcher — 审计事件', () => {
  it('resultData 只存摘要，不落记录字段原文', async () => {
    // 回归：以前把整个 ExecuteResult 塞进 jsonb —— 一次 QUERY 上千条记录的
    // 字段原文进库，且脱敏只作用于 IM 回复层，等于把数据明文又存了一份
    const events: Array<{ resultData?: unknown }> = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        recordId: 'r1',
        fields: { 项目名称: '督导2.0', 手机号: '13800138000' },
      },
    ]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 督导2.0' }), channel);

    const logged = events.at(-1)?.resultData as Record<string, unknown>;
    expect(logged).toMatchObject({
      success: true,
      recordCount: 1,
      recordIds: ['r1'],
    });
    // 字段原文一律不进日志
    expect(JSON.stringify(logged)).not.toContain('13800138000');
    expect(JSON.stringify(logged)).not.toContain('督导2.0');
  });

  it('onEvent 返回 Promise 时会被等待（serverless 上不 await 会丢日志）', async () => {
    let settled = false;
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: async () => {
        await new Promise((r) => setTimeout(r, 10));
        settled = true;
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 x' }), channel);

    expect(settled).toBe(true);
  });

  it('审计回调抛错不影响用户流程，也不会被当成业务错误再记一次', async () => {
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: () => {
        throw new Error('日志库挂了');
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.95,"summary":"查"}',
    );

    await expect(
      d.process(makeMsg({ content: '查项目 x' }), channel),
    ).resolves.toBeUndefined();
    expect(channel.lastReply).not.toContain('服务暂时繁忙');
  });
});

describe('Dispatcher — 字段清单注入 prompt', () => {
  it('把绑定的字段清单喂给 LLM（不再依赖管理员手抄）', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 x' }), channel);

    const systemPrompt = mockChatCompletion.mock.calls.at(-1)?.[0] ?? '';
    expect(systemPrompt).toContain('可操作的资源与字段');
    expect(systemPrompt).toContain('项目名称');
    expect(systemPrompt).toContain('Node版本');
    expect(systemPrompt).toContain('CREATE / UPDATE / QUERY / DELETE');
  });

  it('listBindings 提供多资源时，prompt 里列出全部并说明怎么选', async () => {
    const docBinding: ResourceBinding = {
      alias: '周报文档',
      kind: 'doc',
      provider: 'feishu',
      workspaceId: '',
      resourceId: 'doc1',
      fieldMapping: {},
      isDefault: false,
    };
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      listBindings: () => [baseBinding, docBinding],
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 x' }), channel);

    const systemPrompt = mockChatCompletion.mock.calls.at(-1)?.[0] ?? '';
    expect(systemPrompt).toContain('周报文档');
    expect(systemPrompt).toContain('用 resource 字段');
    expect(systemPrompt).toContain('fields.content');
  });
});

describe('Dispatcher — 场景作用域与写权限', () => {
  function sceneWith(access: {
    allowedChatIds?: string[];
    writerIds?: string[];
  }) {
    return new DatabaseDrivenScene({ ...baseSceneConfig, ...access });
  }

  it('会话不在白名单时场景不可见：不匹配、不进 LLM、也不列进帮助文本', async () => {
    // 回归：以前没有作用域，机器人被拉进第二个群，那个群立刻能全量 CRUD
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(sceneWith({ allowedChatIds: ['chatB'] }));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);

    await d.process(
      makeMsg({ chatId: 'chatA', content: '新增项目 督导2.0' }),
      channel,
    );

    expect(adapter.createRecord).not.toHaveBeenCalled();
    // 场景被过滤在匹配之前：连意图解析的 LLM 都不该被调用
    expect(mockChatCompletion).not.toHaveBeenCalled();
    // 场景名不该泄漏给未授权的群
    expect(channel.lastReply).toContain('当前没有可用的业务场景');
    expect(channel.lastReply).not.toContain(baseSceneConfig.name);
  });

  it('会话在白名单时正常工作', async () => {
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(sceneWith({ allowedChatIds: ['chatA'] }));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(
      makeMsg({ chatId: 'chatA', content: '新增项目 督导2.0' }),
      channel,
    );

    expect(adapter.createRecord).toHaveBeenCalled();
  });

  it('不在可写名单的用户能查询', async () => {
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(sceneWith({ writerIds: ['boss'] }));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","filters":{"项目名称":"x"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ senderId: 'uX', content: '查项目 x' }), channel);

    expect(adapter.queryRecords).toHaveBeenCalled();
  });

  it('不在可写名单的用户不能删除，且拦在调用平台之前', async () => {
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(sceneWith({ writerIds: ['boss'] }));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );

    await d.process(
      makeMsg({ senderId: 'uX', content: '删除项目 x' }),
      channel,
    );

    // 连 queryRecords 都不该发生 —— 拦在真正落库和平台调用之前
    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('写入权限');
  });

  it('写权限在待确认窗口内被撤销时，确认动作作废', async () => {
    const pendingStore = new MemoryPendingActionStore();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);

    // 第一步：有权限时挂起删除确认
    const allowed = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
    });
    allowed.registry.register(sceneWith({}));
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );
    await allowed.process(makeMsg({ content: '删除项目 x' }), channel);

    // 第二步：管理员改了白名单（新的 dispatcher 实例 = 配置已重载）
    const revoked = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
    });
    revoked.registry.register(sceneWith({ writerIds: ['boss'] }));
    await revoked.process(makeMsg({ content: '确认删除' }), channel);

    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('权限已变更');
  });
});

describe('Dispatcher — 序号选择必须是整条消息（P0：宽松 parseInt 会劫持业务消息）', () => {
  /** 挂起一个 3 条候选的 select_record，返回共享 pending 的 dispatcher */
  async function pendingSelect(
    adapter: SpreadsheetAdapter,
    channel: ReturnType<typeof makeChannel>,
  ) {
    const pendingStore = new MemoryPendingActionStore();
    const d = new Dispatcher({ getBinding: () => baseBinding, pendingStore });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { recordId: 'r1', fields: { 项目名称: 'A1' } },
      { recordId: 'r2', fields: { 项目名称: 'A2' } },
      { recordId: 'r3', fields: { 项目名称: 'A3' } },
    ]);
    await d.process(
      makeMsg({ content: '把项目 A 的 Node版本 改成 20' }),
      channel,
    );
    expect(channel.lastReply).toContain('请回复序号');
    return d;
  }

  it('以数字开头的业务消息不再被当成选序号', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = await pendingSelect(adapter, channel);

    await d.process(makeMsg({ content: '2条记录都改成完成' }), channel);

    // 既不能更新任何记录，也要把用户拉回选择流程
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('请回复序号(1~3)选择');
  });

  it('纯序号与「第2条」写法仍然生效', async () => {
    for (const content of ['2', '第2条']) {
      const channel = makeChannel();
      const adapter = makeAdapter();
      mockGetAdapter.mockReturnValue(adapter);
      (adapter.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
        recordId: 'r2',
        fields: { 项目名称: 'A2' },
      });
      const d = await pendingSelect(adapter, channel);

      await d.process(makeMsg({ content }), channel);

      expect(adapter.updateRecord).toHaveBeenCalledWith(
        expect.anything(),
        'r2',
        { Node版本: '20' },
      );
    }
  });

  it('超出候选范围的序号不执行更新', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = await pendingSelect(adapter, channel);

    await d.process(makeMsg({ content: '9' }), channel);

    expect(adapter.updateRecord).not.toHaveBeenCalled();
  });
});

describe('Dispatcher — UPDATE 必须带变更字段（P0：空 fields 会发出空写请求）', () => {
  it('只给筛选不给字段 → 直接拒绝，不查表也不挂确认', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );

    await d.process(makeMsg({ content: '更新项目 A' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('没有解析出要更新成什么');
  });

  it('字段全是未知字段 → 点名未知字段并列出可用字段', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValue(
      // 非 Once：这类失败会触发一次纠正重试，让模型重复同一个错误，
      // 断言的是「重试用光之后用户看到什么」

      '{"intent":"UPDATE","fields":{"负责人":"张三"},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );

    await d.process(makeMsg({ content: '把项目 A 的负责人改成张三' }), channel);

    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('负责人');
    expect(channel.lastReply).toContain('项目名称');
  });
});

describe('Dispatcher — 待确认期间场景失效必须 fail-closed（P0：写权限复查被短路）', () => {
  it('场景被停用后，确认删除不再执行', async () => {
    const pendingStore = new MemoryPendingActionStore();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);

    const before = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
    });
    before.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    await before.process(makeMsg({ content: '删除项目 x' }), channel);
    expect(channel.lastReply).toContain('确认删除');

    // 管理员停用了场景：新实例的 registry 里没有它，但 pending 还在
    const after = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
    });
    await after.process(makeMsg({ content: '确认删除' }), channel);

    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('场景配置已变更');
  });
});

describe('Dispatcher — 查询截断由 adapter 上报（P0：钉钉/企微过滤后条数恒不达上限）', () => {
  /** 模拟钉钉/企微：拉取阶段撞上翻页上限，过滤后只剩少量记录 */
  function truncatingAdapter(records: SpreadsheetRecord[]): SpreadsheetAdapter {
    const adapter = makeAdapter();
    (adapter as { queryHardLimit: number }).queryHardLimit = 5000;
    Object.assign(adapter, {
      queryRecordsWithMeta: vi.fn(async () => ({ records, truncated: true })),
      queryRecords: vi.fn(async () => records),
    });
    return adapter;
  }

  it('QUERY：过滤后只剩 1 条也要提示可能不完整', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = truncatingAdapter([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    expect(adapter.queryRecordsWithMeta).toHaveBeenCalled();
    expect(channel.lastReply).toContain('数据量已达单次拉取上限');
  });

  it('DELETE：命中集可能不全时，确认提示里要说明', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = truncatingAdapter([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"A"},"confidence":0.95,"summary":"删"}',
    );

    await d.process(makeMsg({ content: '删除项目 A' }), channel);

    expect(channel.lastReply).toContain('确认删除');
    expect(channel.lastReply).toContain('未列出的匹配记录');
  });

  it('adapter 没实现 queryRecordsWithMeta 时退化为旧判据', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    // queryHardLimit 是 1000，返回 1000 条即视为撞上上限
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({
        recordId: `r${i}`,
        fields: { 项目名称: `A${i}` },
      })),
    );
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查所有项目' }), channel);

    expect(channel.lastReply).toContain('数据量已达单次拉取上限');
  });
});

describe('Dispatcher — 确认后的执行失败要记进审计（P2：一律记 success）', () => {
  /** 走完 DELETE 挂起确认，返回共享 pending 的 dispatcher 与审计事件数组 */
  async function pendingDelete(
    adapter: SpreadsheetAdapter,
    channel: ReturnType<typeof makeChannel>,
  ) {
    const events: BotEvent[] = [];
    const pendingStore = new MemoryPendingActionStore();
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    await d.process(makeMsg({ content: '删除项目 x' }), channel);
    return { d, events };
  }

  it('批量删除全部失败 → 审计记 error 并带上原因', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const { d, events } = await pendingDelete(adapter, channel);

    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('平台 429'),
    );
    await d.process(makeMsg({ content: '确认删除' }), channel);

    // 用户看到的是部分成功的实况
    expect(channel.lastReply).toContain('已删除 0/1 条');
    // 审计不能记成功，否则错误率统计漏掉真正失败的破坏性操作
    const last = events.at(-1);
    expect(last?.result).toBe('error');
    expect(last?.errorMsg).toContain('平台 429');
  });

  it('删除成功仍记 success', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const { d, events } = await pendingDelete(adapter, channel);

    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    await d.process(makeMsg({ content: '确认删除' }), channel);

    expect(channel.lastReply).toContain('已删除 1 条');
    expect(events.at(-1)?.result).toBe('success');
    expect(events.at(-1)?.errorMsg).toBeUndefined();
  });

  it('无法识别的输入仍记 ignored 并保留 pending', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const { d, events } = await pendingDelete(adapter, channel);

    await d.process(makeMsg({ content: '嗯' }), channel);

    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(events.at(-1)?.result).toBe('ignored');
    expect(channel.lastReply).toContain('确认删除');
  });
});

describe('Dispatcher — 无效筛选项要剔除而不是只不计数（P2）', () => {
  it('QUERY：空串占位的筛选键不下发给平台', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A","Node版本":""},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    // 带上 Node版本:'' 的话平台会收到 `is ['']`，结果恒为空
    expect(adapter.queryRecords).toHaveBeenCalledWith(expect.anything(), {
      项目名称: 'A',
    });
  });

  it('保留键仍然透传（_conjunction 是协议的一部分）', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A","_conjunction":"or","Node版本":"*"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    expect(adapter.queryRecords).toHaveBeenCalledWith(expect.anything(), {
      项目名称: 'A',
      _conjunction: 'or',
    });
  });

  it('DELETE：筛选项全是空值 → 拒绝，不查表', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":""},"confidence":0.95,"summary":"删"}',
    );

    await d.process(makeMsg({ content: '删除项目' }), channel);

    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('需要指定筛选条件');
  });
});

describe('Dispatcher — 能力层抛出的错要说给用户（P2）', () => {
  it('adapter 抛错时回复原因，而不是"服务暂时繁忙"', async () => {
    const events: BotEvent[] = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(
        '筛选条件「上线日期」是一个区间（需要「且」），无法与「或」条件混用',
      ),
    );
    mockChatCompletion.mockResolvedValue(
      // 非 Once：这类失败会触发一次纠正重试，让模型重复同一个错误，
      // 断言的是「重试用光之后用户看到什么」

      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    expect(channel.lastReply).toContain('无法与「或」条件混用');
    expect(channel.lastReply).not.toContain('服务暂时繁忙');
    expect(events.at(-1)?.result).toBe('error');
  });

  it('文档能力未实现的平台：回复 adapter 给的原因', async () => {
    const docBinding: ResourceBinding = {
      ...baseBinding,
      kind: 'doc',
      provider: 'dingtalk',
      fieldMapping: {},
    };
    const d = new Dispatcher({ getBinding: () => docBinding });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    const channel = makeChannel();
    mockGetDocAdapter.mockReturnValue({
      platform: 'dingtalk',
      readDocument: vi.fn(async () => {
        throw new Error('钉钉文档适配器尚未实现');
      }),
      appendText: vi.fn(),
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"READ","fields":{},"confidence":0.95,"summary":"读"}',
    );

    await d.process(makeMsg({ content: '看下项目周报' }), channel);

    expect(channel.lastReply).toContain('钉钉文档适配器尚未实现');
    expect(channel.lastReply).not.toContain('服务暂时繁忙');
  });
});

describe('Dispatcher — 协议保留键不能进写入字段（P2）', () => {
  it('CREATE：_conjunction 被静默丢弃，不当成未知字段回显', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: 'A' },
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"A","_conjunction":"or"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(makeMsg({ content: '新增项目 A' }), channel);

    // 透传下去会被 adapter 当平台列名，飞书直接 InvalidFieldName、整条失败
    expect(adapter.createRecord).toHaveBeenCalledWith(expect.anything(), {
      项目名称: 'A',
    });
    // 协议键不是用户说的字段，不该出现在"已忽略未配置的字段"里
    expect(channel.lastReply).not.toContain('_conjunction');
  });

  it('CREATE：只有保留键时按"没有可写入内容"拒绝', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"_conjunction":"or"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(makeMsg({ content: '新增项目' }), channel);

    expect(adapter.createRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('没有解析出要写入的字段');
  });
});

describe('Dispatcher — 审计要能还原"LLM 解析出了什么"（观测）', () => {
  function withEvents() {
    const events: BotEvent[] = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return { d, events };
  }

  it('QUERY：记下筛选键与操作符、投影列、置信度', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":{"op":"contains","value":"A"},"Node版本":"20","_conjunction":"or"},"projectFields":["Node版本"],"confidence":0.88,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    const req = (
      events.at(-1)?.resultData as { request?: Record<string, unknown> }
    )?.request;
    // 回归：以前只记结果 —— 一条 QUERY 回了 99 条，看不出是筛选真的命中全表，
    // 还是 filters 被解析成空导致的全表扫描
    expect(req).toEqual({
      confidence: 0.88,
      filters: { 项目名称: 'contains', Node版本: 'is', _conjunction: 'or' },
      projectFields: ['Node版本'],
    });
  });

  it('置信度不足时也记下解析出的内容（最需要看的那种情形）', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    mockGetAdapter.mockReturnValue(makeAdapter());
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{},"confidence":0.3,"summary":"不确定"}',
    );

    await d.process(makeMsg({ content: '项目 改一下' }), channel);

    const data = events.at(-1)?.resultData as {
      request?: { confidence?: number; fieldKeys?: string[] };
    };
    expect(data.request?.confidence).toBe(0.3);
    expect(data.request?.fieldKeys).toEqual(['Node版本']);
  });

  it('不记筛选值与写入值（原文已在 content 列，避免多落一份）', async () => {
    const { d, events } = withEvents();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: {},
    });
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"绝密项目"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(makeMsg({ content: '新增项目 绝密项目' }), channel);

    expect(JSON.stringify(events.at(-1)?.resultData)).not.toContain('绝密项目');
  });
});

describe('Dispatcher — 二次确认执行后要留痕（观测）', () => {
  it('确认删除：记 intent=DELETE 与删掉的 recordId', async () => {
    const events: BotEvent[] = [];
    const pendingStore = new MemoryPendingActionStore();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
      { recordId: 'r2', fields: { 项目名称: 'x' } },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    await d.process(makeMsg({ content: '删除项目 x' }), channel);

    await d.process(makeMsg({ content: '确认删除' }), channel);

    const last = events.at(-1);
    // 回归：以前这条路径只有一个 success，删了哪几条完全没有记录
    expect(last?.intent).toBe('DELETE');
    expect(last?.resultData).toEqual({
      pendingType: 'confirm_delete',
      deleted: 2,
      recordIds: ['r1', 'r2'],
    });
  });

  it('选序号更新：记下选了第几条、改了哪些字段', async () => {
    const events: BotEvent[] = [];
    const pendingStore = new MemoryPendingActionStore();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A1' } },
      { recordId: 'r2', fields: { 项目名称: 'A2' } },
    ]);
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r2',
      fields: {},
    });
    await d.process(
      makeMsg({ content: '把项目 A 的 Node版本 改成 20' }),
      channel,
    );

    await d.process(makeMsg({ content: '2' }), channel);

    const last = events.at(-1);
    expect(last?.intent).toBe('UPDATE');
    expect(last?.resultData).toEqual({
      pendingType: 'select_record',
      picked: 2,
      candidateCount: 2,
      recordId: 'r2',
      fieldKeys: ['Node版本'],
    });
  });

  it('取消也留痕，区别于"没识别"', async () => {
    const events: BotEvent[] = [];
    const pendingStore = new MemoryPendingActionStore();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"DELETE","filters":{"项目名称":"x"},"confidence":0.95,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'x' } },
    ]);
    await d.process(makeMsg({ content: '删除项目 x' }), channel);

    await d.process(makeMsg({ content: '取消' }), channel);

    expect(adapter.deleteRecord).not.toHaveBeenCalled();
    expect(events.at(-1)?.resultData).toEqual({
      pendingType: 'confirm_delete',
      aborted: '用户取消',
    });
  });
});

describe('Dispatcher — 确认后写操作失败时的表现（回归）', () => {
  /** 建一个带审计与共享 pending 的 dispatcher */
  function makeAuditedDispatcher(events: BotEvent[]) {
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return d;
  }

  it('confirm_update：adapter 抛错时给出具体原因，而不是"服务暂时繁忙"', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedDispatcher(events);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    await d.process(makeMsg({ content: '把 A 的 Node 版本改成 20' }), channel);
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('飞书 Bitable API 错误: FieldNameNotFound'),
    );

    await d.process(makeMsg({ content: '确认更新' }), channel);

    // 回归：以前异常逃出 handlePendingAction，被兜底 catch 压成一句
    // "服务暂时繁忙，请稍后再试"，用户以为是临时抖动
    expect(channel.lastReply).toContain('更新失败');
    expect(channel.lastReply).toContain('FieldNameNotFound');
    expect(channel.lastReply).not.toContain('服务暂时繁忙');

    const last = events.at(-1);
    // 回归：以前走外层 catch，sceneId / intent / pendingType 全丢
    expect(last?.result).toBe('error');
    expect(last?.sceneId).toBe(baseSceneConfig.sceneId);
    expect(last?.intent).toBe('UPDATE');
    expect(last?.resultData).toMatchObject({
      pendingType: 'confirm_update',
      recordId: 'r1',
      failed: true,
    });
  });

  it('select_record：选中的那条写失败同样留痕', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedDispatcher(events);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{"项目名称":"A"},"confidence":0.95,"summary":"改"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
      { recordId: 'r2', fields: { 项目名称: 'A' } },
    ]);
    await d.process(makeMsg({ content: '把 A 改一下' }), channel);
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('权限不足'),
    );

    await d.process(makeMsg({ content: '2' }), channel);

    expect(channel.lastReply).toContain('更新失败');
    expect(channel.lastReply).toContain('权限不足');
    const last = events.at(-1);
    expect(last?.result).toBe('error');
    expect(last?.intent).toBe('UPDATE');
    expect(last?.resultData).toMatchObject({
      pendingType: 'select_record',
      picked: 2,
      recordId: 'r2',
      failed: true,
    });
  });

  it('confirm_upsert 强制新建：创建失败留痕，且成功时仍记新 recordId', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const binding: ResourceBinding = { ...baseBinding, uniqueKey: '项目名称' };
    const d = new Dispatcher({
      getBinding: () => binding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"A"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    await d.process(makeMsg({ content: '新增项目 A' }), channel);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('配额不足'),
    );

    await d.process(makeMsg({ content: '强制新建' }), channel);

    expect(channel.lastReply).toContain('新建失败');
    expect(channel.lastReply).toContain('配额不足');
    const last = events.at(-1);
    expect(last?.result).toBe('error');
    expect(last?.intent).toBe('CREATE');
    expect(last?.resultData).toMatchObject({
      pendingType: 'confirm_upsert',
      forced: true,
      failed: true,
    });
  });

  it('确认成功时行为不变：CREATE 记新建的 recordId', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const binding: ResourceBinding = { ...baseBinding, uniqueKey: '项目名称' };
    const d = new Dispatcher({
      getBinding: () => binding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"CREATE","fields":{"项目名称":"A"},"confidence":0.95,"summary":"新增"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    await d.process(makeMsg({ content: '新增项目 A' }), channel);
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'rNew',
      fields: { 项目名称: 'A' },
    });

    await d.process(makeMsg({ content: '强制新建' }), channel);

    const last = events.at(-1);
    expect(last?.result).toBe('success');
    expect(last?.resultData).toMatchObject({
      forced: true,
      recordId: 'rNew',
    });
  });
});

describe('Dispatcher — 投影字段按 fieldMapping 裁剪（回归）', () => {
  it('幻觉的投影字段被点名，并退回整行渲染', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"projectFields":["毛利率"],"confidence":0.95,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '18' } },
    ]);

    await d.process(makeMsg({ content: '查项目 A 的毛利率' }), channel);

    // 回归：以前直接拿去渲染，输出「A → （该字段为空）」，
    // 用户会以为表里有"毛利率"这一列且没值
    expect(channel.lastReply).toContain('毛利率');
    expect(channel.lastReply).toContain('不是该资源里的字段');
    expect(channel.lastReply).not.toContain('（该字段为空）');
    // 全部无效 → 退回整行渲染，措辞要说清这一点
    expect(channel.lastReply).toContain('已按全部字段展示');
    expect(channel.lastReply).toContain('Node版本');
  });

  it('部分有效时只保留有效的那些，仍然点名无效的', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"projectFields":["Node版本","毛利率"],"confidence":0.95,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '18' } },
    ]);

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    expect(channel.lastReply).toContain('Node版本：18');
    expect(channel.lastReply).toContain('不是该资源里的字段');
    // 部分有效 → 只忽略无效的那几个，不能说成"已按全部字段展示"
    expect(channel.lastReply).toContain('已忽略');
    expect(channel.lastReply).not.toContain('已按全部字段展示');
  });

  it('全部有效时不产生任何提示', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"projectFields":["Node版本"],"confidence":0.95,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '18' } },
    ]);

    await d.process(makeMsg({ content: '查项目 A 的 Node 版本' }), channel);

    expect(channel.lastReply).not.toContain('不是该资源里的字段');
  });

  it('单条单投影字段撞上拉取上限时必须带截断警告', async () => {
    const d = makeDispatcher();
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    // queryRecordsWithMeta 上报 truncated
    (
      adapter as unknown as { queryRecordsWithMeta: ReturnType<typeof vi.fn> }
    ).queryRecordsWithMeta = vi.fn(async () => ({
      records: [{ recordId: 'r1', fields: { 项目名称: 'A', Node版本: '18' } }],
      truncated: true,
    }));
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"projectFields":["Node版本"],"confidence":0.95,"summary":"查"}',
    );

    await d.process(makeMsg({ content: '查项目 A 的 Node 版本' }), channel);

    // 回归：这条路径以前直接 return，把"结果可能不完整"的警告丢了
    expect(channel.lastReply).toContain('上限');
  });
});

describe('Dispatcher — 失败后让 LLM 纠正重试', () => {
  function makeAuditedD(events: BotEvent[], binding = baseBinding) {
    const d = new Dispatcher({
      getBinding: () => binding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return d;
  }

  it('字段名写错 → 第二次改对 → 用户只看到成功', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    // 第一次用了不存在的「星座」，第二次改成合法字段
    mockChatCompletion
      .mockResolvedValueOnce(
        '{"intent":"CREATE","fields":{"星座":"处女座"},"confidence":0.95,"summary":"新增"}',
      )
      .mockResolvedValueOnce(
        '{"intent":"CREATE","fields":{"项目名称":"督导2.0"},"confidence":0.95,"summary":"新增"}',
      );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: '督导2.0' },
    });

    await d.process(makeMsg({ content: '新增项目 督导2.0' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(channel.lastReply).toContain('已录入');
    // 第二次调用必须带上纠正上下文（上次输出 + 失败原因）
    expect(mockChatCompletion.mock.calls[1]?.[2]).toMatchObject({
      previousOutput: expect.stringContaining('星座'),
      error: expect.stringContaining('星座'),
    });
    const last = events.at(-1);
    expect(last?.result).toBe('success');
    // 留痕：看得出这条是重试之后才成的
    expect(last?.resultData).toMatchObject({ attempts: 2 });
  });

  it('平台回 InvalidFilter 也会重试（今天线上那三条的形状）', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion
      .mockResolvedValueOnce(
        '{"intent":"QUERY","fields":{},"filters":{"项目名称":{"op":"乱写","value":["A","B"]}},"confidence":0.9,"summary":"查"}',
      )
      .mockResolvedValueOnce(
        '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"查"}',
      );
    (adapter.queryRecords as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('飞书 Bitable API 错误: InvalidFilter'))
      .mockResolvedValueOnce([{ recordId: 'r1', fields: { 项目名称: 'A' } }]);

    await d.process(makeMsg({ content: '查项目 A' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(channel.lastReply).toContain('查询结果');
    expect(events.at(-1)?.result).toBe('success');
  });

  it('JSON 格式坏了也重试一次', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion
      .mockResolvedValueOnce('我觉得你是想新增一个项目，对吗？')
      .mockResolvedValueOnce(
        '{"intent":"CREATE","fields":{"项目名称":"X"},"confidence":0.95,"summary":"新增"}',
      );
    (adapter.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'r1',
      fields: { 项目名称: 'X' },
    });

    await d.process(makeMsg({ content: '新增项目 X' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(channel.lastReply).toContain('已录入');
  });

  it('★ 安全底线：缺筛选条件绝不重试 —— 重试会让模型凭空挑一条记录去改', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"UPDATE","fields":{"Node版本":"20"},"filters":{},"confidence":0.9,"summary":"改"}',
    );

    await d.process(makeMsg({ content: '改一下项目的 node 版本' }), channel);

    // 用户没说改哪个项目，这个信息不在模型手上 —— 只能问用户，不能让它编
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(channel.lastReply).toContain('需要指定筛选条件');
    expect(adapter.updateRecord).not.toHaveBeenCalled();
  });

  it('★ 安全底线：缺变更字段绝不重试 —— 重试会让模型编一个值', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD([]);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"UPDATE","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"改"}',
    );

    await d.process(makeMsg({ content: '更新一下项目 A' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(adapter.updateRecord).not.toHaveBeenCalled();
  });

  it('★ 安全底线：未找到匹配记录不重试 —— 重试会诱导模型放宽条件', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD([]);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"DELETE","fields":{},"filters":{"项目名称":"不存在的"},"confidence":0.9,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await d.process(makeMsg({ content: '删掉项目 不存在的' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(channel.lastReply).toContain('未找到匹配记录');
  });

  it('★ 安全底线：已挂起二次确认不重试 —— 否则会挂出第二条待确认', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD([]);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"DELETE","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);

    await d.process(makeMsg({ content: '删掉项目 A' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(channel.lastReply).toContain('确认删除');
  });

  it('置信度不足与 UNKNOWN 不重试 —— 那是真实歧义，该问用户', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);

    const d1 = makeAuditedD([]);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"CREATE","fields":{},"confidence":0.3,"summary":"模糊"}',
    );
    await d1.process(makeMsg({ content: '那个啥' }), channel);
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);

    mockChatCompletion.mockReset();
    const d2 = makeAuditedD([]);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"UNKNOWN","fields":{},"confidence":0.9,"summary":"不知道"}',
    );
    await d2.process(makeMsg({ content: '你好' }), channel);
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('重试上限：连续两次都失败就把最后一次的原因回给用户', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"CREATE","fields":{"星座":"处女座"},"confidence":0.95,"summary":"新增"}',
    );

    await d.process(makeMsg({ content: '新增项目' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(MAX_LLM_ATTEMPTS);
    expect(channel.lastReply).toContain('星座');
    const last = events.at(-1);
    expect(last?.result).toBe('error');
    expect(last?.resultData).toMatchObject({ attempts: MAX_LLM_ATTEMPTS });
  });
});

describe('Dispatcher — 限流', () => {
  function makeLimitedD(events: BotEvent[], store: MemoryRateLimitStore) {
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore: new MemoryPendingActionStore(),
      rateLimitStore: store,
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return d;
  }

  it('超过配额后不再调 LLM，且只在刚超限那一次回提示', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeLimitedD(events, new MemoryRateLimitStore());
    mockChatCompletion.mockResolvedValue(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // 打满配额
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await d.process(makeMsg({ content: '查项目 A' }), channel);
    }
    const callsAtLimit = mockChatCompletion.mock.calls.length;
    const repliesAtLimit = (channel.reply as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // 第 MAX+1 条：被拦，回一次提示
    await d.process(makeMsg({ content: '查项目 A' }), channel);
    expect(mockChatCompletion.mock.calls.length).toBe(callsAtLimit);
    expect(channel.lastReply).toContain('消息太频繁');
    expect((channel.reply as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      repliesAtLimit + 1,
    );

    // 第 MAX+2 条起：继续拦，但保持沉默（刷屏时每条都回等于把流量翻倍）
    await d.process(makeMsg({ content: '查项目 A' }), channel);
    await d.process(makeMsg({ content: '查项目 A' }), channel);
    expect((channel.reply as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      repliesAtLimit + 1,
    );

    const last = events.at(-1);
    expect(last?.result).toBe('ignored');
    expect(last?.errorMsg).toContain('触发限流');
  });

  it('不同用户各自计数，互不影响', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeLimitedD([], new MemoryRateLimitStore());
    mockChatCompletion.mockResolvedValue(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      await d.process(
        makeMsg({ content: '查项目 A', senderId: 'uA' }),
        channel,
      );
    }
    expect(channel.lastReply).toContain('消息太频繁');

    // uB 是干净的
    await d.process(makeMsg({ content: '查项目 A', senderId: 'uB' }), channel);
    expect(channel.lastReply).not.toContain('消息太频繁');
  });

  it('★ 二次确认不消耗配额 —— 否则用户会被卡在等待态里出不来', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const store = new MemoryRateLimitStore();
    const d = makeLimitedD([], store);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"DELETE","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"删"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A' } },
    ]);
    (adapter.deleteRecord as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    // 挂起确认（消耗 1 次配额），再把余下配额打满
    await d.process(makeMsg({ content: '删掉项目 A' }), channel);
    for (let i = 1; i < RATE_LIMIT_MAX + 3; i++) {
      await store.hit({ platform: 'feishu', chatId: 'chatA', senderId: 'uX' });
    }

    // 配额已爆，但"确认删除"必须照样生效
    await d.process(makeMsg({ content: '确认删除' }), channel);
    expect(adapter.deleteRecord).toHaveBeenCalled();
    expect(channel.lastReply).toContain('已删除');
  });

  it('平台重试同一 eventId 不消耗配额', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeLimitedD([], new MemoryRateLimitStore());
    mockChatCompletion.mockResolvedValue(
      '{"intent":"QUERY","fields":{},"filters":{"项目名称":"A"},"confidence":0.9,"summary":"查"}',
    );
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const msg = makeMsg({ content: '查项目 A' });
    // 同一条消息发 (MAX + 5) 次：幂等在限流之前，只有第一次真正处理
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      await d.process(msg, channel);
    }
    expect(channel.lastReply).not.toContain('消息太频繁');
  });
});

describe('Dispatcher — AGGREGATE 聚合统计', () => {
  const rows: SpreadsheetRecord[] = [
    { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '100' } },
    { recordId: 'r2', fields: { 项目名称: 'B', Node版本: 200 } },
    { recordId: 'r3', fields: { 项目名称: 'A', Node版本: '1,000' } },
  ];

  function setup() {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    return { d: makeDispatcher(), channel, adapter };
  }

  it('sum 不分组：给出合计与参与条数', async () => {
    const { d, channel } = setup();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本"},"confidence":0.9,"summary":"合计"}',
    );
    await d.process(makeMsg({ content: '台账 Node 版本合计' }), channel);
    // 字符串 "100" 与带千分位的 "1,000" 都要能参与统计
    expect(channel.lastReply).toContain('1300');
    expect(channel.lastReply).toContain('共 3 条记录');
  });

  it('count 不需要 field', async () => {
    const { d, channel } = setup();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"count"},"confidence":0.9,"summary":"数一下"}',
    );
    await d.process(makeMsg({ content: '台账 一共几条' }), channel);
    expect(channel.lastReply).toContain('3');
  });

  it('groupBy 按值降序分组，并给出总计', async () => {
    const { d, channel } = setup();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本","groupBy":"项目名称"},"confidence":0.9,"summary":"分组"}',
    );
    await d.process(makeMsg({ content: '台账 按项目统计' }), channel);
    // A = 100 + 1000 = 1100 排在 B = 200 前面
    expect(channel.lastReply).toContain('1. A：1100（2 条）');
    expect(channel.lastReply).toContain('2. B：200（1 条）');
    expect(channel.lastReply).toContain('总合计：1300');
  });

  it('非数字/空值被跳过并回显 —— 否则总和悄悄偏小', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '100' } },
      { recordId: 'r2', fields: { 项目名称: 'B', Node版本: '' } },
      { recordId: 'r3', fields: { 项目名称: 'C', Node版本: '待定' } },
    ]);
    const d = makeDispatcher();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本"},"confidence":0.9,"summary":"合计"}',
    );
    await d.process(makeMsg({ content: '台账 合计' }), channel);
    expect(channel.lastReply).toContain('100');
    expect(channel.lastReply).toContain('2 条记录的「Node版本」为空或不是数字');
  });

  it('★ 拉取被截断时必须明说数字是错的 —— 截断的总和看起来和正确答案一样', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (
      adapter as unknown as { queryRecordsWithMeta: ReturnType<typeof vi.fn> }
    ).queryRecordsWithMeta = vi.fn(async () => ({
      records: rows,
      truncated: true,
    }));
    const d = makeDispatcher();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本"},"confidence":0.9,"summary":"合计"}',
    );
    await d.process(makeMsg({ content: '台账 合计' }), channel);
    const reply = channel.lastReply ?? '';
    expect(reply).toContain('不完整');
    // 警告必须在最前面，放末尾会被当成免责声明忽略
    expect(reply.indexOf('不完整')).toBeLessThan(reply.indexOf('1300'));
  });

  it('统计字段不在映射里 → 拒绝并列出可用字段（算错了列没人能发现）', async () => {
    const { d, channel, adapter } = setup();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"毛利"},"confidence":0.9,"summary":"合计"}',
    );
    await d.process(makeMsg({ content: '台账 毛利合计' }), channel);
    expect(adapter.queryRecords).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('毛利');
    expect(channel.lastReply).toContain('项目名称');
  });

  it('sum 缺 field 时提示，不猜一个字段去算钱', async () => {
    const { d, channel } = setup();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum"},"confidence":0.9,"summary":"合计"}',
    );
    await d.process(makeMsg({ content: '台账 合计' }), channel);
    expect(channel.lastReply).toContain('需要指定统计哪个字段');
  });

  it('AGGREGATE 是只读的，不受写权限白名单限制', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const d = new Dispatcher({ getBinding: () => baseBinding });
    d.registry.register(
      new DatabaseDrivenScene({ ...baseSceneConfig, writerIds: ['someone'] }),
    );
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"count"},"confidence":0.9,"summary":"数"}',
    );
    await d.process(makeMsg({ content: '台账 一共几条' }), channel);
    expect(channel.lastReply).not.toContain('写入权限');
  });
});

describe('Dispatcher — 批量 UPDATE（回复「全部」）', () => {
  function setupMulti(count: number) {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const many = Array.from({ length: count }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 项目名称: `p${i}` },
    }));
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue(many);
    const events: BotEvent[] = [];
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return { d, channel, adapter, events };
  }

  it('回复「全部」更新所有命中记录（此前只能一条条点序号）', async () => {
    const { d, channel, adapter, events } = setupMulti(15);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":"改"}',
    );
    await d.process(makeMsg({ content: '把项目 p 都改成 Node 20' }), channel);
    // 提示语要说清「全部」会影响多少条
    expect(channel.lastReply).toContain('回复「全部」把这 15 条都改成');

    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordId: 'x',
      fields: {},
    });
    await d.process(makeMsg({ content: '全部' }), channel);

    // 15 条全部更新，而不是只更新展示出来的 10 条
    expect(adapter.updateRecord).toHaveBeenCalledTimes(15);
    expect(channel.lastReply).toContain('已更新 15 条');
    const last = events.at(-1);
    expect(last?.intent).toBe('UPDATE');
    expect(last?.resultData).toMatchObject({ updatedAll: true, updated: 15 });
  });

  it('部分失败时汇总，并记 error 与原因', async () => {
    const { d, channel, adapter, events } = setupMulti(3);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":"改"}',
    );
    await d.process(makeMsg({ content: '把项目 p 都改一下' }), channel);
    (adapter.updateRecord as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ recordId: 'r0', fields: {} })
      .mockRejectedValueOnce(new Error('权限不足'))
      .mockResolvedValueOnce({ recordId: 'r2', fields: {} });

    await d.process(makeMsg({ content: '全部' }), channel);

    expect(channel.lastReply).toContain('已更新 2/3 条');
    expect(channel.lastReply).toContain('权限不足');
    const last = events.at(-1);
    expect(last?.result).toBe('error');
    expect(last?.resultData).toMatchObject({ updated: 2, failed: 1 });
  });

  it('并发受闸门约束，不会一次性全量发出', async () => {
    const { d, channel, adapter } = setupMulti(15);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":"改"}',
    );
    await d.process(makeMsg({ content: '把项目 p 都改一下' }), channel);

    let inFlight = 0;
    let peak = 0;
    (adapter.updateRecord as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((res) => setTimeout(res, 1));
        inFlight--;
        return { recordId: 'x', fields: {} };
      },
    );
    await d.process(makeMsg({ content: '全部' }), channel);
    expect(peak).toBeLessThanOrEqual(DESTRUCTIVE_CONCURRENCY);
  });

  it('「都改成完成」这类正常业务消息不会被当成「全部」', async () => {
    const { d, channel, adapter } = setupMulti(3);
    mockChatCompletion.mockResolvedValueOnce(
      '{"intent":"UPDATE","filters":{"项目名称":"p"},"fields":{"Node版本":"20"},"confidence":0.9,"summary":"改"}',
    );
    await d.process(makeMsg({ content: '把项目 p 都改一下' }), channel);

    await d.process(makeMsg({ content: '3条记录都改成完成' }), channel);
    expect(adapter.updateRecord).not.toHaveBeenCalled();
    expect(channel.lastReply).toContain('请回复序号');
  });
});

describe('Dispatcher — 新错误文案与重试分类的配合', () => {
  it('聚合字段名写错 → 可重试（正确答案就在字段清单里）', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '10' } },
    ]);
    const d = makeDispatcher();
    mockChatCompletion
      .mockResolvedValueOnce(
        '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"毛利"},"confidence":0.9,"summary":"合计"}',
      )
      .mockResolvedValueOnce(
        '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本"},"confidence":0.9,"summary":"合计"}',
      );

    await d.process(makeMsg({ content: '台账 毛利合计' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(channel.lastReply).toContain('10');
  });

  it('★ 聚合缺 field → 不重试（用户没说统计哪列，重试会让它挑一列去算钱）', async () => {
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeDispatcher();
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum"},"confidence":0.9,"summary":"合计"}',
    );

    await d.process(makeMsg({ content: '台账 合计' }), channel);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(channel.lastReply).toContain('需要指定统计哪个字段');
  });
});

describe('Dispatcher — 审计留痕修补（实测暴露的观测缺口）', () => {
  function makeAuditedD(events: BotEvent[]) {
    const d = new Dispatcher({
      getBinding: () => baseBinding,
      pendingStore: new MemoryPendingActionStore(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    d.registry.register(new DatabaseDrivenScene(baseSceneConfig));
    return d;
  }

  it('★ AGGREGATE 必须记下算了什么、算出多少', async () => {
    // 回归：实测「这个月毛利合计」记成一条 success，而 resultData 里
    // 既没有 op 也没有 field —— 无法判断它到底统计了哪一列。
    // 这个能力的核心风险就是"错的数字和对的数字长得一模一样"。
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '100' } },
      { recordId: 'r2', fields: { 项目名称: 'B', Node版本: '200' } },
    ]);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本"},"confidence":0.9,"summary":"合计"}',
    );

    await d.process(makeMsg({ content: '台账 合计' }), channel);

    const last = events.at(-1);
    const rd = last?.resultData as Record<string, unknown> & {
      request: { aggregate?: unknown };
      aggregate?: unknown;
    };
    // 请求侧：算子与字段
    expect(rd.request.aggregate).toEqual({ op: 'sum', field: 'Node版本' });
    // 结果侧：算出来的值与参与条数
    expect(rd.aggregate).toMatchObject({
      op: 'sum',
      field: 'Node版本',
      recordCount: 2,
      value: 300,
    });
  });

  it('分组聚合只记组数，不记组名（按敏感字段分组时组名就是它的值）', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    (adapter.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { recordId: 'r1', fields: { 项目名称: 'A', Node版本: '100' } },
      { recordId: 'r2', fields: { 项目名称: 'B', Node版本: '200' } },
    ]);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"AGGREGATE","fields":{},"filters":{},"aggregate":{"op":"sum","field":"Node版本","groupBy":"项目名称"},"confidence":0.9,"summary":"分组"}',
    );

    await d.process(makeMsg({ content: '台账 按项目统计' }), channel);

    const rd = events.at(-1)?.resultData as { aggregate?: unknown };
    expect(rd.aggregate).toMatchObject({ groupBy: '项目名称', groupCount: 2 });
    expect(JSON.stringify(rd.aggregate)).not.toContain('"A"');
  });

  it('★ UNKNOWN + confidence 0 记 ignored，不再污染错误率', async () => {
    // 回归：防注入守词明确要求模型无法识别时返回
    // {"intent":"UNKNOWN","confidence":0} —— 这是系统设计的正路，
    // 但置信度闸门排在前面，把它记成了 error。
    // 实测 53 条事件里 25 个 error 有 21 个是这么来的。
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"UNKNOWN","fields":{},"confidence":0,"summary":"无法识别"}',
    );

    await d.process(makeMsg({ content: '你好' }), channel);

    const last = events.at(-1);
    expect(last?.result).toBe('ignored');
    expect(last?.errorMsg).toBe('UNKNOWN 意图');
  });

  it('真实意图但置信度低，仍然记 error（那是解析质量问题）', async () => {
    const events: BotEvent[] = [];
    const channel = makeChannel();
    const adapter = makeAdapter();
    mockGetAdapter.mockReturnValue(adapter);
    const d = makeAuditedD(events);
    mockChatCompletion.mockResolvedValue(
      '{"intent":"CREATE","fields":{"项目名称":"X"},"confidence":0.3,"summary":"模糊"}',
    );

    await d.process(makeMsg({ content: '那个啥' }), channel);

    expect(events.at(-1)?.result).toBe('error');
    expect(events.at(-1)?.errorMsg).toBe('置信度不足');
  });
});
