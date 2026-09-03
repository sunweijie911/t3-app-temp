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
  /**
   * 该场景在这个会话里是否可用。不可用时场景对该会话完全不可见 ——
   * 连帮助文本里都不列出，不泄漏场景名。
   */
  allowsChat(chatId: string): boolean;
  /** 该用户是否能执行写操作（CREATE / UPDATE / DELETE / APPEND） */
  allowsWrite(senderId: string): boolean;
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
