import { TRPCError } from '@trpc/server';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import {
  wheelActivities,
  wheelDrawRecords,
  wheelPrizes,
} from '@/server/db/schema';

export const luckyWheelAdminRouter = createTRPCRouter({
  // ── Activity CRUD ──────────────────────────────────────────

  listActivities: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(wheelActivities)
      .orderBy(asc(wheelActivities.sortOrder));
  }),

  upsertActivity: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable().optional(),
        coverImage: z.string().nullable().optional(),
        startAt: z.string().nullable().optional(),
        endAt: z.string().nullable().optional(),
        maxDrawsPerUser: z.number().int().optional(),
        maxDrawsPerDay: z.number().int().optional(),
        isActive: z.boolean().optional(),
        rules: z.record(z.string(), z.unknown()).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      await ctx.db
        .insert(wheelActivities)
        .values({
          id,
          name: input.name,
          slug: input.slug,
          description: input.description,
          coverImage: input.coverImage,
          startAt: input.startAt ? new Date(input.startAt) : null,
          endAt: input.endAt ? new Date(input.endAt) : null,
          maxDrawsPerUser: input.maxDrawsPerUser ?? 0,
          maxDrawsPerDay: input.maxDrawsPerDay ?? 0,
          isActive: input.isActive ?? true,
          rules: input.rules,
          sortOrder: input.sortOrder ?? 0,
        })
        .onConflictDoUpdate({
          target: wheelActivities.id,
          set: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            coverImage: input.coverImage,
            startAt: input.startAt ? new Date(input.startAt) : null,
            endAt: input.endAt ? new Date(input.endAt) : null,
            maxDrawsPerUser:
              input.maxDrawsPerUser ?? sql`${wheelActivities.maxDrawsPerUser}`,
            maxDrawsPerDay:
              input.maxDrawsPerDay ?? sql`${wheelActivities.maxDrawsPerDay}`,
            isActive: input.isActive ?? sql`${wheelActivities.isActive}`,
            rules: input.rules ?? sql`${wheelActivities.rules}`,
            sortOrder: input.sortOrder ?? sql`${wheelActivities.sortOrder}`,
          },
        });

      return { id };
    }),

  deleteActivity: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const activity = await ctx.db.query.wheelActivities.findFirst({
        where: eq(wheelActivities.id, input.id),
      });

      if (!activity) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '活动不存在',
        });
      }

      await ctx.db
        .update(wheelActivities)
        .set({ isActive: false })
        .where(eq(wheelActivities.id, input.id));

      return { success: true };
    }),

  // ── Prize CRUD ─────────────────────────────────────────────

  getPrizes: adminProcedure
    .input(z.object({ activityId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(wheelPrizes)
        .where(eq(wheelPrizes.activityId, input.activityId))
        .orderBy(asc(wheelPrizes.sortOrder));
    }),

  upsertPrize: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        activityId: z.string(),
        name: z.string(),
        image: z.string().nullable().optional(),
        type: z.enum(['physical', 'virtual', 'coupon', 'points', 'thanks']),
        probability: z.number().int().min(0),
        totalStock: z.number().int().min(0),
        remainingStock: z.number().int().min(0).optional(),
        value: z.record(z.string(), z.unknown()).nullable().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      await ctx.db
        .insert(wheelPrizes)
        .values({
          id,
          activityId: input.activityId,
          name: input.name,
          image: input.image,
          type: input.type,
          probability: input.probability,
          totalStock: input.totalStock,
          remainingStock: input.remainingStock ?? input.totalStock,
          value: input.value,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        })
        .onConflictDoUpdate({
          target: wheelPrizes.id,
          set: {
            name: input.name,
            image: input.image,
            type: input.type,
            probability: input.probability,
            totalStock: input.totalStock,
            remainingStock:
              input.remainingStock ?? sql`${wheelPrizes.remainingStock}`,
            value: input.value ?? sql`${wheelPrizes.value}`,
            sortOrder: input.sortOrder ?? sql`${wheelPrizes.sortOrder}`,
            isActive: input.isActive ?? sql`${wheelPrizes.isActive}`,
          },
        });

      return { id };
    }),

  deletePrize: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const prize = await ctx.db.query.wheelPrizes.findFirst({
        where: eq(wheelPrizes.id, input.id),
      });

      if (!prize) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '奖品不存在',
        });
      }

      await ctx.db
        .update(wheelPrizes)
        .set({ isActive: false })
        .where(eq(wheelPrizes.id, input.id));

      return { success: true };
    }),

  // ── Record management ──────────────────────────────────────

  getRecords: adminProcedure
    .input(
      z
        .object({
          activityId: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = input.activityId
        ? eq(wheelDrawRecords.activityId, input.activityId)
        : undefined;

      const [items, [countResult]] = await Promise.all([
        ctx.db.query.wheelDrawRecords.findMany({
          where: conditions,
          with: { activity: true, prize: true, user: true },
          orderBy: [desc(wheelDrawRecords.createdAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(wheelDrawRecords)
          .where(conditions),
      ]);

      return { items, total: countResult?.count ?? 0 };
    }),

  updateRecordStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['pending', 'confirmed', 'shipped', 'claimed']),
        adminNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.db.query.wheelDrawRecords.findFirst({
        where: eq(wheelDrawRecords.id, input.id),
      });

      if (!record) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '记录不存在',
        });
      }

      await ctx.db
        .update(wheelDrawRecords)
        .set({
          status: input.status,
          adminNote: input.adminNote ?? record.adminNote,
        })
        .where(eq(wheelDrawRecords.id, input.id));

      return { success: true };
    }),

  // ── Stats ──────────────────────────────────────────────────

  stats: adminProcedure.query(async ({ ctx }) => {
    const [[activityCount], [totalDraws], [totalWins]] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(wheelActivities)
        .where(eq(wheelActivities.isActive, true)),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(wheelDrawRecords),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(wheelDrawRecords)
        .where(eq(wheelDrawRecords.isWin, true)),
    ]);

    return {
      totalActivities: activityCount?.count ?? 0,
      totalDraws: totalDraws?.count ?? 0,
      totalWins: totalWins?.count ?? 0,
    };
  }),
});
