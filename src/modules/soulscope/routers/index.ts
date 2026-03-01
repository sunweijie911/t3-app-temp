import { createTRPCRouter } from '@/server/api/trpc';

import { soulscopeAdminRouter } from './admin';
import { attemptRouter } from './attempt';
import { orderRouter } from './order';
import { reportRouter } from './report';
import { resultRouter } from './result';
import { testRouter } from './test';

export const soulscopeRouter = createTRPCRouter({
  test: testRouter,
  attempt: attemptRouter,
  result: resultRouter,
  report: reportRouter,
  order: orderRouter,
  admin: soulscopeAdminRouter,
});
