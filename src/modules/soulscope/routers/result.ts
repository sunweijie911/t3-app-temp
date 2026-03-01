import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { hasPaidOrder } from '@/modules/soulscope/services/payment-check';
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from '@/server/api/trpc';
import { aiReports, testResults } from '@/server/db/schema';

export const resultRouter = createTRPCRouter({
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.query.testResults.findFirst({
        where: and(
          eq(testResults.id, input.id),
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

      // Check if an AI report exists
      const report = await ctx.db.query.aiReports.findFirst({
        where: eq(aiReports.resultId, input.id),
      });

      // Check if there's a paid order for this result
      const hasPaid = await hasPaidOrder(ctx.db, ctx.session.user.id, input.id);

      return {
        ...result,
        hasReport: !!report,
        reportStatus: report?.status ?? null,
        hasPaidOrder: hasPaid,
      };
    }),

  getByShareToken: publicProcedure
    .input(z.object({ shareToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.query.testResults.findFirst({
        where: eq(testResults.shareToken, input.shareToken),
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

      // Return without sensitive user/config details
      const { userId, ...publicResult } = result;
      const safeTestType = result.testType
        ? {
            name: result.testType.name,
            slug: result.testType.slug,
            description: result.testType.description,
            shortDescription: result.testType.shortDescription,
            iconUrl: result.testType.iconUrl,
          }
        : null;
      return { ...publicResult, testType: safeTestType };
    }),

  myResults: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.testResults.findMany({
      where: eq(testResults.userId, ctx.session.user.id),
      with: {
        testType: true,
      },
      orderBy: [desc(testResults.createdAt)],
    });

    return results;
  }),
});
