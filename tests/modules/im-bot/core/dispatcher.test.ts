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
import { DESTRUCTIVE_CONCURRENCY } from '@/modules/im-bot/constants';
import { MemoryDedupStore } from '@/modules/im-bot/core/dedup';
import { Dispatcher } from '@/modules/im-bot/core/dispatcher';
import { chatCompletion } from '@/modules/im-bot/core/llm';
import { MemoryPendingActionStore } from '@/modules/im-bot/core/pending-action';
import type {
  ResourceBinding,
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
    mockChatCompletion.mockResolvedValueOnce(
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
    mockChatCompletion.mockResolvedValueOnce(
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
