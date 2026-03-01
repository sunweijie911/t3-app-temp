import { desc, eq } from 'drizzle-orm';
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
});
