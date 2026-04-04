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
    fieldSchema: jsonb(),
    replyTemplate: text(),
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

// ── 表格映射配置表 ────────────────────────────────────────────

export const botTableMappings = createTable(
  'bot_table_mapping',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    sceneId: d.varchar({ length: 64 }).notNull(),
    platform: botPlatformEnum().notNull(),
    workspaceId: d.varchar({ length: 256 }).notNull(),
    tableId: d.varchar({ length: 256 }).notNull(),
    fieldMapping: jsonb().notNull().default({}),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex('bot_table_mapping_scene_platform_idx').on(
      t.sceneId,
      t.platform,
    ),
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
