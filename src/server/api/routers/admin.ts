import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from '@/server/api/trpc';
import { systemConfig } from '@/server/db/schema';
import { isAdminEmail } from '@/server/services/admin-check';

export const adminRouter = createTRPCRouter({
  isAdmin: protectedProcedure.query(({ ctx }) => {
    return isAdminEmail(ctx.session.user.email);
  }),

  getConfig: adminProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.db.query.systemConfig.findFirst({
        where: eq(systemConfig.key, input.key),
      });

      return config ?? { key: input.key, value: null, description: null };
    }),

  setConfig: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(systemConfig)
        .values({
          key: input.key,
          value: input.value,
          description: input.description,
        })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: {
            value: input.value,
            description: input.description,
          },
        });

      return { success: true };
    }),
});
