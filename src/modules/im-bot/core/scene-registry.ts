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
      .map((s) => `- ${s.id}: ${s.description}`)
      .join('\n');

    const systemPrompt = `你是一个意图分类器。根据用户消息判断属于哪个业务场景。

## 可用场景
${scenesDesc}

## 规则
- 只返回场景 id，不要解释
- 无法判断时返回 "none"`;

    const result = await chatCompletion(systemPrompt, content);
    const sceneId = result.trim().toLowerCase();
    if (sceneId === 'none') return null;
    return this.scenes.find((s) => s.id === sceneId) ?? null;
  }
}
