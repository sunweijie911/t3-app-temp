import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { wheelActivities, wheelPrizes } from '@/server/db/schema';

export const activityRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    const now = new Date();
    return ctx.db
      .select({
        id: wheelActivities.id,
        name: wheelActivities.name,
        slug: wheelActivities.slug,
        description: wheelActivities.description,
        coverImage: wheelActivities.coverImage,
        startAt: wheelActivities.startAt,
        endAt: wheelActivities.endAt,
        maxDrawsPerUser: wheelActivities.maxDrawsPerUser,
        maxDrawsPerDay: wheelActivities.maxDrawsPerDay,
      })
      .from(wheelActivities)
      .where(
        and(
          eq(wheelActivities.isActive, true),
          or(
            isNull(wheelActivities.startAt),
            lte(wheelActivities.startAt, now),
          ),
          or(isNull(wheelActivities.endAt), gte(wheelActivities.endAt, now)),
        ),
      )
      .orderBy(asc(wheelActivities.sortOrder));
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select()
        .from(wheelActivities)
        .where(
          and(
            eq(wheelActivities.slug, input.slug),
            eq(wheelActivities.isActive, true),
          ),
        )
        .limit(1);

      const activity = results[0];
      if (!activity) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '活动不存在',
        });
      }

      // Fetch prizes for this activity
      const prizes = await ctx.db
        .select({
          id: wheelPrizes.id,
          name: wheelPrizes.name,
          image: wheelPrizes.image,
          type: wheelPrizes.type,
          sortOrder: wheelPrizes.sortOrder,
        })
        .from(wheelPrizes)
        .where(
          and(
            eq(wheelPrizes.activityId, activity.id),
            eq(wheelPrizes.isActive, true),
          ),
        )
        .orderBy(asc(wheelPrizes.sortOrder));

      return { ...activity, prizes };
    }),
});
