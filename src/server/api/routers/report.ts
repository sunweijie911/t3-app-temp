import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { aiReports, testResults } from '@/server/db/schema';
import { hasPaidOrder } from '@/server/services/payment-check';
import { reportGenerateLimiter } from '@/server/services/rate-limiter';
import { generateReport } from '@/server/services/report-generator';

export const reportRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ resultId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify user owns the result
      const result = await ctx.db.query.testResults.findFirst({
        where: and(
          eq(testResults.id, input.resultId),
          eq(testResults.userId, ctx.session.user.id),
        ),
      });

      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Result not found',
        });
      }

      const report = await ctx.db.query.aiReports.findFirst({
        where: eq(aiReports.resultId, input.resultId),
      });

      if (!report) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Report not found',
        });
      }

      // Only return content fields, hide model/token internals
      return {
        id: report.id,
        resultId: report.resultId,
        status: report.status,
        content: report.content,
        createdAt: report.createdAt,
        completedAt: report.completedAt,
      };
    }),

  generate: protectedProcedure
    .input(z.object({ resultId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify user owns the result
      const result = await ctx.db.query.testResults.findFirst({
        where: and(
          eq(testResults.id, input.resultId),
          eq(testResults.userId, ctx.session.user.id),
        ),
        with: {
          testType: true,
        },
      });

      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Result not found',
        });
      }

      // Rate limit check
      const rateCheck = reportGenerateLimiter.check(ctx.session.user.id);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `请求过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      // Verify user has a paid order for this result
      const hasPaid = await hasPaidOrder(
        ctx.db,
        ctx.session.user.id,
        input.resultId,
      );

      if (!hasPaid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Payment required to generate report',
        });
      }

      // Check if a completed or in-progress report already exists
      const existingReport = await ctx.db.query.aiReports.findFirst({
        where: eq(aiReports.resultId, input.resultId),
      });

      if (existingReport?.status === 'completed') {
        return { reportId: existingReport.id, status: 'completed' as const };
      }

      if (existingReport?.status === 'generating') {
        return {
          reportId: existingReport.id,
          status: 'generating' as const,
        };
      }

      // Fire-and-forget: generateReport manages its own DB record lifecycle
      // (creates record as 'generating', updates to 'completed'/'failed')
      const generator = generateReport(input.resultId, ctx.session.user.id);
      void (async () => {
        try {
          let chunk = await generator.next();
          while (!chunk.done) {
            chunk = await generator.next();
          }
        } catch (_error) {
          // generateReport already marks the report as failed in the DB
        }
      })();

      // Return immediately — frontend should poll report.status
      const report = await ctx.db.query.aiReports.findFirst({
        where: eq(aiReports.resultId, input.resultId),
      });

      return {
        reportId: report?.id ?? null,
        status: 'generating' as const,
      };
    }),

  status: protectedProcedure
    .input(z.object({ resultId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify user owns the result
      const result = await ctx.db.query.testResults.findFirst({
        where: and(
          eq(testResults.id, input.resultId),
          eq(testResults.userId, ctx.session.user.id),
        ),
      });

      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Result not found',
        });
      }

      const report = await ctx.db.query.aiReports.findFirst({
        where: eq(aiReports.resultId, input.resultId),
      });

      return {
        status: report?.status ?? null,
        hasReport: !!report,
      };
    }),
});
