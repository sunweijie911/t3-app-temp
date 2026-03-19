import { asc, eq } from 'drizzle-orm';

import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { batterySwapPackages } from '@/server/db/schema';

import { batterySwapAdminRouter } from './admin';

export const batterySwapRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(batterySwapPackages)
      .where(eq(batterySwapPackages.isActive, true))
      .orderBy(asc(batterySwapPackages.sortOrder));
  }),

  admin: batterySwapAdminRouter,
});
