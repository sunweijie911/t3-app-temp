import { index, jsonb } from 'drizzle-orm/pg-core';

import { createTable } from '@/server/db/table-creator';

// 套餐规格类型
export type PackageSpec = {
  model: string; // 电池型号，如 "48V 20Ah"
  price: number; // 该规格价格（分）
};

// 价格：分 → 元（展示用）
export function formatPrice(fen: number) {
  return (fen / 100).toFixed(2);
}

// batterySwapPackages — 换电套餐
export const batterySwapPackages = createTable(
  'battery_swap_package',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    company: d.varchar({ length: 128 }).notNull(),
    title: d.varchar({ length: 256 }).notNull(),
    imageUrl: d.text(),
    detailImageUrl: d.text(), // 详情长图
    cardBgColor: d.varchar({ length: 32 }).default('#ffffff'), // 卡片背景色
    originalPrice: d.integer().notNull(), // 划线价（分）
    salePrice: d.integer().notNull(), // 最低销售价（分）
    specs: jsonb().$type<PackageSpec[]>().notNull(),
    depositMethod: d.varchar({ length: 128 }).default('芝麻信用抵押金'),
    regionLimit: d.text(),
    purchaseNotes: d.text(),
    validFrom: d.timestamp({ withTimezone: true }),
    validTo: d.timestamp({ withTimezone: true }),
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
    index('battery_swap_pkg_active_idx').on(t.isActive),
    index('battery_swap_pkg_sort_idx').on(t.sortOrder),
  ],
);
