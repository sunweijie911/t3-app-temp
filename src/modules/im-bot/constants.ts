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

/** 资源类型。table 已实现，doc/file 为能力层预留 */
export const BOT_RESOURCE_KIND_VALUES = ['table', 'doc', 'file'] as const;
export const BOT_RESOURCE_KIND_ENUM = z.enum(BOT_RESOURCE_KIND_VALUES);
export const RESOURCE_KIND_LABELS: Record<
  (typeof BOT_RESOURCE_KIND_VALUES)[number],
  string
> = {
  table: '多维表格',
  doc: '文档（未实现）',
  file: '文件（未实现）',
};

/** fieldMapping 的校验 schema（admin 写入 / 前端类型推导共用） */
export const FIELD_MAPPING_SCHEMA = z.record(
  z.string(),
  z.union([
    z.string(),
    z.object({
      name: z.string(),
      type: z.literal('link'),
      linkTableId: z.string(),
      displayField: z.string(),
      sensitive: z.boolean().optional(),
      label: z.string().optional(),
    }),
    z.object({
      name: z.string(),
      type: z.literal('multiSelect'),
      sensitive: z.boolean().optional(),
      label: z.string().optional(),
    }),
    z.object({
      name: z.string(),
      type: z.literal('plain'),
      sensitive: z.boolean().optional(),
      label: z.string().optional(),
      displayType: z.enum(['number', 'date']).optional(),
    }),
  ]),
);

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
 * 单次破坏性操作（DELETE / 批量 UPDATE）允许影响的最大记录数。
 * 超过则直接拒绝并要求缩窄条件，不挂 PendingAction —— 一句"确认删除"
 * 就并发删掉上千条记录既踩平台写接口限流，也无法回滚。
 */
export const MAX_DESTRUCTIVE_BATCH = 20;

/**
 * 破坏性操作的并发闸门。飞书 Bitable 写接口 QPS 约 20，
 * 一次性 Promise.all 全量发出会大面积 429。
 */
export const DESTRUCTIVE_CONCURRENCY = 5;

/** 候选记录列表（UPDATE 多条命中 / DELETE 确认）最多展示几条 */
export const MAX_CANDIDATE_DISPLAY = 10;

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
