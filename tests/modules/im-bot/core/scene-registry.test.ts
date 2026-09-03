import { beforeEach, describe, expect, it, vi } from 'vitest';

// 必须先 mock 才 import scene-registry，否则 llm.ts 实模块会被加载
vi.mock('@/modules/im-bot/core/llm', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '@/modules/im-bot/core/llm';
import { SceneRegistry } from '@/modules/im-bot/core/scene-registry';
import type { BotScene } from '@/modules/im-bot/scenes/types';

const mockedChatCompletion = vi.mocked(chatCompletion);

function makeScene(id: string, score: number, description = ''): BotScene {
  return {
    id,
    name: id,
    description,
    match: () => score,
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
    r.register(makeScene('sales', 0));
    mockedChatCompletion.mockResolvedValueOnce('none');
    expect(await r.matchByLLM('hi')).toBeNull();
  });

  it('LLM 返回未注册 id 时返回 null', async () => {
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
    mockedChatCompletion.mockResolvedValueOnce('unknown-id');
    expect(await r.matchByLLM('hi')).toBeNull();
  });

  it('LLM 抛错时向上传播，不伪装成"没有匹配的场景"', async () => {
    // 调用方需要区分这两种情况：吞掉异常会让 LLM 故障在审计日志里
    // 记成 ignored、errorMsg 为空，排障时看不出根因
    const r = new SceneRegistry();
    r.register(makeScene('sales', 0));
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
