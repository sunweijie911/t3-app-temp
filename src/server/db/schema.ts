import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Business tables use a "pg-drizzle_" prefix to avoid naming conflicts.
export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

// Auth tables (user, session, account, verification) use pgTable WITHOUT the
// prefix because Better Auth expects fixed table names. Do not change these
// to createTable — it would break authentication.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified')
    .$defaultFn(() => false)
    .notNull(),
  image: text('image'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp('updated_at').$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
  testAttempts: many(testAttempts),
  testResults: many(testResults),
  aiReports: many(aiReports),
  orders: many(orders),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

// ============================================================
// AI Personality Test Platform Tables
// ============================================================

export const scoringStrategyEnum = pgEnum('scoring_strategy', [
  'dimension',
  'category',
  'scale',
  'composite',
]);

export const questionSourceEnum = pgEnum('question_source', [
  'preset',
  'ai_generated',
]);

export const attemptStatusEnum = pgEnum('attempt_status', [
  'in_progress',
  'completed',
  'abandoned',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'pending',
  'generating',
  'completed',
  'failed',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
]);

// 1. testTypes - 10 personality test type definitions
export const testTypes = createTable(
  'test_type',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    name: d.varchar({ length: 256 }).notNull(),
    slug: d.varchar({ length: 128 }).notNull(),
    description: d.text().notNull(),
    shortDescription: d.varchar({ length: 512 }).notNull(),
    iconUrl: d.text(),
    coverImageUrl: d.text(),
    scoringStrategy: scoringStrategyEnum().notNull(),
    scoringConfig: jsonb().$type<Record<string, unknown>>().notNull(),
    resultDefinitions: jsonb().$type<Record<string, unknown>>().notNull(),
    questionCount: d.integer().notNull().default(0),
    estimatedMinutes: d.integer().notNull().default(10),
    isFeatured: d.boolean().notNull().default(false),
    isActive: d.boolean().notNull().default(true),
    sortOrder: d.integer().notNull().default(0),
    reportPrice: d
      .numeric({ precision: 10, scale: 2 })
      .notNull()
      .default('9.90'),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex('test_type_slug_idx').on(t.slug),
    index('test_type_active_idx').on(t.isActive),
    index('test_type_featured_idx').on(t.isFeatured),
  ],
);

// 2. questions - test question bank
export const questions = createTable(
  'question',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    testTypeId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testTypes.id, { onDelete: 'cascade' }),
    text: d.text().notNull(),
    description: d.text(),
    options: jsonb()
      .$type<
        Array<{
          value: string;
          label: string;
          score?: number;
          dimension?: string;
        }>
      >()
      .notNull(),
    dimension: d.varchar({ length: 64 }),
    weight: d.numeric({ precision: 5, scale: 2 }).notNull().default('1.00'),
    source: questionSourceEnum().notNull().default('preset'),
    sortOrder: d.integer().notNull().default(0),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('question_test_type_idx').on(t.testTypeId),
    index('question_source_idx').on(t.source),
  ],
);

// 3. testAttempts - user test sessions
export const testAttempts = createTable(
  'test_attempt',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    testTypeId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testTypes.id),
    status: attemptStatusEnum().notNull().default('in_progress'),
    currentQuestionIndex: d.integer().notNull().default(0),
    totalQuestions: d.integer().notNull(),
    startedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('attempt_user_idx').on(t.userId),
    index('attempt_test_type_idx').on(t.testTypeId),
    index('attempt_status_idx').on(t.status),
  ],
);

// 4. testAnswers - individual question answers
export const testAnswers = createTable(
  'test_answer',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    attemptId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testAttempts.id, { onDelete: 'cascade' }),
    questionId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => questions.id),
    selectedValue: d.text().notNull(),
    scoreContribution: jsonb().$type<Record<string, number>>(),
    answeredAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('answer_attempt_idx').on(t.attemptId),
    index('answer_question_idx').on(t.questionId),
    uniqueIndex('answer_attempt_question_idx').on(t.attemptId, t.questionId),
  ],
);

// 5. testResults - calculated test results
export const testResults = createTable(
  'test_result',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    attemptId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testAttempts.id, { onDelete: 'cascade' }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    testTypeId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testTypes.id),
    resultCode: d.varchar({ length: 64 }).notNull(),
    resultLabel: d.varchar({ length: 256 }).notNull(),
    dimensionScores: jsonb().$type<Record<string, number>>().notNull(),
    summary: d.text().notNull(),
    shareToken: d.varchar({ length: 64 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index('result_user_idx').on(t.userId),
    uniqueIndex('result_attempt_idx').on(t.attemptId),
    uniqueIndex('result_share_token_idx').on(t.shareToken),
  ],
);

// 6. aiReports - AI-generated analysis reports
export const aiReports = createTable(
  'ai_report',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    resultId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testResults.id, { onDelete: 'cascade' }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: reportStatusEnum().notNull().default('pending'),
    content: d.text(),
    modelUsed: d.varchar({ length: 128 }),
    promptTokens: d.integer(),
    completionTokens: d.integer(),
    generationTimeMs: d.integer(),
    errorMessage: d.text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: d.timestamp({ withTimezone: true }),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex('report_result_idx').on(t.resultId),
    index('report_user_idx').on(t.userId),
    index('report_status_idx').on(t.status),
  ],
);

// 7. orders - payment records
export const orders = createTable(
  'order',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    resultId: d
      .varchar({ length: 36 })
      .notNull()
      .references(() => testResults.id),
    amount: d.numeric({ precision: 10, scale: 2 }).notNull(),
    currency: d.varchar({ length: 8 }).notNull().default('CNY'),
    status: orderStatusEnum().notNull().default('pending'),
    paymentMethod: d.varchar({ length: 64 }),
    paymentId: d.varchar({ length: 256 }),
    paidAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('order_user_idx').on(t.userId),
    index('order_result_idx').on(t.resultId),
    index('order_status_idx').on(t.status),
  ],
);

// 8. systemConfig - KV store for system configuration
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

// ============================================================
// Relations for new tables
// ============================================================

export const testTypeRelations = relations(testTypes, ({ many }) => ({
  questions: many(questions),
  attempts: many(testAttempts),
  results: many(testResults),
}));

export const questionRelations = relations(questions, ({ one, many }) => ({
  testType: one(testTypes, {
    fields: [questions.testTypeId],
    references: [testTypes.id],
  }),
  answers: many(testAnswers),
}));

export const testAttemptRelations = relations(
  testAttempts,
  ({ one, many }) => ({
    user: one(user, { fields: [testAttempts.userId], references: [user.id] }),
    testType: one(testTypes, {
      fields: [testAttempts.testTypeId],
      references: [testTypes.id],
    }),
    answers: many(testAnswers),
    result: one(testResults),
  }),
);

export const testAnswerRelations = relations(testAnswers, ({ one }) => ({
  attempt: one(testAttempts, {
    fields: [testAnswers.attemptId],
    references: [testAttempts.id],
  }),
  question: one(questions, {
    fields: [testAnswers.questionId],
    references: [questions.id],
  }),
}));

export const testResultRelations = relations(testResults, ({ one, many }) => ({
  attempt: one(testAttempts, {
    fields: [testResults.attemptId],
    references: [testAttempts.id],
  }),
  user: one(user, { fields: [testResults.userId], references: [user.id] }),
  testType: one(testTypes, {
    fields: [testResults.testTypeId],
    references: [testTypes.id],
  }),
  report: one(aiReports),
  orders: many(orders),
}));

export const aiReportRelations = relations(aiReports, ({ one }) => ({
  result: one(testResults, {
    fields: [aiReports.resultId],
    references: [testResults.id],
  }),
  user: one(user, { fields: [aiReports.userId], references: [user.id] }),
}));

export const orderRelations = relations(orders, ({ one }) => ({
  user: one(user, { fields: [orders.userId], references: [user.id] }),
  result: one(testResults, {
    fields: [orders.resultId],
    references: [testResults.id],
  }),
}));
