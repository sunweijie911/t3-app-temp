import { createTRPCRouter } from '@/server/api/trpc';

import { activityRouter } from './activity';
import { luckyWheelAdminRouter } from './admin';
import { drawRouter } from './draw';
import { recordRouter } from './record';

export const luckyWheelRouter = createTRPCRouter({
  activity: activityRouter,
  draw: drawRouter,
  record: recordRouter,
  admin: luckyWheelAdminRouter,
});
