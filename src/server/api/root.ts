import { batterySwapRouter } from '@/modules/battery-swap/routers';
import { infoCollectRouter } from '@/modules/info-collect/routers';
import { luckyWheelRouter } from '@/modules/lucky-wheel/routers';
import { soulscopeRouter } from '@/modules/soulscope/routers';
import { adminRouter } from '@/server/api/routers/admin';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  sys: adminRouter,
  soulscope: soulscopeRouter,
  luckyWheel: luckyWheelRouter,
  infoCollect: infoCollectRouter,
  batterySwap: batterySwapRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.soulscope.test.getFeatured();
 */
export const createCaller = createCallerFactory(appRouter);
