import { asc, eq } from 'drizzle-orm';

import { BANNER_CONFIG_KEY } from '@/modules/battery-swap/constants';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { batterySwapPackages, systemConfig } from '@/server/db/schema';

import { batterySwapAdminRouter } from './admin';

export const batterySwapRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(batterySwapPackages)
      .where(eq(batterySwapPackages.isActive, true))
      .orderBy(asc(batterySwapPackages.sortOrder));
  }),

  bannerUrl: publicProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, BANNER_CONFIG_KEY))
      .limit(1);
    const v = row[0]?.value;
    return typeof v === 'string' ? v : null;
  }),

  admin: batterySwapAdminRouter,
});
