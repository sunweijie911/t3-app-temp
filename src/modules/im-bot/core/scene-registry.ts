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

  getById(id: string): BotScene | undefined {
    return this.scenes.find((s) => s.id === id);
  }

  matchByKeyword(content: string): BotScene | null {
    let best: BotScene | null = null;
    let bestScore = 0;
    for (const scene of this.scenes) {
      const score = scene.match(content);
      if (score > bestScore) {
        bestScore = score;
        best = scene;
      }
    }
    return bestScore > 0 ? best : null;
  }

  async matchByLLM(content: string): Promise<BotScene | null> {
    if (this.scenes.length === 0) return null;

    const scenesDesc = this.scenes
      .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
      .join('\n');
    const validIds = this.scenes.map((s) => s.id).join(' | ');

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
    return this.scenes.find((s) => s.id.toLowerCase() === sceneId) ?? null;
  }
}
