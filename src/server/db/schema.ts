import { index, jsonb, serial } from 'drizzle-orm/pg-core';

import { createTable } from './table-creator';

export * from '@/modules/battery-swap/schema';
export * from '@/modules/im-bot/schema';
export * from '@/modules/lucky-wheel/schema';
export * from '@/modules/sim-card/schema';
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

// 后台操作审计日志
export const adminAuditLog = createTable(
  'admin_audit_log',
  (d) => ({
    id: serial('id').primaryKey(),
    userId: d.text('user_id').notNull(),
    userEmail: d.text('user_email'),
    action: d.text('action').notNull(),
    input: jsonb('input'),
    result: d.text('result').notNull(), // 'success' | 'error'
    errorMessage: d.text('error_message'),
    ipAddress: d.text('ip_address'),
    userAgent: d.text('user_agent'),
    createdAt: d
      .timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
  ],
);
