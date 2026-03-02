import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type WheelUserInfo,
  wheelActivities,
  wheelDrawRecords,
} from '@/modules/lucky-wheel/schema';
import {
  executeDraw,
  resolveDrawLimit,
} from '@/modules/lucky-wheel/services/draw-engine';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { drawLimiter } from '@/server/services/rate-limiter';

export const drawRouter = createTRPCRouter({
  execute: protectedProcedure
    .input(
      z.object({
        activityId: z.string(),
        // 姓名和地址由客户端收集，做 trim 和长度限制防止脏数据写入 DB
        name: z.string().trim().max(100).optional(),
        address: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 频率限制检查
      const rateCheck = drawLimiter.check(ctx.session.user.id);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `操作过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      const sessionUser = ctx.session.user as {
        id: string;
        name: string;
        phoneNumber?: string | null;
      };

      // 构建 userInfo 快照，随抽奖记录一次性写入
      const userInfo: WheelUserInfo = {
        name: input.name ?? sessionUser.name,
        phone: sessionUser.phoneNumber ?? null,
        address: input.address ?? null,
      };

      try {
        return await executeDraw(
          ctx.db,
          input.activityId,
          ctx.session.user.id,
          userInfo,
        );
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
        where: and(
          eq(wheelActivities.id, input.activityId),
          eq(wheelActivities.isActive, true),
        ),
      });

      if (!activity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '活动不存在' });
      }

      const userId = ctx.session.user.id;
      const totalAllowed = await resolveDrawLimit(
        ctx.db,
        input.activityId,
        userId,
        activity.maxDrawsPerUser,
      );

      // totalAllowed 为 0 表示不限次数
      if (totalAllowed === 0) {
        return { remaining: -1, isUnlimited: true } as const;
      }

      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(wheelDrawRecords)
        .where(
          and(
            eq(wheelDrawRecords.activityId, input.activityId),
            eq(wheelDrawRecords.userId, userId),
          ),
        );

      const remaining = Math.max(0, totalAllowed - (row?.count ?? 0));
      return { remaining, isUnlimited: false } as const;
    }),
});
