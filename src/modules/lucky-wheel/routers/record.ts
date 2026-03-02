import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { wheelDrawRecords } from '@/server/db/schema';

export const recordRouter = createTRPCRouter({
  myRecords: protectedProcedure.query(async ({ ctx }) => {
    const records = await ctx.db.query.wheelDrawRecords.findMany({
      where: eq(wheelDrawRecords.userId, ctx.session.user.id),
      with: {
        activity: true,
        prize: true,
      },
      orderBy: [desc(wheelDrawRecords.createdAt)],
    });

    return records;
  }),

  // 查询用户在某活动中最近一次的 userInfo 快照，用于跳过重复填写弹窗
  getMyUserInfo: protectedProcedure
    .input(z.object({ activityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const record = await ctx.db.query.wheelDrawRecords.findFirst({
        where: and(
          eq(wheelDrawRecords.activityId, input.activityId),
          eq(wheelDrawRecords.userId, ctx.session.user.id),
        ),
        columns: { userInfo: true },
        orderBy: [desc(wheelDrawRecords.createdAt)],
      });

      return record?.userInfo ?? null;
    }),
});
