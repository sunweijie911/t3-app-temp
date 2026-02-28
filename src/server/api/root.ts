import { adminRouter } from '@/server/api/routers/admin';
import { attemptRouter } from '@/server/api/routers/attempt';
import { orderRouter } from '@/server/api/routers/order';
import { reportRouter } from '@/server/api/routers/report';
import { resultRouter } from '@/server/api/routers/result';
import { testRouter } from '@/server/api/routers/test';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  test: testRouter,
  attempt: attemptRouter,
  result: resultRouter,
  report: reportRouter,
  order: orderRouter,
  admin: adminRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.test.getFeatured();
 */
export const createCaller = createCallerFactory(appRouter);
