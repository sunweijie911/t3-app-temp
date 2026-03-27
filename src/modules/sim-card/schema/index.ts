import { index, jsonb, serial } from 'drizzle-orm/pg-core';

import { createTable } from '@/server/db/table-creator';

// 价格：分 → 元（展示用）
export function formatSimCardPrice(fen: number) {
  return (fen / 100).toFixed(2);
}

// simCardPackages — 电话卡套餐
export const simCardPackages = createTable(
  'sim_card_package',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    title: d.varchar({ length: 256 }).notNull(),
    carrier: d.varchar({ length: 128 }).notNull(), // 运营商
    imageUrl: d.text(),
    detailImageUrl: d.text(),
    cardBgColor: d.varchar({ length: 32 }).default('#ffffff'),
    monthlyPrice: d.integer().notNull(), // 月费（分）
    dataAllowance: d.varchar({ length: 128 }), // 流量额度
    callMinutes: d.varchar({ length: 128 }), // 通话时长
    highlights: jsonb().$type<string[]>().default([]), // 亮点标签
    description: d.text(),
    purchaseLink: d.text(),
    sortOrder: d.integer().notNull().default(0),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('sim_card_pkg_active_idx').on(t.isActive),
    index('sim_card_pkg_sort_idx').on(t.sortOrder),
  ],
);

// simCardClickLogs — 点击埋点日志
export const simCardClickLogs = createTable(
  'sim_card_click_log',
  (d) => ({
    id: serial('id').primaryKey(),
    packageId: d.varchar({ length: 36 }).notNull(),
    packageTitle: d.varchar({ length: 256 }).notNull(), // 冗余，防删后丢失
    dingtalkUserid: d.varchar({ length: 64 }).notNull(),
    userName: d.varchar({ length: 50 }),
    userPhone: d.varchar({ length: 20 }),
    department: d.text(),
    jobNumber: d.varchar({ length: 50 }),
    userAgent: d.text(),
    ipAddress: d.varchar({ length: 64 }),
    deviceInfo: d.text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('sim_card_click_pkg_idx').on(t.packageId),
    index('sim_card_click_user_idx').on(t.dingtalkUserid),
    index('sim_card_click_created_idx').on(t.createdAt),
  ],
);
