import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { orders, testResults } from '@/server/db/schema';
import { simulatePayment } from '@/server/services/payment';

export const orderRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ resultId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get result with test type to find price
      const result = await ctx.db.query.testResults.findFirst({
        where: and(
          eq(testResults.id, input.resultId),
          eq(testResults.userId, ctx.session.user.id),
        ),
        with: {
          testType: true,
        },
      });

      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Result not found',
        });
      }

      const id = nanoid();
      await ctx.db.insert(orders).values({
        id,
        userId: ctx.session.user.id,
        resultId: input.resultId,
        amount: result.testType.reportPrice,
      });

      return { id };
    }),

  simulatePayment: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.userId, ctx.session.user.id),
        ),
      });

      if (!order) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Order not found',
        });
      }

      if (order.status === 'paid') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Order already paid',
        });
      }

      // Call payment service simulation - marks order as paid in DB
      await simulatePayment(input.orderId);

      return { status: 'paid' as const };
    }),

  getStatus: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const order = await ctx.db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.userId, ctx.session.user.id),
        ),
      });

      if (!order) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Order not found',
        });
      }

      return { status: order.status };
    }),

  myOrders: protectedProcedure.query(async ({ ctx }) => {
    const orderList = await ctx.db.query.orders.findMany({
      where: eq(orders.userId, ctx.session.user.id),
      with: {
        result: true,
      },
      orderBy: [desc(orders.createdAt)],
    });

    return orderList;
  }),
});
