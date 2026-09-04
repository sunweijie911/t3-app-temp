import {
  index,
  jsonb,
  pgEnum,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createTable } from '@/server/db/table-creator';

// ── 枚举 ──────────────────────────────────────────────────────

export const botPlatformEnum = pgEnum('bot_platform', [
  'feishu',
  'dingtalk',
  'wecom',
]);
export const botEventResultEnum = pgEnum('bot_event_result', [
  'success',
  'error',
  'ignored',
  /**
   * 已挂起二次确认，等用户回复。破坏性操作（DELETE / 单条 UPDATE /
   * uniqueKey 撞车）的设计正路，不是失败 —— 原先统一记成 error，
   * 一次全成功的会话在统计面板上也会显示 40% 错误率。
   */
  'pending',
]);

/**
 * 资源类型。当前只实现了 table，doc/file 是能力层的预留位
 * —— 加文档管理时新增 adapter，不用再改这张表的结构。
 */
export const botResourceKindEnum = pgEnum('bot_resource_kind', [
  'table',
  'doc',
  'file',
]);

/** 场景写入模式。见 constants.ts 的 BOT_WRITE_MODE_VALUES */
export const botWriteModeEnum = pgEnum('bot_write_mode', [
  'open',
  'whitelist',
  'readonly',
]);

// ── 场景配置表 ────────────────────────────────────────────────

export const botScenes = createTable(
  'bot_scene',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    sceneId: d.varchar({ length: 64 }).notNull().unique(),
    name: d.varchar({ length: 128 }).notNull(),
    description: text(),
    keywords: text(),
    systemPrompt: text(),
    /**
     * @deprecated 全代码无人读取。字段清单现在由 bot_resource_binding 的
     * fieldMapping 自动派生并注入 prompt（见 core/schema-prompt.ts），
     * 不再需要在场景上另存一份 schema。保留列只为不破坏历史数据。
     */
    fieldSchema: jsonb(),
    replyTemplate: text(),
    /**
     * 允许触发该场景的会话，以及每个会话能否写。**空数组 = 不限制会话**。
     *
     * 形如 `[{ chatId: 'oc_xxx', canWrite: false }]`。
     * 场景对不在名单里的会话直接不可见 —— 连帮助文本里都不出现，
     * 不泄漏场景名。`canWrite: false` 则该群只能查询。
     *
     * 取代原来的 `allowedChatIds: string[]`：那个形状只能控制「能不能用」，
     * 表达不了「A 群只读、B 群可读写」，只能建两个场景绑同一张表。
     */
    allowedChats: jsonb()
      .$type<Array<{ chatId: string; canWrite: boolean }>>()
      .notNull()
      .default([]),
    /**
     * 写入模式。与 writerIds 配合：
     * - open      任何人可写（忽略 writerIds）
     * - whitelist 仅 writerIds 内的用户可写
     * - readonly  谁都不能写
     */
    writeMode: botWriteModeEnum().notNull().default('open'),
    /** writeMode = 'whitelist' 时生效的用户 ID 白名单 */
    writerIds: jsonb().$type<string[]>().notNull().default([]),
    isActive: d.boolean().notNull().default(true),
    sortOrder: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('bot_scene_scene_id_idx').on(t.sceneId),
    index('bot_scene_is_active_idx').on(t.isActive),
  ],
);

// ── 平台凭证配置表 ────────────────────────────────────────────

export const botPlatforms = createTable('bot_platform', (d) => ({
  id: d.varchar({ length: 36 }).primaryKey(),
  platform: botPlatformEnum().notNull().unique(),
  name: d.varchar({ length: 64 }).notNull(),
  credentials: jsonb().notNull().default({}),
  isActive: d.boolean().notNull().default(false),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

// ── 资源绑定配置表 ────────────────────────────────────────────

/**
 * 场景 → 数据资源的绑定。取代原 bot_table_mapping，两处关键变化：
 *
 * 1. `platform` → `provider`：原字段同时承担了「消息来自哪个 IM」和
 *    「数据存在哪个平台」两个语义，唯一索引也建在 (sceneId, platform) 上，
 *    等于把二者焊死 —— 表达不了「企微群里问飞书多维表」。
 *    现在 provider 只表示数据所在平台，与消息来源无关。
 * 2. 唯一索引改为 (sceneId, alias)：一个场景可以绑多个资源
 *    （比如同时管一张台账表和一份周报文档），由 alias 区分。
 */
export const botResourceBindings = createTable(
  'bot_resource_binding',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    sceneId: d.varchar({ length: 64 }).notNull(),
    /** 场景内唯一的资源别名，如「项目表」。也是 LLM 侧可见的资源名 */
    alias: d.varchar({ length: 64 }).notNull(),
    kind: botResourceKindEnum().notNull().default('table'),
    /** 数据所在平台 —— 不是消息来源平台 */
    provider: botPlatformEnum().notNull(),
    workspaceId: d.varchar({ length: 256 }).notNull(),
    /** 资源 ID：table 是 tableId，doc 是 documentId，file 是 fileToken */
    resourceId: d.varchar({ length: 256 }).notNull(),
    fieldMapping: jsonb().notNull().default({}),
    /**
     * 唯一键逻辑字段名（如 "项目名称"）。配置后 CREATE 前先按此键查重，
     * 命中则走 PendingAction 二次确认改为 UPDATE，避免重复新建。
     */
    uniqueKey: d.varchar({ length: 64 }),
    /** 场景的默认资源。同场景内应只有一条为 true，dispatcher 在未指定 alias 时用它 */
    isDefault: d.boolean().notNull().default(true),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex('bot_resource_binding_scene_alias_idx').on(t.sceneId, t.alias),
    index('bot_resource_binding_scene_id_idx').on(t.sceneId),
  ],
);

// ── 事件审计日志表 ────────────────────────────────────────────

export const botEventLogs = createTable(
  'bot_event_log',
  (d) => ({
    id: serial('id').primaryKey(),
    platform: botPlatformEnum().notNull(),
    eventId: d.varchar({ length: 128 }).notNull(),
    chatId: d.varchar({ length: 128 }),
    chatName: d.varchar({ length: 256 }),
    senderId: d.varchar({ length: 128 }),
    senderName: d.varchar({ length: 64 }),
    content: text(),
    sceneId: d.varchar({ length: 64 }),
    intent: d.varchar({ length: 16 }),
    result: botEventResultEnum().notNull(),
    resultData: jsonb(),
    errorMsg: text(),
    costMs: d.integer(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('bot_event_log_created_at_idx').on(t.createdAt),
    index('bot_event_log_event_id_idx').on(t.eventId),
    index('bot_event_log_scene_id_idx').on(t.sceneId),
    index('bot_event_log_platform_idx').on(t.platform),
  ],
);

// ── 事件幂等表 ────────────────────────────────────────────────

/**
 * 事件去重（幂等）。原先是进程内 Map，多实例/多 Pod 部署下：
 * 平台重试的同一 eventId 落到另一个实例就查不到记录 → **重复写入业务数据**。
 *
 * 用 DB 而非内存的另一个收益：`INSERT ... ON CONFLICT DO NOTHING` 是原子的，
 * 取代了原来 `has()` 再 `set()` 的两步检查 —— 后者在两个并发请求间存在竞态。
 */
export const botEventDedup = createTable(
  'bot_event_dedup',
  (d) => ({
    /** `${platform}:${eventId}`，跨平台不会撞键 */
    dedupKey: d.varchar({ length: 256 }).primaryKey(),
    expiresAt: d.timestamp({ withTimezone: true }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index('bot_event_dedup_expires_at_idx').on(t.expiresAt)],
);

// ── 限流计数表 ────────────────────────────────────────────────

/**
 * 按 (平台, 会话, 发送者, 时间窗) 计数的固定窗口限流。
 *
 * 为什么必须有：每条 @机器人 的消息都会触发 1~2 次 LLM 调用，而在此之前
 * 全链路**没有任何闸门** —— 群里有人刷屏，或者有人拿脚本 @ 机器人，
 * 成本直接线性涨，也没有任何地方能拦住。
 *
 * 为什么把窗口起点放进主键：这样计数就是一条
 * `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`
 * —— 原子、多实例安全、一次往返。代价是窗口边界上最多放过 2 倍配额，
 * 对"防刷 + 控成本"这个目的完全够用，不值得为它引入滑动窗口的复杂度。
 */
export const botRateLimits = createTable(
  'bot_rate_limit',
  (d) => ({
    /** `${platform}:${chatId}:${senderId}:${windowStart}` */
    limitKey: d.varchar({ length: 512 }).primaryKey(),
    count: d.integer().notNull().default(0),
    expiresAt: d.timestamp({ withTimezone: true }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index('bot_rate_limit_expires_at_idx').on(t.expiresAt)],
);

// ── 待确认交互表 ──────────────────────────────────────────────

/**
 * 有状态交互（删除确认、多条选择等）。原先是进程内 Map，多实例下
 * 用户回的"确认删除"可能落到另一个实例 → 那边查不到 pending，
 * 于是把"确认删除"当成一条新业务消息送去 LLM 解析。
 */
export const botPendingActions = createTable(
  'bot_pending_action',
  (d) => ({
    /** `${platform}:${chatId}:${senderId}` —— 同一人在同一会话只允许一个待确认操作 */
    pendingKey: d.varchar({ length: 512 }).primaryKey(),
    sceneId: d.varchar({ length: 64 }).notNull(),
    bindingAlias: d.varchar({ length: 64 }).notNull(),
    type: d.varchar({ length: 32 }).notNull(),
    candidates: jsonb().notNull().default([]),
    /**
     * select_record 时允许用序号选到第几条。
     *
     * 必须落库：candidates 存的是**全部**命中记录（「全部更新」要用），
     * 而序号只能选到展示出来的那些。这一列丢了就会退化成
     * 「序号上界 = 候选总数」—— 用户回一个 15 就能更新一条自己从没
     * 见过的记录，正是候选列表截断本来要防的那件事。
     */
    selectableCount: d.integer(),
    message: jsonb().notNull(),
    updateFields: jsonb(),
    expiresAt: d.timestamp({ withTimezone: true }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index('bot_pending_action_expires_at_idx').on(t.expiresAt)],
);
