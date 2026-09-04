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

export const BOT_EVENT_RESULT_VALUES = [
  'success',
  'error',
  'ignored',
  /** 已挂起二次确认，等用户回复 —— 是正路，不计入错误率 */
  'pending',
] as const;
export const BOT_EVENT_RESULT_ENUM = z.enum(BOT_EVENT_RESULT_VALUES);

/** 资源类型。table 全平台已实现；doc 仅飞书已实现；file 为能力层预留 */
export const BOT_RESOURCE_KIND_VALUES = ['table', 'doc', 'file'] as const;
export const BOT_RESOURCE_KIND_ENUM = z.enum(BOT_RESOURCE_KIND_VALUES);
export const RESOURCE_KIND_LABELS: Record<
  (typeof BOT_RESOURCE_KIND_VALUES)[number],
  string
> = {
  table: '多维表格',
  // 这些标签会随字段清单一起注入 system prompt（core/schema-prompt.ts）。
  // 曾写作「文档（未实现）」，于是 prompt 里一边列出 READ / APPEND 可用、
  // 一边告诉 LLM 该资源未实现，自相矛盾 —— 模型会倾向返回 UNKNOWN。
  doc: '文档',
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
      primary: z.boolean().optional(),
    }),
    z.object({
      name: z.string(),
      type: z.literal('multiSelect'),
      sensitive: z.boolean().optional(),
      label: z.string().optional(),
      primary: z.boolean().optional(),
      /** 平台侧 property.options 派生的合法取值 */
      options: z.array(z.string()).optional(),
    }),
    z.object({
      name: z.string(),
      type: z.literal('plain'),
      sensitive: z.boolean().optional(),
      label: z.string().optional(),
      displayType: z.enum(['number', 'date', 'text']).optional(),
      primary: z.boolean().optional(),
      /** 平台侧 property.options 派生的合法取值（单选列） */
      options: z.array(z.string()).optional(),
    }),
  ]),
);

/** LLM 意图解析置信度阈值 */
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * 单条消息最多发起几次 LLM 解析（含首次）。
 *
 * 2 = 允许纠正一次。开环单次调用是机器人不稳定的主因：本地用 CLI 时
 * 报错会被读到并改参数重试，机器人这边直接把错误抛给用户 ——
 * 同一个模型缺陷，一边自愈、一边把人堵死。
 *
 * 为什么只给一次：单次解析实测 4~7 秒，重试一次就是 8~14 秒。群聊里
 * 再往上加轮次收益递减（能一次改对的基本一次就对了），而延迟是线性涨的。
 */
export const MAX_LLM_ATTEMPTS = 2;

/** 事件去重 TTL (ms) */
export const DEDUP_TTL_MS = 5 * 60 * 1000;

/**
 * 限流：单个用户在单个会话里，每个窗口最多能触发几次**要花 LLM 调用**的处理。
 *
 * 20 条 / 分钟对真人来说宽松到基本感觉不到（正常记账一分钟发不了 20 条），
 * 但足以挡住刷屏和脚本。二次确认（"确认删除"这类）不消耗配额 ——
 * 它们不走 LLM，且把人卡在等待态里出不来是更糟的结果。
 */
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

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
