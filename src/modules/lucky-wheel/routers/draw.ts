import { TRPCError } from '@trpc/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  wheelActivities,
  wheelDrawRecords,
} from '@/modules/lucky-wheel/schema';
import { executeDraw } from '@/modules/lucky-wheel/services/draw-engine';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { drawLimiter } from '@/server/services/rate-limiter';

export const drawRouter = createTRPCRouter({
  execute: protectedProcedure
    .input(z.object({ activityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Rate limit check
      const rateCheck = drawLimiter.check(ctx.session.user.id);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `操作过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      try {
        const result = await executeDraw(
          ctx.db,
          input.activityId,
          ctx.session.user.id,
        );
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : '抽奖失败，请稍后重试';
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message,
        });
      }
    }),

  getRemainingDraws: protectedProcedure
    .input(z.object({ activityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const activity = await ctx.db.query.wheelActivities.findFirst({
        where: eq(wheelActivities.id, input.activityId),
      });

      if (!activity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '活动不存在' });
      }

      const userId = ctx.session.user.id;
      const hasTotal = activity.maxDrawsPerUser > 0;
      const hasDaily = activity.maxDrawsPerDay > 0;

      // Unlimited draws
      if (!hasTotal && !hasDaily) {
        return { remaining: -1, isUnlimited: true } as const;
      }

      let remainingTotal = Infinity;
      let remainingDaily = Infinity;

      if (hasTotal) {
        const [row] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(wheelDrawRecords)
          .where(
            and(
              eq(wheelDrawRecords.activityId, input.activityId),
              eq(wheelDrawRecords.userId, userId),
            ),
          );
        remainingTotal = activity.maxDrawsPerUser - (row?.count ?? 0);
      }

      if (hasDaily) {
        const todayStart = new Date(
          `${new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Shanghai',
          })}T00:00:00+08:00`,
        );

        const [row] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(wheelDrawRecords)
          .where(
            and(
              eq(wheelDrawRecords.activityId, input.activityId),
              eq(wheelDrawRecords.userId, userId),
              gte(wheelDrawRecords.createdAt, todayStart),
            ),
          );
        remainingDaily = activity.maxDrawsPerDay - (row?.count ?? 0);
      }

      const remaining = Math.max(0, Math.min(remainingTotal, remainingDaily));
      return { remaining, isUnlimited: false } as const;
    }),
});
