import type { ExecuteResult, ParsedIntent, SceneContext } from '../core/types';

export interface BotScene {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  match(content: string): number;
  getSystemPrompt(ctx: SceneContext): string;
  parseResult(json: string): ParsedIntent | null;
  formatReply(intent: ParsedIntent, result: ExecuteResult): string;
}
