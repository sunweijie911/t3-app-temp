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
- 消息中提到商品名称、价格、快递、客户、订单等信息时，归类为 sales
- 消息中提到任务、负责人、排期、进度、上线等信息时，归类为 tasks
- 查看/查询/修改/删除某个具体事物的数据时，根据事物类型判断场景
- 只有完全无法判断时才返回 "none"`;

    const result = await chatCompletion(systemPrompt, content);
    const sceneId = result.trim().toLowerCase();
    if (sceneId === 'none') return null;
    return this.scenes.find((s) => s.id === sceneId) ?? null;
  }
}
