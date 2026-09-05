import type {
  ExecuteResult,
  FieldMappingValue,
  ParsedIntent,
  SceneContext,
  WriteDenialReason,
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
  /**
   * 该用户在该会话里能否执行写操作（CREATE / UPDATE / DELETE / APPEND）。
   *
   * 会话维度与用户维度是**与**关系：被配成只读的群，即使白名单里的用户
   * 也不能写；不在白名单里的用户，在可写的群里同样不能写。
   *
   * @returns null = 允许；否则返回被拒原因码
   */
  writeDenial(senderId: string, chatId: string): WriteDenialReason | null;
  getSystemPrompt(ctx: SceneContext): string;
  parseResult(json: string): ParsedIntent | null;
  /**
   * 渲染机器人在群里回复的文本。
   * @param fieldMapping 当前表的字段映射，渲染时用其中的 label / displayType
   *                     替换默认 logicalKey 展示和日期启发式（可选，缺省退化为旧行为）
   * @param budgetBytes 目标平台单条消息的 UTF-8 字节上限
   *                    （`ChannelAdapter.maxReplyBytes`）。展示条数按它推导 ——
   *                    三家上限不同（飞书 30000 / 钉钉 20000 / 企微 20480），
   *                    按最宽松的那个定条数会被从记录中间截断。
   *                    缺省时退化为飞书量级，与加这个参数之前行为一致。
   */
  formatReply(
    intent: ParsedIntent,
    result: ExecuteResult,
    fieldMapping?: Record<string, FieldMappingValue>,
    budgetBytes?: number,
  ): string;
}
