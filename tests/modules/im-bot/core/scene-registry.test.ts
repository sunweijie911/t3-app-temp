import { beforeEach, describe, expect, it, vi } from 'vitest';

// 必须先 mock 才 import scene-registry，否则 llm.ts 实模块会被加载
vi.mock('@/modules/im-bot/core/llm', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '@/modules/im-bot/core/llm';
import { SceneRegistry } from '@/modules/im-bot/core/scene-registry';
import type { BotScene } from '@/modules/im-bot/scenes/types';

const mockedChatCompletion = vi.mocked(chatCompletion);

function makeScene(
  id: string,
  score: number,
  description = '',
  allowedChatIds: string[] = [],
): BotScene {
  return {
    id,
    name: id,
    description,
    match: () => score,
    allowsChat: (chatId) =>
      allowedChatIds.length === 0 || allowedChatIds.includes(chatId),
    writeDenial: () => null,
    getSystemPrompt: () => '',
    parseResult: () => null,
    formatReply: () => '',
  };
}

describe('SceneRegistry.matchByKeyword', () => {
  it('无场景注册时返回 null', () => {
    const r = new SceneRegistry();
    expect(r.matchByKeyword('hi')).toBeNull();
  });

  it('所有 score=0 时返回 null', () => {
    const r = new SceneRegistry();
    r.register(makeScene('a', 0));
    r.register(makeScene('b', 0));
    expect(r.matchByKeyword('hi')).toBeNull();
  });

  it('返回 score 最高的场景', () => {
    const r = new SceneRegistry();
    r.register(makeScene('a', 0.3));
    r.register(makeScene('b', 0.7));
    r.register(makeScene('c', 0.5));
    expect(r.matchByKeyword('x')?.id).toBe('b');
  });

  it('同分时返回先注册的（match 用 > 而非 >=）', () => {
    const r = new SceneRegistry();
    r.register(makeScene('first', 0.5));
    r.register(makeScene('second', 0.5));
    expect(r.matchByKeyword('x')?.id).toBe('first');
  });
});

describe('SceneRegistry.getById', () => {
  it('找不到时返回 undefined', () => {
    const r = new SceneRegistry();
    expect(r.getById('nope')).toBeUndefined();
  });

  it('找到时返回场景', () => {
    const r = new SceneRegistry();
    r.register(makeScene('a', 0));
    expect(r.getById('a')?.id).toBe('a');
  });
});

describe('SceneRegistry.matchByLLM', () => {
  beforeEach(() => {
    mockedChatCompletion.mockReset();
  });

  it('无场景时直接返回 null（不调 LLM）', async () => {
    const r = new SceneRegistry();
    const out = await r.matchByLLM('hi');
    expect(out).toBeNull();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it('LLM 返回有效 id', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
    r.register(makeScene('tasks', 0));
    mockedChatCompletion.mockResolvedValueOnce('sales');
    const out = await r.matchByLLM('hi');
    expect(out?.id).toBe('sales');
  });

  it('含大写字母的 sceneId 也能匹配（不分大小写）', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('DevLog', 0));
    // LLM 按 prompt 返回 id 原值（含大写）
    mockedChatCompletion.mockResolvedValueOnce('DevLog');
    expect((await r.matchByLLM('hi'))?.id).toBe('DevLog');
    // LLM 返回小写形态同样应命中
    mockedChatCompletion.mockResolvedValueOnce('devlog');
    expect((await r.matchByLLM('hi'))?.id).toBe('DevLog');
  });

  it('LLM 返回 none 时返回 null', async () => {
    const r = new SceneRegistry();
    // 两个候选才会真的走分类：只剩一个时直接选它、不调 LLM（见下方用例）
    r.register(makeScene('sales', 0));
    r.register(makeScene('hr', 0));
    mockedChatCompletion.mockResolvedValueOnce('none');
    expect(await r.matchByLLM('hi')).toBeNull();
  });

  it('LLM 返回未注册 id 时返回 null', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
    r.register(makeScene('hr', 0));
    mockedChatCompletion.mockResolvedValueOnce('unknown-id');
    expect(await r.matchByLLM('hi')).toBeNull();
  });

  it('LLM 抛错时向上传播，不伪装成"没有匹配的场景"', async () => {
    // 调用方需要区分这两种情况：吞掉异常会让 LLM 故障在审计日志里
    // 记成 ignored、errorMsg 为空，排障时看不出根因
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
    r.register(makeScene('hr', 0));
    mockedChatCompletion.mockRejectedValueOnce(new Error('network'));
    await expect(r.matchByLLM('hi')).rejects.toThrow('network');
  });

  it('LLM prompt 包含动态场景列表 + validIds 约束', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('devops-project', 0, '前端项目台账'));
    r.register(makeScene('devops-school', 0, '学校部署'));
    mockedChatCompletion.mockResolvedValueOnce('devops-project');
    await r.matchByLLM('hi');
    const systemPrompt = mockedChatCompletion.mock.calls[0]?.[0] ?? '';
    expect(systemPrompt).toContain('devops-project');
    expect(systemPrompt).toContain('前端项目台账');
    expect(systemPrompt).toContain('devops-school');
    // 旧 prompt 的硬编码 sales / tasks 关键字应该已被去掉
    expect(systemPrompt).not.toContain('sales');
    expect(systemPrompt).not.toContain('商品名称');
  });
});

describe('SceneRegistry — 会话作用域', () => {
  it('scenesForChat 过滤掉本会话不可用的场景', () => {
    const r = new SceneRegistry();
    r.register(makeScene('open', 1));
    r.register(makeScene('locked', 5, '', ['chatB']));
    expect(r.scenesForChat('chatA').map((s) => s.id)).toEqual(['open']);
    expect(r.scenesForChat('chatB').map((s) => s.id)).toEqual([
      'open',
      'locked',
    ]);
    // 不传 chatId 时返回全部（后台/测试用）
    expect(r.scenesForChat()).toHaveLength(2);
  });

  it('关键词匹配不会选中本会话不可用的场景（哪怕它得分更高）', () => {
    const r = new SceneRegistry();
    r.register(makeScene('open', 1));
    r.register(makeScene('locked', 5, '', ['chatB']));
    expect(r.matchByKeyword('x', 'chatA')?.id).toBe('open');
    expect(r.matchByKeyword('x', 'chatB')?.id).toBe('locked');
  });

  it('LLM 分类只在本会话可用的场景里选，且不把它们写进 prompt', async () => {
    const r = new SceneRegistry();
    // 开放场景放两个：chatA 仍有 2 个候选，才会真的走分类
    r.register(makeScene('open', 0, '开放场景'));
    r.register(makeScene('open2', 0, '另一个开放场景'));
    r.register(makeScene('locked', 0, '受限场景', ['chatB']));
    mockedChatCompletion.mockResolvedValue('locked');

    // chatA 看不到 locked：即便 LLM 返回它也匹配不上
    expect(await r.matchByLLM('x', 'chatA')).toBeNull();
    const prompt = mockedChatCompletion.mock.calls.at(-1)?.[0] ?? '';
    expect(prompt).not.toContain('受限场景');

    expect((await r.matchByLLM('x', 'chatB'))?.id).toBe('locked');
  });

  it('本会话没有任何可用场景时不调 LLM', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('locked', 0, '', ['chatB']));
    mockedChatCompletion.mockClear();
    expect(await r.matchByLLM('x', 'chatA')).toBeNull();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });
});

describe('SceneRegistry.matchByLLM — 单候选不必再分类（P1）', () => {
  it('本会话只剩一个可见场景时直接选它，不调 LLM', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));

    const picked = await r.matchByLLM('本月哪些单亏了');

    expect(picked?.id).toBe('sales');
    // 分类器此时唯一的作用是"要不要处理"，下游的 confidence 阈值和
    // UNKNOWN 分支已经做了这件事 —— 真实群消息关键词命中率很低，
    // 不省掉这次调用等于每条消息都串行跑两次 LLM
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it('会话作用域过滤后只剩一个时同样跳过', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('open', 0, '开放场景'));
    r.register(makeScene('locked', 0, '受限场景', ['chatB']));

    expect((await r.matchByLLM('x', 'chatA'))?.id).toBe('open');
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it('两个及以上候选仍然走分类', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
    r.register(makeScene('hr', 0));
    mockedChatCompletion.mockResolvedValueOnce('hr');

    expect((await r.matchByLLM('x'))?.id).toBe('hr');
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });
});
