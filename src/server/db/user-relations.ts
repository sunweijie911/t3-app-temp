import { relations } from 'drizzle-orm';
import { wheelDrawRecords } from '@/modules/lucky-wheel/schema';
import {
  aiReports,
  orders,
  testAttempts,
  testResults,
} from '@/modules/soulscope/schema';
import { account, session, user } from './auth-schema';

/**
 * Centralized user relations — Drizzle only allows one `relations()` call per
 * table, so every module that relates to `user` must register its tables here.
 *
 * When adding a new module, import its user-linked tables and append them to
 * the `many()` list below.
 */
export const userRelations = relations(user, ({ many }) => ({
  // auth
  account: many(account),
  session: many(session),
  // soulscope
  testAttempts: many(testAttempts),
  testResults: many(testResults),
  aiReports: many(aiReports),
  orders: many(orders),
  // lucky-wheel
  wheelDrawRecords: many(wheelDrawRecords),
}));
