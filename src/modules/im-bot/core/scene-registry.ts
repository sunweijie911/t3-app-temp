import type { BotScene } from '../scenes/types';
import { chatCompletion } from './llm';

export class SceneRegistry {
  private scenes: BotScene[] = [];

  register(scene: BotScene): void {
    this.scenes.push(scene);
  }

  getScenes(): BotScene[] {
    return [...this.scenes];
  }

  /**
   * 在指定会话里可见的场景。不传 chatId 时返回全部（供后台/测试用）。
   * 过滤放在**匹配之前**：不可用的场景根本不参与关键词与 LLM 分类，
   * 于是未授权的群拿到的是正常的帮助文本，而不是"该场景未授权"
   * —— 后者等于把场景名泄漏给了不该看到的群。
   */
  scenesForChat(chatId?: string): BotScene[] {
    if (!chatId) return [...this.scenes];
    return this.scenes.filter((s) => s.allowsChat(chatId));
  }

  getById(id: string): BotScene | undefined {
    return this.scenes.find((s) => s.id === id);
  }

  matchByKeyword(content: string, chatId?: string): BotScene | null {
    let best: BotScene | null = null;
    let bestScore = 0;
    for (const scene of this.scenesForChat(chatId)) {
      const score = scene.match(content);
      if (score > bestScore) {
        bestScore = score;
        best = scene;
      }
    }
    return bestScore > 0 ? best : null;
  }

  async matchByLLM(content: string, chatId?: string): Promise<BotScene | null> {
    const visible = this.scenesForChat(chatId);
    if (visible.length === 0) return null;

    // 只有一个候选时不必再花一次 LLM 调用去"分类"：分类器此时唯一的作用
    // 就是判断"这条消息要不要处理"，而这件事下游已经做了两遍
    // —— 意图解析的 confidence 阈值 + UNKNOWN 分支。
    //
    // 实测：真实群消息（"本月哪些单亏了""闲鱼上卖出去的单有哪些"）关键词
    // 命中数普遍是 0，于是每条消息都要串行跑两次 LLM，延迟和成本翻倍。
    const only = visible[0];
    if (visible.length === 1 && only) return only;

    const scenesDesc = visible
      .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
      .join('\n');
    const validIds = visible.map((s) => s.id).join(' | ');

    const systemPrompt = `你是一个意图分类器。根据用户消息判断属于下面哪个业务场景。

## 可用场景
${scenesDesc}

## 规则
- 只返回场景 id（必须是 ${validIds} 之一）或 "none"，不要解释、不要加引号
- 仅根据场景的「name + description」判断，不要凭空想象其它分类
- 完全无法判断时返回 none`;

    // 故意不在这里吞异常：调用方需要区分"LLM 说没有匹配的场景"和
    // "LLM 根本没调通"—— 前者该回 help 文本，后者该告知服务不可用并记进审计日志。
    // 以前统一 return null，导致 LLM 挂掉时日志记成 ignored、errorMsg 为空，
    // 排障时完全看不出根因。
    const raw = (await chatCompletion(systemPrompt, content)).trim();
    if (raw.toLowerCase() === 'none') return null;
    // 两侧不分大小写比较：sceneId 在 admin 允许大写，
    // 不能因为 LLM 返回值小写化就匹配不上（否则静默退化为无场景）。
    const sceneId = raw.toLowerCase();
    return visible.find((s) => s.id.toLowerCase() === sceneId) ?? null;
  }
}
