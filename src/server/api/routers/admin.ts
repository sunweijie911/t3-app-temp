import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from '@/server/api/trpc';
import {
  orders,
  questions,
  systemConfig,
  testAttempts,
  testTypes,
  user,
} from '@/server/db/schema';
import { isAdminEmail } from '@/server/services/admin-check';
import { generateQuestions as generateQuestionsService } from '@/server/services/question-generator';
import { questionGenerateLimiter } from '@/server/services/rate-limiter';

export const adminRouter = createTRPCRouter({
  isAdmin: protectedProcedure.query(({ ctx }) => {
    return isAdminEmail(ctx.session.user.email);
  }),
  getQuestions: adminProcedure
    .input(
      z.object({
        testTypeId: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [items, [countResult]] = await Promise.all([
        ctx.db
          .select()
          .from(questions)
          .where(eq(questions.testTypeId, input.testTypeId))
          .orderBy(asc(questions.sortOrder))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(questions)
          .where(eq(questions.testTypeId, input.testTypeId)),
      ]);
      return { items, total: countResult?.count ?? 0 };
    }),

  allOrders: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const [items, [countResult]] = await Promise.all([
        ctx.db
          .select()
          .from(orders)
          .orderBy(desc(orders.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(orders),
      ]);
      return { items, total: countResult?.count ?? 0 };
    }),

  getConfig: adminProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.db.query.systemConfig.findFirst({
        where: eq(systemConfig.key, input.key),
      });

      return config ?? { key: input.key, value: null, description: null };
    }),

  setConfig: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(systemConfig)
        .values({
          key: input.key,
          value: input.value,
          description: input.description,
        })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: {
            value: input.value,
            description: input.description,
          },
        });

      return { success: true };
    }),

  upsertTestType: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        slug: z.string(),
        description: z.string(),
        shortDescription: z.string(),
        iconUrl: z.string().nullable().optional(),
        coverImageUrl: z.string().nullable().optional(),
        scoringStrategy: z.enum([
          'dimension',
          'category',
          'scale',
          'composite',
        ]),
        scoringConfig: z.record(z.string(), z.unknown()),
        resultDefinitions: z.record(z.string(), z.unknown()),
        questionCount: z.number().int().optional(),
        estimatedMinutes: z.number().int().optional(),
        isFeatured: z.boolean().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        reportPrice: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      await ctx.db
        .insert(testTypes)
        .values({
          id,
          name: input.name,
          slug: input.slug,
          description: input.description,
          shortDescription: input.shortDescription,
          iconUrl: input.iconUrl,
          coverImageUrl: input.coverImageUrl,
          scoringStrategy: input.scoringStrategy,
          scoringConfig: input.scoringConfig,
          resultDefinitions: input.resultDefinitions,
          questionCount: input.questionCount ?? 0,
          estimatedMinutes: input.estimatedMinutes ?? 10,
          isFeatured: input.isFeatured ?? false,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
          reportPrice: input.reportPrice ?? '9.90',
        })
        .onConflictDoUpdate({
          target: testTypes.id,
          set: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            shortDescription: input.shortDescription,
            iconUrl: input.iconUrl,
            coverImageUrl: input.coverImageUrl,
            scoringStrategy: input.scoringStrategy,
            scoringConfig: input.scoringConfig,
            resultDefinitions: input.resultDefinitions,
            questionCount:
              input.questionCount ?? sql`${testTypes.questionCount}`,
            estimatedMinutes:
              input.estimatedMinutes ?? sql`${testTypes.estimatedMinutes}`,
            isFeatured: input.isFeatured ?? sql`${testTypes.isFeatured}`,
            isActive: input.isActive ?? sql`${testTypes.isActive}`,
            sortOrder: input.sortOrder ?? sql`${testTypes.sortOrder}`,
            reportPrice: input.reportPrice ?? sql`${testTypes.reportPrice}`,
          },
        });

      return { id };
    }),

  upsertQuestion: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        testTypeId: z.string(),
        text: z.string(),
        description: z.string().nullable().optional(),
        options: z.array(
          z.object({
            value: z.string(),
            label: z.string(),
            score: z.number().optional(),
            dimension: z.string().optional(),
          }),
        ),
        dimension: z.string().nullable().optional(),
        weight: z.string().optional(),
        source: z.enum(['preset', 'ai_generated']).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      await ctx.db
        .insert(questions)
        .values({
          id,
          testTypeId: input.testTypeId,
          text: input.text,
          description: input.description,
          options: input.options,
          dimension: input.dimension,
          weight: input.weight ?? '1.00',
          source: input.source ?? 'preset',
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        })
        .onConflictDoUpdate({
          target: questions.id,
          set: {
            testTypeId: input.testTypeId,
            text: input.text,
            description: input.description,
            options: input.options,
            dimension: input.dimension,
            weight: input.weight ?? sql`${questions.weight}`,
            source: input.source ?? sql`${questions.source}`,
            sortOrder: input.sortOrder ?? sql`${questions.sortOrder}`,
            isActive: input.isActive ?? sql`${questions.isActive}`,
          },
        });

      return { id };
    }),

  importQuestions: adminProcedure
    .input(
      z.object({
        testTypeId: z.string(),
        questions: z.array(
          z.object({
            text: z.string(),
            description: z.string().nullable().optional(),
            options: z.array(
              z.object({
                value: z.string(),
                label: z.string(),
                score: z.number().optional(),
                dimension: z.string().optional(),
              }),
            ),
            dimension: z.string().nullable().optional(),
            weight: z.string().optional(),
            source: z.enum(['preset', 'ai_generated']).optional(),
            sortOrder: z.number().int().optional(),
            isActive: z.boolean().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const values = input.questions.map((q, idx) => ({
        id: nanoid(),
        testTypeId: input.testTypeId,
        text: q.text,
        description: q.description,
        options: q.options,
        dimension: q.dimension,
        weight: q.weight ?? '1.00',
        source: q.source ?? ('preset' as const),
        sortOrder: q.sortOrder ?? idx,
        isActive: q.isActive ?? true,
      }));

      if (values.length > 0) {
        await ctx.db.insert(questions).values(values);
      }

      return { count: values.length };
    }),

  cleanupAbandonedAttempts: adminProcedure
    .input(
      z
        .object({
          thresholdHours: z.number().int().min(1).default(24),
        })
        .default({ thresholdHours: 24 }),
    )
    .mutation(async ({ ctx, input }) => {
      const threshold = new Date(
        Date.now() - input.thresholdHours * 60 * 60 * 1000,
      );

      const result = await ctx.db
        .update(testAttempts)
        .set({ status: 'abandoned' })
        .where(
          and(
            eq(testAttempts.status, 'in_progress'),
            lt(testAttempts.createdAt, threshold),
          ),
        )
        .returning({ id: testAttempts.id });

      return { success: true, count: result.length };
    }),

  generateQuestions: adminProcedure
    .input(
      z.object({
        testTypeId: z.string(),
        count: z.number().int().min(1),
        topic: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limit check
      const rateCheck = questionGenerateLimiter.check(ctx.session.user.id);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `请求过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      const testType = await ctx.db.query.testTypes.findFirst({
        where: eq(testTypes.id, input.testTypeId),
      });

      if (!testType) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Test type not found',
        });
      }

      const generated = await generateQuestionsService(
        input.testTypeId,
        input.count,
        input.topic,
      );

      // Insert generated questions
      const values = generated.map((q, idx) => ({
        id: nanoid(),
        testTypeId: input.testTypeId,
        text: q.text,
        description: q.description ?? null,
        options: q.options,
        dimension: q.dimension ?? null,
        weight: '1.00',
        source: 'ai_generated' as const,
        sortOrder: idx,
        isActive: true,
      }));

      if (values.length > 0) {
        await ctx.db.insert(questions).values(values);
      }

      return { count: values.length, questions: generated };
    }),

  stats: adminProcedure.query(async ({ ctx }) => {
    const [userCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(user);

    const [attemptCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(testAttempts);

    const [completedCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(testAttempts)
      .where(eq(testAttempts.status, 'completed'));

    const [orderCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders);

    const [revenueResult] = await ctx.db
      .select({
        total: sql<string>`coalesce(sum(${orders.amount}::numeric), 0)::text`,
      })
      .from(orders)
      .where(eq(orders.status, 'paid'));

    return {
      totalUsers: userCount?.count ?? 0,
      totalAttempts: attemptCount?.count ?? 0,
      totalCompleted: completedCount?.count ?? 0,
      totalOrders: orderCount?.count ?? 0,
      revenue: revenueResult?.total ?? '0',
    };
  }),
});
