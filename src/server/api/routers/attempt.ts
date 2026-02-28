import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
  questions,
  testAnswers,
  testAttempts,
  testResults,
  testTypes,
} from '@/server/db/schema';
import { calculateScore, type ScoringInput } from '@/server/services/scoring';

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

  submitAnswer: protectedProcedure
    .input(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        selectedValue: z.string(),
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

      // Check for duplicate answer
      const existingAnswer = await ctx.db.query.testAnswers.findFirst({
        where: and(
          eq(testAnswers.attemptId, input.attemptId),
          eq(testAnswers.questionId, input.questionId),
        ),
      });

      if (existingAnswer) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该题目已回答，不可重复提交',
        });
      }

      const question = await ctx.db.query.questions.findFirst({
        where: and(
          eq(questions.id, input.questionId),
          eq(questions.testTypeId, attempt.testTypeId),
        ),
      });

      if (!question) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Question not found',
        });
      }

      // Calculate score contribution from the selected option
      const selectedOption = question.options.find(
        (o) => o.value === input.selectedValue,
      );
      const scoreContribution: Record<string, number> = {};
      if (selectedOption) {
        const dim = selectedOption.dimension ?? question.dimension ?? 'default';
        scoreContribution[dim] = selectedOption.score ?? 0;
      }

      const id = nanoid();
      await ctx.db.insert(testAnswers).values({
        id,
        attemptId: input.attemptId,
        questionId: input.questionId,
        selectedValue: input.selectedValue,
        scoreContribution,
      });

      // Update current question index
      await ctx.db
        .update(testAttempts)
        .set({ currentQuestionIndex: attempt.currentQuestionIndex + 1 })
        .where(eq(testAttempts.id, input.attemptId));

      return { id };
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

      const answerValues = uniqueAnswers.map((answer) => {
        // questionMap.get is guaranteed to succeed since we validated above
        const question = questionMap.get(answer.questionId);
        const scoreContribution: Record<string, number> = {};
        if (question) {
          const selectedOption = question.options.find(
            (o) => o.value === answer.selectedValue,
          );
          if (selectedOption) {
            const dim =
              selectedOption.dimension ?? question.dimension ?? 'default';
            scoreContribution[dim] = selectedOption.score ?? 0;
          }
        }

        return {
          id: nanoid(),
          attemptId: input.attemptId,
          questionId: answer.questionId,
          selectedValue: answer.selectedValue,
          scoreContribution,
        };
      });

      let insertedCount = 0;
      if (answerValues.length > 0) {
        const inserted = await ctx.db
          .insert(testAnswers)
          .values(answerValues)
          .onConflictDoNothing()
          .returning({ id: testAnswers.id });
        insertedCount = inserted.length;
      }

      // Update current question index based on actually inserted rows
      if (insertedCount > 0) {
        await ctx.db
          .update(testAttempts)
          .set({
            currentQuestionIndex: attempt.currentQuestionIndex + insertedCount,
          })
          .where(eq(testAttempts.id, input.attemptId));
      }

      return { count: insertedCount };
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

      if (attempt.answers.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '请至少回答一道题目后再提交',
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

      // Use transaction to ensure attempt status and result are saved atomically
      const resultId = nanoid();
      const shareToken = nanoid();
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(testAttempts)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(testAttempts.id, input.attemptId));

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
