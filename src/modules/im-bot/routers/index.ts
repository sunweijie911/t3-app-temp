import { createTRPCRouter } from '@/server/api/trpc';
import { imBotAdminRouter } from './admin';

export const imBotRouter = createTRPCRouter({
  admin: imBotAdminRouter,
});
