import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import {
  BANNER_CONFIG_KEY,
  DEFAULT_VISIBLE_FIELDS,
  VISIBLE_FIELDS_CONFIG_KEY,
} from '@/modules/sim-card/constants';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import {
  simCardClickLogs,
  simCardPackages,
  systemConfig,
} from '@/server/db/schema';

const upsertInput = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  carrier: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
  detailImageUrl: z.string().nullable().optional(),
  cardBgColor: z.string().nullable().optional(),
  monthlyPrice: z.number().int().min(0),
  dataAllowance: z.string().nullable().optional(),
  callMinutes: z.string().nullable().optional(),
  highlights: z.array(z.string()).optional(),
  description: z.string().nullable().optional(),
  purchaseLink: z.string().nullable().optional(),
});

// 构建埋点查询的 where 条件（clickLogs 和 exportClickLogs 共用）
function buildClickLogWhere(input: {
  packageId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}) {
  const conditions = [];

  if (input.packageId) {
    conditions.push(eq(simCardClickLogs.packageId, input.packageId));
  }
  if (input.search) {
    const s = `%${input.search}%`;
    conditions.push(
      or(
        ilike(simCardClickLogs.userName, s),
        ilike(simCardClickLogs.userPhone, s),
        ilike(simCardClickLogs.jobNumber, s),
        ilike(simCardClickLogs.department, s),
      ),
    );
  }
  if (input.startDate) {
    conditions.push(gte(simCardClickLogs.createdAt, new Date(input.startDate)));
  }
  if (input.endDate) {
    conditions.push(lte(simCardClickLogs.createdAt, new Date(input.endDate)));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const simCardAdminRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(simCardPackages)
      .orderBy(asc(simCardPackages.sortOrder), desc(simCardPackages.createdAt));
  }),

  upsert: adminProcedure.input(upsertInput).mutation(async ({ ctx, input }) => {
    const id = input.id ?? nanoid();

    const shared = {
      title: input.title,
      carrier: input.carrier,
      imageUrl: input.imageUrl ?? null,
      detailImageUrl: input.detailImageUrl ?? null,
      cardBgColor: input.cardBgColor ?? '#ffffff',
      monthlyPrice: input.monthlyPrice,
      dataAllowance: input.dataAllowance ?? null,
      callMinutes: input.callMinutes ?? null,
      highlights: input.highlights ?? [],
      description: input.description ?? null,
      purchaseLink: input.purchaseLink ?? null,
    };

    if (input.id) {
      const existing = await ctx.db
        .select({ id: simCardPackages.id })
        .from(simCardPackages)
        .where(eq(simCardPackages.id, input.id))
        .limit(1);

      if (existing.length > 0) {
        await ctx.db
          .update(simCardPackages)
          .set(shared)
          .where(eq(simCardPackages.id, input.id));
        return { id: input.id };
      }
    }

    await ctx.db.insert(simCardPackages).values({
      id,
      ...shared,
      sortOrder: 0,
      isActive: false,
    });

    return { id };
  }),

  reorder: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (const [i, id] of input.ids.entries()) {
          await tx
            .update(simCardPackages)
            .set({ sortOrder: i })
            .where(eq(simCardPackages.id, id));
        }
      });
      return { success: true };
    }),

  toggleActive: adminProcedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(simCardPackages)
        .set({ isActive: input.isActive })
        .where(eq(simCardPackages.id, input.id))
        .returning({ id: simCardPackages.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '套餐不存在' });
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(simCardPackages)
        .where(eq(simCardPackages.id, input.id))
        .returning({ id: simCardPackages.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '套餐不存在' });
      }
      return { success: true };
    }),

  // 配置：获取
  getConfig: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ key: systemConfig.key, value: systemConfig.value })
      .from(systemConfig)
      .where(
        or(
          eq(systemConfig.key, BANNER_CONFIG_KEY),
          eq(systemConfig.key, VISIBLE_FIELDS_CONFIG_KEY),
        ),
      );

    let bannerUrl = '';
    let visibleFields = DEFAULT_VISIBLE_FIELDS as string[];

    for (const row of rows) {
      if (row.key === BANNER_CONFIG_KEY && typeof row.value === 'string') {
        bannerUrl = row.value;
      }
      if (row.key === VISIBLE_FIELDS_CONFIG_KEY && Array.isArray(row.value)) {
        visibleFields = row.value as string[];
      }
    }

    return { bannerUrl, visibleFields };
  }),

  // 配置：保存
  saveConfig: adminProcedure
    .input(
      z.object({
        bannerUrl: z.string().optional(),
        visibleFields: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.bannerUrl !== undefined) {
        await ctx.db
          .insert(systemConfig)
          .values({
            key: BANNER_CONFIG_KEY,
            value: input.bannerUrl,
            description: '电话卡办理页面顶部 Banner 图',
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: input.bannerUrl },
          });
      }

      if (input.visibleFields !== undefined) {
        await ctx.db
          .insert(systemConfig)
          .values({
            key: VISIBLE_FIELDS_CONFIG_KEY,
            value: input.visibleFields,
            description: '电话卡办理前台展示的用户信息字段',
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: input.visibleFields },
          });
      }

      return { success: true };
    }),

  // 埋点数据：分页查询
  clickLogs: adminProcedure
    .input(
      z.object({
        packageId: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildClickLogWhere(input);

      const [rows, totalResult] = await Promise.all([
        ctx.db
          .select()
          .from(simCardClickLogs)
          .where(where)
          .orderBy(desc(simCardClickLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: count() }).from(simCardClickLogs).where(where),
      ]);

      return {
        rows,
        total: totalResult[0]?.count ?? 0,
      };
    }),

  // 埋点数据：导出（返回全量数据，前端转 Excel）
  exportClickLogs: adminProcedure
    .input(
      z.object({
        packageId: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildClickLogWhere(input);

      return ctx.db
        .select()
        .from(simCardClickLogs)
        .where(where)
        .orderBy(desc(simCardClickLogs.createdAt));
    }),
});
