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

/**
 * 各平台 credentials 中需要按 secret 处理的字段。
 * - listPlatforms 返回前会把这些字段值替换为 CREDENTIAL_MASK，避免明文回传浏览器
 * - upsertPlatform 收到值等于 CREDENTIAL_MASK 时保留 DB 原值，不覆盖
 * 与前端 PLATFORM_FIELDS 中标记 `secret: true` 的字段保持一致。
 */
export const PLATFORM_SECRET_FIELDS: Record<BotPlatform, readonly string[]> = {
  feishu: ['appSecret', 'encryptKey', 'verificationToken'],
  dingtalk: ['appSecret', 'botSecret'],
  wecom: ['botSecret', 'botToken', 'encodingAesKey'],
};

/** 替换 secret 字段值的掩码占位符。upsert 时若值等于此占位符则保留 DB 原值。 */
export const CREDENTIAL_MASK = '********';
