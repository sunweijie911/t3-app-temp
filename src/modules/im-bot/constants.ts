import { z } from 'zod';

export const MODULE_NAME = 'IM Bot';

export const BOT_PLATFORM_VALUES = ['feishu', 'dingtalk', 'wecom'] as const;
export const BOT_PLATFORM_ENUM = z.enum(BOT_PLATFORM_VALUES);
export type BotPlatform = z.infer<typeof BOT_PLATFORM_ENUM>;

export const PLATFORM_LABELS: Record<BotPlatform, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
};

export const BOT_EVENT_RESULT_VALUES = ['success', 'error', 'ignored'] as const;
export const BOT_EVENT_RESULT_ENUM = z.enum(BOT_EVENT_RESULT_VALUES);

export const INTENT_VALUES = [
  'CREATE',
  'UPDATE',
  'QUERY',
  'DELETE',
  'UNKNOWN',
] as const;
export const INTENT_ENUM = z.enum(INTENT_VALUES);

/** LLM 意图解析置信度阈值 */
export const CONFIDENCE_THRESHOLD = 0.7;

/** 事件去重 TTL (ms) */
export const DEDUP_TTL_MS = 5 * 60 * 1000;

/** PendingAction 超时 (ms) */
export const PENDING_ACTION_TTL_MS = 60 * 1000;
