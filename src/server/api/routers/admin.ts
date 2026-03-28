import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, like, lt, lte, min } from 'drizzle-orm';
import { z } from 'zod';
import { ACTION_LABELS } from '@/server/api/audit-action-labels';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from '@/server/api/trpc';
import { auth } from '@/server/better-auth';
import { getUserPhone } from '@/server/better-auth/types';
import { user } from '@/server/db/auth-schema';
import { adminAuditLog, systemConfig } from '@/server/db/schema';
import { isAdminEmail, isAdminPhone } from '@/server/services/admin-check';

// 构建审计日志查询的 where 条件（listAuditLogs 和 exportAuditLogs 共用）
function buildAuditLogWhere(input: {
  startDate?: string;
  endDate?: string;
  action?: string;
  userEmail?: string;
}) {
  const conditions = [];
  if (input.startDate) {
    conditions.push(gte(adminAuditLog.createdAt, new Date(input.startDate)));
  }
  if (input.endDate) {
    conditions.push(lte(adminAuditLog.createdAt, new Date(input.endDate)));
  }
  if (input.action) {
    conditions.push(eq(adminAuditLog.action, input.action));
  }
  if (input.userEmail) {
    conditions.push(like(adminAuditLog.userEmail, `%${input.userEmail}%`));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const adminRouter = createTRPCRouter({
  checkRole: protectedProcedure.query(({ ctx }) => {
    const phone = getUserPhone(ctx.session.user);
    return isAdminEmail(ctx.session.user.email) || isAdminPhone(phone);
  }),

  // ---- 用户管理 ----

  createUser: adminProcedure
    .input(
      z.object({
        email: z.email(),
        password: z.string().min(6),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await auth.api.signUpEmail({
          body: {
            email: input.email,
            password: input.password,
            name: input.name,
          },
        });
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already') || msg.includes('exist')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '该邮箱已被注册',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '创建用户失败',
        });
      }
    }),

  listUsers: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt));
  }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session?.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '不能删除自己的账户',
        });
      }
      await ctx.db.delete(user).where(eq(user.id, input.userId));
      return { success: true };
    }),

  // ---- 审计日志 ----

  // 获取数据库中实际存在的操作类型列表（附带中文名）
  listDistinctActions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .selectDistinct({ action: adminAuditLog.action })
      .from(adminAuditLog)
      .orderBy(adminAuditLog.action);
    return rows.map((r) => ({
      value: r.action,
      label: ACTION_LABELS[r.action] ?? r.action,
    }));
  }),

  listAuditLogs: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        action: z.string().optional(),
        userEmail: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildAuditLogWhere(input);
      const offset = (input.page - 1) * input.pageSize;

      const [logs, countResult] = await Promise.all([
        ctx.db
          .select()
          .from(adminAuditLog)
          .where(where)
          .orderBy(desc(adminAuditLog.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        ctx.db.select({ total: count() }).from(adminAuditLog).where(where),
      ]);

      return { logs, total: countResult[0]?.total ?? 0 };
    }),

  // 导出审计日志（返回全量数据，前端转 Excel）
  exportAuditLogs: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        action: z.string().optional(),
        userEmail: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildAuditLogWhere(input);
      return ctx.db
        .select()
        .from(adminAuditLog)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt));
    }),

  // ---- 审计日志清理 ----

  // 日志统计（总数 + 最早记录时间）
  getAuditLogStats: adminProcedure.query(async ({ ctx }) => {
    const [countResult, minResult] = await Promise.all([
      ctx.db.select({ total: count() }).from(adminAuditLog),
      ctx.db
        .select({ earliest: min(adminAuditLog.createdAt) })
        .from(adminAuditLog),
    ]);
    return {
      total: countResult[0]?.total ?? 0,
      earliestDate: minResult[0]?.earliest?.toISOString() ?? null,
    };
  }),

  // 手动清理指定日期之前的日志
  purgeAuditLogs: adminProcedure
    .input(
      z.object({
        beforeDate: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(adminAuditLog)
        .where(lt(adminAuditLog.createdAt, new Date(input.beforeDate)))
        .returning({ id: adminAuditLog.id });
      return { deleted: deleted.length };
    }),

  // ---- 系统配置 ----

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
