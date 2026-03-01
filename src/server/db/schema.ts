import { jsonb } from 'drizzle-orm/pg-core';

import { createTable } from './table-creator';

export * from '@/modules/lucky-wheel/schema';
export * from '@/modules/soulscope/schema';
export * from './auth-schema';
export { createTable } from './table-creator';
export * from './user-relations';

// systemConfig - KV store for system configuration (shared across modules)
export const systemConfig = createTable('system_config', (d) => ({
  key: d.varchar({ length: 256 }).primaryKey(),
  value: jsonb().notNull(),
  description: d.text(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
}));
