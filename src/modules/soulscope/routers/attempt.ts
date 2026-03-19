import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  calculateScore,
  type ScoringInput,
} from '@/modules/soulscope/services/scoring';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
  questions,
  testAnswers,
  testAttempts,
  testResults,
  testTypes,
} from '@/server/db/schema';

export const attemptRouter = createTRPCRouter({
  start: protectedProcedure
    .input(z.object({ testTypeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const testType = await ctx.db.query.testTypes.findFirst({
        where: and(
          eq(testTypes.id, input.testTypeId),
          eq(testTypes.isActive, true),
        ),
      });

      if (!testType) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Test type not found',
        });
      }

      // Auto-cleanup user's old in_progress attempts (older than 2 hours)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await ctx.db
        .update(testAttempts)
        .set({ status: 'abandoned' })
        .where(
          and(
            eq(testAttempts.userId, ctx.session.user.id),
            eq(testAttempts.status, 'in_progress'),
            lt(testAttempts.createdAt, twoHoursAgo),
          ),
        );

      const id = nanoid();
      await ctx.db.insert(testAttempts).values({
        id,
        userId: ctx.session.user.id,
        testTypeId: input.testTypeId,
        totalQuestions: testType.questionCount,
      });

      return { id };
    }),

  getQuestions: protectedProcedure
    .input(z.object({ attemptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const attempt = await ctx.db.query.testAttempts.findFirst({
        where: and(
          eq(testAttempts.id, input.attemptId),
          eq(testAttempts.userId, ctx.session.user.id),
        ),
      });

      if (!attempt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Attempt not found',
        });
      }

      const questionList = await ctx.db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.testTypeId, attempt.testTypeId),
            eq(questions.isActive, true),
          ),
        )
        .orderBy(asc(questions.sortOrder));

      return questionList;
    }),

  submitBatch: protectedProcedure
    .input(
      z.object({
        attemptId: z.string(),
        answers: z.array(
          z.object({
            questionId: z.string(),
            selectedValue: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.db.query.testAttempts.findFirst({
        where: and(
          eq(testAttempts.id, input.attemptId),
          eq(testAttempts.userId, ctx.session.user.id),
        ),
      });

      if (!attempt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Attempt not found',
        });
      }

      if (attempt.status !== 'in_progress') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该测试已结束，无法继续提交答案',
        });
      }

      // Deduplicate answers by questionId (keep last)
      const deduped = new Map(input.answers.map((a) => [a.questionId, a]));
      const uniqueAnswers = Array.from(deduped.values());

      // Fetch all questions for score calculation
      const questionList = await ctx.db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.testTypeId, attempt.testTypeId),
            eq(questions.isActive, true),
          ),
        );

      const questionMap = new Map(questionList.map((q) => [q.id, q]));

      // Validate all questionIds belong to this test type
      const unknownIds = uniqueAnswers.filter(
        (a) => !questionMap.has(a.questionId),
      );
      if (unknownIds.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '包含无效的题目ID',
        });
      }

      const answerValues = uniqueAnswers.map((answer) => ({
        id: nanoid(),
        attemptId: input.attemptId,
        questionId: answer.questionId,
        selectedValue: answer.selectedValue,
      }));

      if (answerValues.length > 0) {
        await ctx.db
          .insert(testAnswers)
          .values(answerValues)
          .onConflictDoUpdate({
            target: [testAnswers.attemptId, testAnswers.questionId],
            set: {
              selectedValue: sql`excluded."selectedValue"`,
            },
          });
      }

      // Update progress based on total answered questions
      const [countRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(testAnswers)
        .where(eq(testAnswers.attemptId, input.attemptId));

      const totalAnswered = countRow?.count ?? 0;
      await ctx.db
        .update(testAttempts)
        .set({ currentQuestionIndex: totalAnswered })
        .where(eq(testAttempts.id, input.attemptId));

      return { count: totalAnswered };
    }),

  complete: protectedProcedure
    .input(z.object({ attemptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.db.query.testAttempts.findFirst({
        where: and(
          eq(testAttempts.id, input.attemptId),
          eq(testAttempts.userId, ctx.session.user.id),
        ),
        with: {
          testType: true,
          answers: true,
        },
      });

      if (!attempt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Attempt not found',
        });
      }

      // Idempotency: if already completed, return existing result
      if (attempt.status === 'completed') {
        const existingResult = await ctx.db.query.testResults.findFirst({
          where: eq(testResults.attemptId, input.attemptId),
        });
        if (existingResult) {
          return { resultId: existingResult.id };
        }
      }

      if (attempt.status !== 'in_progress') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该测试已结束，不可重复提交',
        });
      }

      // Fetch full question data for scoring
      const questionList = await ctx.db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.testTypeId, attempt.testTypeId),
            eq(questions.isActive, true),
          ),
        );

      if (attempt.answers.length < questionList.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `请完成所有题目后再提交（已答 ${attempt.answers.length}/${questionList.length}）`,
        });
      }

      const questionMap = new Map(questionList.map((q) => [q.id, q]));

      // Build scoring input
      const scoringInput: ScoringInput = {
        answers: attempt.answers.map((a) => {
          const q = questionMap.get(a.questionId);
          return {
            questionId: a.questionId,
            selectedValue: a.selectedValue,
            dimension: q?.dimension ?? null,
            options: q?.options ?? [],
          };
        }),
        scoringStrategy: attempt.testType.scoringStrategy,
        scoringConfig: attempt.testType.scoringConfig,
        resultDefinitions: attempt.testType.resultDefinitions,
      };

      // Calculate scores
      const scoreResult = calculateScore(scoringInput);

      const resultId = nanoid();
      const shareToken = nanoid();
      let raceResultId: string | undefined;

      // 原子操作：在事务内先抢占 attempt（WHERE status='in_progress'），
      // 若抢占成功才插入结果，否则说明并发请求已完成，直接返回其结果
      await ctx.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(testAttempts)
          .set({ status: 'completed', completedAt: new Date() })
          .where(
            and(
              eq(testAttempts.id, input.attemptId),
              eq(testAttempts.status, 'in_progress'),
            ),
          )
          .returning({ id: testAttempts.id });

        if (!claimed) {
          // 并发请求已完成，查找其插入的结果
          const existing = await tx.query.testResults.findFirst({
            where: eq(testResults.attemptId, input.attemptId),
          });
          raceResultId = existing?.id;
          return;
        }

        await tx.insert(testResults).values({
          id: resultId,
          attemptId: input.attemptId,
          userId: ctx.session.user.id,
          testTypeId: attempt.testTypeId,
          resultCode: scoreResult.resultCode,
          resultLabel: scoreResult.resultLabel,
          dimensionScores: scoreResult.dimensionScores,
          summary: scoreResult.summary,
          shareToken,
        });
      });

      if (raceResultId !== undefined) {
        return { resultId: raceResultId };
      }

      return { resultId };
    }),

  myAttempts: protectedProcedure.query(async ({ ctx }) => {
    const attempts = await ctx.db.query.testAttempts.findMany({
      where: eq(testAttempts.userId, ctx.session.user.id),
      with: {
        testType: true,
      },
      orderBy: [desc(testAttempts.createdAt)],
    });

    return attempts;
  }),
});
