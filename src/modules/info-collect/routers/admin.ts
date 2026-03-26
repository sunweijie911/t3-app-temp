import { TRPCError } from '@trpc/server';
/* cspell:ignore ilike */
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { REVIEW_STATUS_ENUM } from '@/modules/info-collect/constants';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { infoCollectConfig, infoCollectRecords } from '@/server/db/schema';
import { decrypt } from '@/server/services/crypto';

import { fetchInfoCollectConfig } from './shared';

/** 安全解密：失败时返回原值，避免历史明文数据导致页面报错 */
function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

const filterInput = z.object({
  status: REVIEW_STATUS_ENUM.optional(),
  search: z.string().optional(),
});

/** 转义 LIKE 通配符 */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

function resolveWhere(input: z.infer<typeof filterInput>) {
  const search = input.search?.trim();
  return and(
    input.status ? eq(infoCollectRecords.status, input.status) : undefined,
    search
      ? or(
          ilike(infoCollectRecords.name, `%${escapeLike(search)}%`),
          ilike(infoCollectRecords.phone, `%${escapeLike(search)}%`),
          ilike(infoCollectRecords.jobNumber, `%${escapeLike(search)}%`),
        )
      : undefined,
  );
}

export const infoCollectAdminRouter = createTRPCRouter({
  getConfig: adminProcedure.query(async ({ ctx }) => {
    return fetchInfoCollectConfig(ctx.db);
  }),

  saveConfig: adminProcedure
    .input(
      z.object({
        bannerUrl: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(infoCollectConfig)
        .values({
          id: 'default',
          bannerUrl: input.bannerUrl,
        })
        .onConflictDoUpdate({
          target: infoCollectConfig.id,
          set: {
            bannerUrl: input.bannerUrl,
          },
        });
      return { success: true };
    }),

  list: adminProcedure
    .input(
      filterInput
        .extend({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = resolveWhere(input);

      const [items, [countResult]] = await Promise.all([
        ctx.db
          .select()
          .from(infoCollectRecords)
          .where(where)
          .orderBy(desc(infoCollectRecords.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(infoCollectRecords)
          .where(where),
      ]);

      const decryptedItems = items.map((item) => ({
        ...item,
        idCard: safeDecrypt(item.idCard),
      }));

      return { items: decryptedItems, total: countResult?.count ?? 0 };
    }),

  review: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['approved', 'rejected', 'needs_supplement']),
        rejectReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        (input.status === 'rejected' || input.status === 'needs_supplement') &&
        !input.rejectReason?.trim()
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '拒绝或需补充时必须填写原因',
        });
      }

      const updated = await ctx.db
        .update(infoCollectRecords)
        .set({
          status: input.status,
          rejectReason: input.rejectReason ?? null,
        })
        .where(
          and(
            eq(infoCollectRecords.id, input.id),
            eq(infoCollectRecords.status, 'pending'),
          ),
        )
        .returning({ id: infoCollectRecords.id });

      if (updated.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '记录不存在或当前状态不允许审核',
        });
      }

      return { success: true };
    }),

  batchReview: adminProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(100),
        status: z.enum(['approved', 'rejected']),
        rejectReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.status === 'rejected' && !input.rejectReason?.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '批量拒绝时必须填写原因',
        });
      }

      const updated = await ctx.db
        .update(infoCollectRecords)
        .set({
          status: input.status,
          rejectReason:
            input.status === 'rejected' ? (input.rejectReason ?? null) : null,
        })
        .where(
          and(
            inArray(infoCollectRecords.id, input.ids),
            eq(infoCollectRecords.status, 'pending'),
          ),
        )
        .returning({ id: infoCollectRecords.id });

      return { success: true, count: updated.length };
    }),

  updateTracking: adminProcedure
    .input(
      z.object({
        id: z.string(),
        trackingNumber: z.string().min(1, '请填写发货单号'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(infoCollectRecords)
        .set({
          trackingNumber: input.trackingNumber,
          status: 'completed',
          shippedAt: new Date(),
        })
        .where(
          and(
            eq(infoCollectRecords.id, input.id),
            eq(infoCollectRecords.status, 'approved'),
          ),
        )
        .returning({ id: infoCollectRecords.id });

      if (updated.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '记录不存在或当前状态不允许填写发货单号',
        });
      }

      return { success: true };
    }),

  updateRemark: adminProcedure
    .input(
      z.object({
        id: z.string(),
        remark: z.string().max(500).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(infoCollectRecords)
        .set({ remark: input.remark })
        .where(eq(infoCollectRecords.id, input.id))
        .returning({ id: infoCollectRecords.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '记录不存在' });
      }

      return { success: true };
    }),

  deleteRecord: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(infoCollectRecords)
        .where(eq(infoCollectRecords.id, input.id))
        .returning({ id: infoCollectRecords.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '记录不存在' });
      }

      return { success: true };
    }),

  exportData: adminProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const where = resolveWhere(input);

      const records = await ctx.db
        .select()
        .from(infoCollectRecords)
        .where(where)
        .orderBy(desc(infoCollectRecords.createdAt))
        .limit(10000);

      console.log(
        '[info-collect/export] admin=%s count=%d filters=%j',
        ctx.session?.user?.name ?? 'unknown',
        records.length,
        input,
      );

      return records.map((r) => ({
        ...r,
        idCard: safeDecrypt(r.idCard),
      }));
    }),
});
