import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { hasPaidOrder } from '@/modules/soulscope/services/payment-check';
import {
  ensureReportRecord,
  generateReport,
} from '@/modules/soulscope/services/report-generator';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { aiReports, testResults } from '@/server/db/schema';
import { reportGenerateLimiter } from '@/server/services/rate-limiter';

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

      // Synchronously create/claim the report record so we always have a reportId
      const record = await ensureReportRecord(
        input.resultId,
        ctx.session.user.id,
      );

      if (!record) {
        // Another process is already generating — look up the existing record
        const existing = await ctx.db.query.aiReports.findFirst({
          where: eq(aiReports.resultId, input.resultId),
        });
        return {
          reportId: existing?.id ?? null,
          status: 'generating' as const,
        };
      }

      if (record.alreadyCompleted) {
        return { reportId: record.reportId, status: 'completed' as const };
      }

      // Fire-and-forget: the DB record already exists, generator only updates it
      const generator = generateReport(record.reportId, input.resultId);
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

      return {
        reportId: record.reportId,
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
