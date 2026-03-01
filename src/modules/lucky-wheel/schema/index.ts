import { relations } from 'drizzle-orm';
import { index, jsonb, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from '@/server/db/auth-schema';
import { createTable } from '@/server/db/table-creator';

// ============================================================
// Enums
// ============================================================

export const prizeTypeEnum = pgEnum('prize_type', [
  'physical',
  'virtual',
  'coupon',
  'points',
  'thanks',
]);

export const drawRecordStatusEnum = pgEnum('draw_record_status', [
  'pending',
  'confirmed',
  'shipped',
  'claimed',
]);

// ============================================================
// Lucky Wheel Tables
// ============================================================

// 1. wheelActivities — 转盘活动
export const wheelActivities = createTable(
  'wheel_activity',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    name: d.varchar({ length: 256 }).notNull(),
    slug: d.varchar({ length: 128 }).notNull(),
    description: d.text(),
    coverImage: d.text(),
    startAt: d.timestamp({ withTimezone: true }),
    endAt: d.timestamp({ withTimezone: true }),
    maxDrawsPerUser: d.integer().notNull().default(0),
    maxDrawsPerDay: d.integer().notNull().default(0),
    isActive: d.boolean().notNull().default(true),
    rules: jsonb().$type<Record<string, unknown>>(),
    sortOrder: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex('wheel_activity_slug_idx').on(t.slug),
    index('wheel_activity_active_idx').on(t.isActive),
  ],
);

// 2. wheelPrizes — 转盘奖品
export const wheelPrizes = createTable(
  'wheel_prize',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    activityId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => wheelActivities.id, { onDelete: 'cascade' }),
    name: d.varchar({ length: 256 }).notNull(),
    image: d.text(),
    type: prizeTypeEnum().notNull().default('thanks'),
    probability: d.integer().notNull().default(0),
    totalStock: d.integer().notNull().default(0),
    remainingStock: d.integer().notNull().default(0),
    value: jsonb().$type<Record<string, unknown>>(),
    sortOrder: d.integer().notNull().default(0),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('wheel_prize_activity_idx').on(t.activityId),
    index('wheel_prize_active_idx').on(t.isActive),
  ],
);

// 3. wheelDrawRecords — 抽奖记录
export const wheelDrawRecords = createTable(
  'wheel_draw_record',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activityId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => wheelActivities.id),
    prizeId: d.varchar({ length: 36 }).references(() => wheelPrizes.id),
    isWin: d.boolean().notNull().default(false),
    status: drawRecordStatusEnum().notNull().default('pending'),
    userInfo: jsonb().$type<Record<string, unknown>>(),
    adminNote: d.text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('wheel_draw_user_idx').on(t.userId),
    index('wheel_draw_activity_idx').on(t.activityId),
    index('wheel_draw_prize_idx').on(t.prizeId),
  ],
);

// ============================================================
// Relations
// ============================================================

export const wheelActivityRelations = relations(
  wheelActivities,
  ({ many }) => ({
    prizes: many(wheelPrizes),
    drawRecords: many(wheelDrawRecords),
  }),
);

export const wheelPrizeRelations = relations(wheelPrizes, ({ one, many }) => ({
  activity: one(wheelActivities, {
    fields: [wheelPrizes.activityId],
    references: [wheelActivities.id],
  }),
  drawRecords: many(wheelDrawRecords),
}));

export const wheelDrawRecordRelations = relations(
  wheelDrawRecords,
  ({ one }) => ({
    user: one(user, {
      fields: [wheelDrawRecords.userId],
      references: [user.id],
    }),
    activity: one(wheelActivities, {
      fields: [wheelDrawRecords.activityId],
      references: [wheelActivities.id],
    }),
    prize: one(wheelPrizes, {
      fields: [wheelDrawRecords.prizeId],
      references: [wheelPrizes.id],
    }),
  }),
);
