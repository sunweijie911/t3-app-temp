import { index, pgEnum } from 'drizzle-orm/pg-core';

import { createTable } from '@/server/db/table-creator';

export const infoCollectStatusEnum = pgEnum('info_collect_status', [
  'pending',
  'approved',
  'rejected',
  'needs_supplement',
  'completed',
]);

export const infoCollectConfig = createTable('info_collect_config', (d) => ({
  id: d.varchar({ length: 36 }).primaryKey(),
  bannerUrl: d.text(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const infoCollectRecords = createTable(
  'info_collect_record',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    // 钉钉用户信息（免登自动获取）
    dingtalkUserid: d.varchar({ length: 64 }).notNull(),
    name: d.varchar({ length: 50 }),
    phone: d.varchar({ length: 20 }).notNull(),
    department: d.text(),
    position: d.text(),
    jobNumber: d.varchar({ length: 50 }),
    // 用户手动填写
    idCard: d.text().notNull(),
    idCardHash: d.varchar({ length: 64 }).notNull(),
    // 审核流程
    status: infoCollectStatusEnum().notNull().default('pending'),
    rejectReason: d.text(),
    trackingNumber: d.varchar({ length: 100 }),
    shippedAt: d.timestamp({ withTimezone: true }),
    remark: d.text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('info_collect_dingtalk_userid_idx').on(t.dingtalkUserid),
    index('info_collect_status_idx').on(t.status),
    index('info_collect_id_card_hash_idx').on(t.idCardHash),
  ],
);
