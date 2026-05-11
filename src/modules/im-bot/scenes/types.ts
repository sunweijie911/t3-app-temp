import type {
  ExecuteResult,
  FieldMappingValue,
  ParsedIntent,
  SceneContext,
} from '../core/types';

export interface BotScene {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  match(content: string): number;
  getSystemPrompt(ctx: SceneContext): string;
  parseResult(json: string): ParsedIntent | null;
  /**
   * 渲染机器人在群里回复的文本。
   * @param fieldMapping 当前表的字段映射，渲染时用其中的 label / displayType
   *                     替换默认 logicalKey 展示和日期启发式（可选，缺省退化为旧行为）
   */
  formatReply(
    intent: ParsedIntent,
    result: ExecuteResult,
    fieldMapping?: Record<string, FieldMappingValue>,
  ): string;
}
