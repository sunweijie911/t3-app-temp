import { TRPCError } from '@trpc/server';
// cspell:ignore ilike
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  PHONE_RE,
  PRIZE_TYPE_ENUM,
  RECORD_STATUS_ENUM,
} from '@/modules/lucky-wheel/constants';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import type { db } from '@/server/db';
import { user } from '@/server/db/auth-schema';
import {
  wheelActivities,
  wheelDrawRecords,
  wheelExtraChances,
  wheelPrizes,
} from '@/server/db/schema';

const recordFilterInput = z.object({
  activityId: z.string().optional(),
  isWin: z.boolean().optional(),
  status: RECORD_STATUS_ENUM.optional(),
  prizeType: PRIZE_TYPE_ENUM.optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// 构建记录查询的 where 条件。返回 null 表示结果集一定为空（提前短路）
async function resolveRecordWhere(
  dbInstance: typeof db,
  input: z.infer<typeof recordFilterInput>,
) {
  let userIds: string[] | undefined;
  if (input.search?.trim()) {
    const term = `%${input.search.trim()}%`;
    const matched = await dbInstance
      .select({ id: user.id })
      .from(user)
      .where(or(ilike(user.name, term), ilike(user.phoneNumber, term)));
    userIds = matched.map((u) => u.id);
    if (userIds.length === 0) return null;
  }

  let prizeIds: string[] | undefined;
  if (input.prizeType) {
    const matched = await dbInstance
      .select({ id: wheelPrizes.id })
      .from(wheelPrizes)
      .where(eq(wheelPrizes.type, input.prizeType));
    prizeIds = matched.map((p) => p.id);
    if (prizeIds.length === 0) return null;
  }

  return and(
    input.activityId
      ? eq(wheelDrawRecords.activityId, input.activityId)
      : undefined,
    input.isWin !== undefined
      ? eq(wheelDrawRecords.isWin, input.isWin)
      : undefined,
    input.status ? eq(wheelDrawRecords.status, input.status) : undefined,
    userIds ? inArray(wheelDrawRecords.userId, userIds) : undefined,
    prizeIds ? inArray(wheelDrawRecords.prizeId, prizeIds) : undefined,
    input.startDate
      ? gte(wheelDrawRecords.createdAt, new Date(input.startDate))
      : undefined,
    input.endDate
      ? lte(wheelDrawRecords.createdAt, new Date(input.endDate))
      : undefined,
  );
}

export const luckyWheelAdminRouter = createTRPCRouter({
  // ── Activity CRUD ──────────────────────────────────────────

  listActivities: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(wheelActivities)
      .orderBy(desc(wheelActivities.createdAt));
  }),

  upsertActivity: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        slug: z.string().regex(/^[a-zA-Z0-9]+$/, 'slug 只允许字母和数字'),
        description: z.string().nullable().optional(),
        coverImage: z.string().nullable().optional(),
        startAt: z.string().nullable().optional(),
        endAt: z.string().nullable().optional(),
        maxDrawsPerUser: z.number().int().optional(),
        isActive: z.boolean().optional(),
        rules: z.object({ html: z.string() }).nullable().optional(),
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
          maxDrawsPerUser: input.maxDrawsPerUser ?? 1,
          isActive: input.isActive ?? false,
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
      const updated = await ctx.db
        .update(wheelActivities)
        .set({ isActive: false })
        .where(eq(wheelActivities.id, input.id))
        .returning({ id: wheelActivities.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '活动不存在' });
      }

      return { success: true };
    }),

  activateActivity: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(wheelActivities)
        .set({ isActive: true })
        .where(eq(wheelActivities.id, input.id));

      return { success: true };
    }),

  removeActivity: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 仅允许删除已下架的活动
      const [activity] = await ctx.db
        .select({ isActive: wheelActivities.isActive })
        .from(wheelActivities)
        .where(eq(wheelActivities.id, input.id));

      if (!activity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '活动不存在' });
      }
      if (activity.isActive) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '请先下架活动再删除',
        });
      }

      // wheelDrawRecords.activityId 没有 onDelete cascade，需要手动清理
      await ctx.db
        .delete(wheelDrawRecords)
        .where(eq(wheelDrawRecords.activityId, input.id));

      // wheelPrizes 和 wheelExtraChances 已配置 cascade，删活动时自动级联
      await ctx.db
        .delete(wheelActivities)
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
        .where(
          and(
            eq(wheelPrizes.activityId, input.activityId),
            eq(wheelPrizes.isActive, true),
          ),
        )
        .orderBy(asc(wheelPrizes.sortOrder));
    }),

  upsertPrize: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        activityId: z.string(),
        name: z.string(),
        image: z.string().nullable().optional(),
        type: PRIZE_TYPE_ENUM,
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
          isActive: input.isActive ?? false,
        })
        .onConflictDoUpdate({
          target: wheelPrizes.id,
          set: {
            name: input.name,
            image: input.image,
            type: input.type,
            probability: input.probability,
            totalStock: input.totalStock,
            // 显式传了 remainingStock 则直接用；否则跟随 totalStock 变化量同步调整
            remainingStock:
              input.remainingStock ??
              sql`GREATEST(0, ${wheelPrizes.remainingStock} + (${input.totalStock} - ${wheelPrizes.totalStock}))`,
            value: input.value ?? sql`${wheelPrizes.value}`,
            sortOrder: input.sortOrder ?? sql`${wheelPrizes.sortOrder}`,
            isActive: input.isActive ?? sql`${wheelPrizes.isActive}`,
          },
        });

      return { id };
    }),

  batchUpsertPrizes: adminProcedure
    .input(
      z.array(
        z.object({
          id: z.string().optional(),
          activityId: z.string(),
          name: z.string().min(1),
          type: PRIZE_TYPE_ENUM,
          probability: z.number().int().min(0),
          totalStock: z.number().int().min(0),
          value: z.record(z.string(), z.unknown()).nullable().optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await Promise.all(
        input.map(async (prize) => {
          const id = prize.id ?? nanoid();
          await ctx.db
            .insert(wheelPrizes)
            .values({
              id,
              activityId: prize.activityId,
              name: prize.name,
              type: prize.type,
              probability: prize.probability,
              totalStock: prize.totalStock,
              remainingStock: prize.totalStock,
              value: prize.value,
              sortOrder: prize.sortOrder ?? 0,
              isActive: prize.isActive ?? true,
            })
            .onConflictDoUpdate({
              target: wheelPrizes.id,
              set: {
                name: prize.name,
                type: prize.type,
                probability: prize.probability,
                totalStock: prize.totalStock,
                // remainingStock 跟随 totalStock 变化量同步调整，不低于 0
                remainingStock: sql`GREATEST(0, ${wheelPrizes.remainingStock} + (${prize.totalStock} - ${wheelPrizes.totalStock}))`,
                value: prize.value ?? sql`${wheelPrizes.value}`,
                sortOrder: prize.sortOrder ?? sql`${wheelPrizes.sortOrder}`,
                isActive: prize.isActive ?? sql`${wheelPrizes.isActive}`,
              },
            });
        }),
      );
      return { success: true };
    }),

  deletePrize: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(wheelPrizes)
        .set({ isActive: false })
        .where(eq(wheelPrizes.id, input.id))
        .returning({ id: wheelPrizes.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '奖品不存在' });
      }

      return { success: true };
    }),

  activatePrize: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(wheelPrizes)
        .set({ isActive: true })
        .where(eq(wheelPrizes.id, input.id));

      return { success: true };
    }),

  // ── Record management ──────────────────────────────────────

  getRecords: adminProcedure
    .input(
      recordFilterInput
        .extend({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = await resolveRecordWhere(ctx.db, input);
      if (where === null) return { items: [], total: 0 };

      const [items, [countResult]] = await Promise.all([
        ctx.db.query.wheelDrawRecords.findMany({
          where,
          with: { activity: true, prize: true, user: true },
          orderBy: [desc(wheelDrawRecords.createdAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(wheelDrawRecords)
          .where(where),
      ]);

      return { items, total: countResult?.count ?? 0 };
    }),

  exportRecords: adminProcedure
    .input(recordFilterInput)
    .query(async ({ ctx, input }) => {
      const where = await resolveRecordWhere(ctx.db, input);
      if (where === null) return [];

      return ctx.db.query.wheelDrawRecords.findMany({
        where,
        with: { activity: true, prize: true, user: true },
        orderBy: [desc(wheelDrawRecords.createdAt)],
        limit: 10000,
      });
    }),

  updateRecordStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: RECORD_STATUS_ENUM,
        adminNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(wheelDrawRecords)
        .set({
          status: input.status,
          ...(input.adminNote !== undefined && { adminNote: input.adminNote }),
        })
        .where(eq(wheelDrawRecords.id, input.id))
        .returning({ id: wheelDrawRecords.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '记录不存在' });
      }

      return { success: true };
    }),

  deleteRecord: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        // 先查询记录的中奖信息
        const [record] = await tx
          .select({
            id: wheelDrawRecords.id,
            isWin: wheelDrawRecords.isWin,
            prizeId: wheelDrawRecords.prizeId,
          })
          .from(wheelDrawRecords)
          .where(eq(wheelDrawRecords.id, input.id));

        if (!record) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '记录不存在' });
        }

        await tx
          .delete(wheelDrawRecords)
          .where(eq(wheelDrawRecords.id, input.id));

        // 中奖记录删除后恢复库存
        if (record.isWin && record.prizeId) {
          await tx
            .update(wheelPrizes)
            .set({
              remainingStock: sql`${wheelPrizes.remainingStock} + 1`,
            })
            .where(eq(wheelPrizes.id, record.prizeId));
        }

        return { success: true };
      });
    }),

  batchDeleteRecords: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        // 先查询所有中奖记录
        const records = await tx
          .select({
            id: wheelDrawRecords.id,
            isWin: wheelDrawRecords.isWin,
            prizeId: wheelDrawRecords.prizeId,
          })
          .from(wheelDrawRecords)
          .where(inArray(wheelDrawRecords.id, input.ids));

        const deleted = await tx
          .delete(wheelDrawRecords)
          .where(inArray(wheelDrawRecords.id, input.ids))
          .returning({ id: wheelDrawRecords.id });

        // 统计每个奖品需要恢复的库存数
        const stockRestore = new Map<string, number>();
        for (const r of records) {
          if (r.isWin && r.prizeId) {
            stockRestore.set(r.prizeId, (stockRestore.get(r.prizeId) ?? 0) + 1);
          }
        }

        // 批量恢复库存
        for (const [prizeId, count] of stockRestore) {
          await tx
            .update(wheelPrizes)
            .set({
              remainingStock: sql`${wheelPrizes.remainingStock} + ${count}`,
            })
            .where(eq(wheelPrizes.id, prizeId));
        }

        return { success: true, count: deleted.length };
      });
    }),

  batchUpdateRecordStatus: adminProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1),
        status: RECORD_STATUS_ENUM,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(wheelDrawRecords)
        .set({ status: input.status })
        .where(inArray(wheelDrawRecords.id, input.ids))
        .returning({ id: wheelDrawRecords.id });

      return { success: true, count: updated.length };
    }),

  clearRecords: adminProcedure
    .input(z.object({ activityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        // 删除该活动所有抽奖记录
        await tx
          .delete(wheelDrawRecords)
          .where(eq(wheelDrawRecords.activityId, input.activityId));
        // 重置该活动所有奖品库存
        await tx
          .update(wheelPrizes)
          .set({ remainingStock: sql`${wheelPrizes.totalStock}` })
          .where(eq(wheelPrizes.activityId, input.activityId));
      });
      return { success: true };
    }),

  // ── Extra Chances CRUD ─────────────────────────────────────

  listExtraChances: adminProcedure
    .input(z.object({ activityId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(wheelExtraChances)
        .where(eq(wheelExtraChances.activityId, input.activityId))
        .orderBy(asc(wheelExtraChances.createdAt));
    }),

  upsertExtraChance: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        activityId: z.string(),
        phone: z.string().regex(PHONE_RE, '请输入有效的手机号'),
        extraChances: z.number().int().min(0),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      await ctx.db
        .insert(wheelExtraChances)
        .values({
          id,
          activityId: input.activityId,
          phone: input.phone,
          extraChances: input.extraChances,
          note: input.note,
        })
        .onConflictDoUpdate({
          target: [wheelExtraChances.activityId, wheelExtraChances.phone],
          set: {
            extraChances: input.extraChances,
            note: input.note ?? sql`${wheelExtraChances.note}`,
          },
        });

      return { id };
    }),

  deleteExtraChance: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(wheelExtraChances)
        .where(eq(wheelExtraChances.id, input.id))
        .returning({ id: wheelExtraChances.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '记录不存在' });
      }

      return { success: true };
    }),

  batchDeleteExtraChances: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(wheelExtraChances)
        .where(inArray(wheelExtraChances.id, input.ids))
        .returning({ id: wheelExtraChances.id });

      return { success: true, count: deleted.length };
    }),

  batchImportExtraChances: adminProcedure
    .input(
      z.object({
        activityId: z.string(),
        items: z
          .array(
            z.object({
              phone: z.string().regex(PHONE_RE, '无效手机号'),
              extraChances: z.number().int().min(0),
              note: z.string().optional(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await Promise.all(
        input.items.map(async (item) => {
          await ctx.db
            .insert(wheelExtraChances)
            .values({
              id: nanoid(),
              activityId: input.activityId,
              phone: item.phone,
              extraChances: item.extraChances,
              note: item.note,
            })
            .onConflictDoUpdate({
              target: [wheelExtraChances.activityId, wheelExtraChances.phone],
              set: {
                extraChances: item.extraChances,
                note: item.note ?? sql`${wheelExtraChances.note}`,
              },
            });
        }),
      );
      return { success: true, count: input.items.length };
    }),

  // ── Stats ──────────────────────────────────────────────────

  stats: adminProcedure.query(async ({ ctx }) => {
    const [activityDrawStats, prizeStats] = await Promise.all([
      // 每个活动的抽奖次数 + 中奖次数 + 独立用户数
      ctx.db
        .select({
          activityId: wheelActivities.id,
          activityName: wheelActivities.name,
          totalDraws: sql<number>`count(${wheelDrawRecords.id})::int`,
          totalWins: sql<number>`count(case when ${wheelDrawRecords.isWin} then 1 end)::int`,
          uniqueUsers: sql<number>`count(distinct ${wheelDrawRecords.userId})::int`,
        })
        .from(wheelActivities)
        .leftJoin(
          wheelDrawRecords,
          eq(wheelDrawRecords.activityId, wheelActivities.id),
        )
        .groupBy(wheelActivities.id, wheelActivities.name)
        .orderBy(asc(wheelActivities.sortOrder)),
      // 每个奖品的库存 + 发放数
      ctx.db
        .select({
          activityId: wheelActivities.id,
          activityName: wheelActivities.name,
          prizeId: wheelPrizes.id,
          prizeName: wheelPrizes.name,
          prizeType: wheelPrizes.type,
          probability: wheelPrizes.probability,
          totalStock: wheelPrizes.totalStock,
          remainingStock: wheelPrizes.remainingStock,
          value: wheelPrizes.value,
          drawnCount: sql<number>`count(${wheelDrawRecords.id})::int`,
        })
        .from(wheelPrizes)
        .innerJoin(
          wheelActivities,
          eq(wheelActivities.id, wheelPrizes.activityId),
        )
        .leftJoin(
          wheelDrawRecords,
          and(
            eq(wheelDrawRecords.prizeId, wheelPrizes.id),
            eq(wheelDrawRecords.isWin, true),
          ),
        )
        .where(eq(wheelPrizes.isActive, true))
        .groupBy(wheelActivities.id, wheelActivities.name, wheelPrizes.id)
        .orderBy(asc(wheelActivities.sortOrder), asc(wheelPrizes.sortOrder)),
    ]);

    return { activityDrawStats, prizeStats };
  }),

  activityRecordStats: adminProcedure
    .input(z.object({ activityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const statusCounts = await ctx.db
        .select({
          status: wheelDrawRecords.status,
          count: sql<number>`count(*)::int`,
        })
        .from(wheelDrawRecords)
        .where(
          and(
            eq(wheelDrawRecords.activityId, input.activityId),
            eq(wheelDrawRecords.isWin, true),
          ),
        )
        .groupBy(wheelDrawRecords.status);

      return statusCounts;
    }),
});
