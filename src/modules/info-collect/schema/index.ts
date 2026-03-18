import { index, jsonb, pgEnum } from 'drizzle-orm/pg-core';

import { createTable } from '@/server/db/table-creator';

export const infoCollectStatusEnum = pgEnum('info_collect_status', [
  'pending',
  'approved',
  'rejected',
  'needs_supplement',
  'completed',
]);

export type InfoCollectConfigFields = ('name' | 'proofImage')[];

export const infoCollectConfig = createTable('info_collect_config', (d) => ({
  id: d.varchar({ length: 36 }).primaryKey(),
  bannerUrl: d.text(),
  enabledFields: jsonb().$type<InfoCollectConfigFields>().notNull(),
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
    name: d.varchar({ length: 50 }),
    phone: d.varchar({ length: 20 }).notNull(),
    idCard: d.varchar({ length: 18 }).notNull(),
    proofImageUrl: d.text(),
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
    index('info_collect_phone_idx').on(t.phone),
    index('info_collect_status_idx').on(t.status),
    index('info_collect_id_card_idx').on(t.idCard),
  ],
);
