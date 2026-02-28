import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { testTypes } from '@/server/db/schema';

export const testRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        id: testTypes.id,
        name: testTypes.name,
        slug: testTypes.slug,
        shortDescription: testTypes.shortDescription,
        iconUrl: testTypes.iconUrl,
        coverImageUrl: testTypes.coverImageUrl,
        questionCount: testTypes.questionCount,
        estimatedMinutes: testTypes.estimatedMinutes,
        isFeatured: testTypes.isFeatured,
        reportPrice: testTypes.reportPrice,
      })
      .from(testTypes)
      .where(eq(testTypes.isActive, true))
      .orderBy(asc(testTypes.sortOrder));

    return results;
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const testType = await ctx.db.query.testTypes.findFirst({
        where: and(
          eq(testTypes.slug, input.slug),
          eq(testTypes.isActive, true),
        ),
      });

      if (!testType) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Test type not found',
        });
      }

      return testType;
    }),

  getFeatured: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select()
      .from(testTypes)
      .where(and(eq(testTypes.isFeatured, true), eq(testTypes.isActive, true)))
      .orderBy(asc(testTypes.sortOrder))
      .limit(4);

    return results;
  }),
});
