import { and, count, desc, eq, gte, lt, lte, min, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { feishuTokenManager } from '../auth/feishu-token';
import {
  BOT_EVENT_RESULT_ENUM,
  BOT_PLATFORM_ENUM,
  BOT_RESOURCE_KIND_ENUM,
  type BotPlatform,
  CREDENTIAL_MASK,
  FIELD_MAPPING_SCHEMA,
  PLATFORM_SECRET_FIELDS,
} from '../constants';
import {
  botEventDedup,
  botEventLogs,
  botPendingActions,
  botPlatforms,
  botResourceBindings,
  botScenes,
} from '../schema';
import { reloadBotConfig } from '../services/bot-engine';

/**
 * 把 credentials 中的 secret 字段替换为 mask 占位符，避免明文回传浏览器。
 */
function maskCredentials(
  platform: BotPlatform,
  credentials: unknown,
): Record<string, unknown> {
  const src =
    credentials && typeof credentials === 'object'
      ? (credentials as Record<string, unknown>)
      : {};
  const secretKeys = new Set<string>(PLATFORM_SECRET_FIELDS[platform]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (secretKeys.has(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? CREDENTIAL_MASK : '';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 将前端提交的 credentials 与 DB 原值合并：secret 字段若提交值等于 mask 占位符，
 * 说明前端只是回显未编辑，应保留 DB 原值。
 */
function mergeMaskedCredentials(
  platform: BotPlatform,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const secretKeys = new Set<string>(PLATFORM_SECRET_FIELDS[platform]);
  const out: Record<string, unknown> = { ...incoming };
  for (const key of secretKeys) {
    if (out[key] === CREDENTIAL_MASK) {
      // 用 DB 原值替回，避免被占位符覆盖
      if (key in existing) {
        out[key] = existing[key];
      } else {
        delete out[key];
      }
    }
  }
  return out;
}

/**
 * 根据飞书 ui_type 推断 fieldMapping 建议类型。
 * - SingleLink/DuplexLink   → link（需要再选 displayField）
 * - MultiSelect             → multiSelect
 * - Text/Number/SingleSelect/Date 等 → plain
 * - 名字含敏感关键字时再叠加 sensitive=true（前端兜底）
 */
function suggestMappingType(
  uiType: string | undefined,
  multiple: boolean | undefined,
): 'plain' | 'link' | 'multiSelect' {
  if (uiType === 'SingleLink' || uiType === 'DuplexLink') return 'link';
  if (uiType === 'MultiSelect' || multiple === true) return 'multiSelect';
  return 'plain';
}

/** 业务时区固定 CST(+08:00)，与飞书日期字段的处理保持一致 */
const BUSINESS_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 返回「业务时区今天 00:00」对应的 UTC 时刻。
 * 直接用 `new Date().setHours(0,0,0,0)` 取的是**服务器本地时区**，
 * 容器一般跑 UTC，会把凌晨 0~8 点的数据算进前一天。
 */
function startOfBusinessDay(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - BUSINESS_TZ_OFFSET_MS);
}

export const imBotAdminRouter = createTRPCRouter({
  listScenes: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(botScenes).orderBy(botScenes.sortOrder);
  }),

  upsertScene: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        sceneId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        keywords: z.string().optional(),
        systemPrompt: z.string().optional(),
        fieldSchema: z.any().optional(),
        replyTemplate: z.string().optional(),
        isActive: z.boolean().default(true),
        sortOrder: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();
      await ctx.db
        .insert(botScenes)
        .values({
          id,
          sceneId: input.sceneId,
          name: input.name,
          description: input.description,
          keywords: input.keywords,
          systemPrompt: input.systemPrompt,
          fieldSchema: input.fieldSchema,
          replyTemplate: input.replyTemplate,
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        })
        .onConflictDoUpdate({
          target: botScenes.id,
          set: {
            sceneId: input.sceneId,
            name: input.name,
            description: input.description,
            keywords: input.keywords,
            systemPrompt: input.systemPrompt,
            fieldSchema: input.fieldSchema,
            replyTemplate: input.replyTemplate,
            isActive: input.isActive,
            sortOrder: input.sortOrder,
          },
        });
      reloadBotConfig();
      return { id };
    }),

  reorderScenes: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (const [i, id] of input.ids.entries()) {
          await tx
            .update(botScenes)
            .set({ sortOrder: i })
            .where(eq(botScenes.id, id));
        }
      });
      reloadBotConfig();
      return { success: true };
    }),

  deleteScene: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(botScenes)
        .where(eq(botScenes.id, input.id))
        .returning({ sceneId: botScenes.sceneId });
      if (deleted) {
        await ctx.db
          .delete(botResourceBindings)
          .where(eq(botResourceBindings.sceneId, deleted.sceneId));
      }
      reloadBotConfig();
      return { success: true };
    }),

  toggleScene: adminProcedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(botScenes)
        .set({ isActive: input.isActive })
        .where(eq(botScenes.id, input.id));
      reloadBotConfig();
      return { success: true };
    }),

  listPlatforms: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(botPlatforms);
    // 把 credentials 中的 secret 字段替换为 mask，避免明文回传浏览器
    // (React Query 缓存 / DevTools / Network 面板都会留痕)
    return rows.map((row) => ({
      ...row,
      credentials: maskCredentials(row.platform, row.credentials),
    }));
  }),

  upsertPlatform: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        platform: BOT_PLATFORM_ENUM,
        name: z.string().min(1),
        credentials: z.record(z.string(), z.unknown()).default({}),
        isActive: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();
      // 前端 listPlatforms 拿到的 secret 字段是 mask 占位符；保存时遇到 mask 值
      // 应保留 DB 原值不覆盖，否则会把真实凭证被占位符覆盖掉
      const existing = await ctx.db
        .select({ credentials: botPlatforms.credentials })
        .from(botPlatforms)
        .where(eq(botPlatforms.platform, input.platform))
        .limit(1);
      const mergedCredentials = mergeMaskedCredentials(
        input.platform,
        input.credentials,
        (existing[0]?.credentials as Record<string, unknown> | null) ?? {},
      );
      await ctx.db
        .insert(botPlatforms)
        .values({
          id,
          platform: input.platform,
          name: input.name,
          credentials: mergedCredentials,
          isActive: input.isActive,
        })
        .onConflictDoUpdate({
          target: botPlatforms.platform,
          set: {
            name: input.name,
            credentials: mergedCredentials,
            isActive: input.isActive,
          },
        });
      reloadBotConfig();
      return { id };
    }),

  listResourceBindings: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(botResourceBindings)
      .orderBy(botResourceBindings.sceneId, botResourceBindings.alias);
  }),

  upsertResourceBinding: adminProcedure
    .input(
      z
        .object({
          id: z.string().optional(),
          sceneId: z.string().min(1),
          alias: z.string().min(1).max(64),
          kind: BOT_RESOURCE_KIND_ENUM.default('table'),
          /** 数据所在平台，与消息来源平台无关 */
          provider: BOT_PLATFORM_ENUM,
          /**
           * 表格必填（飞书 app_token）；文档可留空 —— 飞书 docx 的读写
           * 只需要 document_id，folder_token 仅在创建新文档时才用得上。
           */
          workspaceId: z.string().default(''),
          resourceId: z.string().min(1),
          fieldMapping: FIELD_MAPPING_SCHEMA.default({}),
          uniqueKey: z.string().max(64).optional(),
          isDefault: z.boolean().default(true),
          isActive: z.boolean().default(true),
        })
        .refine((v) => v.kind !== 'table' || v.workspaceId.length > 0, {
          message: '表格资源必须填写 Workspace ID (飞书 app_token)',
          path: ['workspaceId'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();
      await ctx.db.transaction(async (tx) => {
        // 同场景内只允许一条默认资源，否则 dispatcher 的默认解析会不确定
        if (input.isDefault) {
          await tx
            .update(botResourceBindings)
            .set({ isDefault: false })
            .where(
              and(
                eq(botResourceBindings.sceneId, input.sceneId),
                ne(botResourceBindings.alias, input.alias),
              ),
            );
        }
        await tx
          .insert(botResourceBindings)
          .values({
            id,
            sceneId: input.sceneId,
            alias: input.alias,
            kind: input.kind,
            provider: input.provider,
            workspaceId: input.workspaceId,
            resourceId: input.resourceId,
            fieldMapping: input.fieldMapping,
            uniqueKey: input.uniqueKey,
            isDefault: input.isDefault,
            isActive: input.isActive,
          })
          .onConflictDoUpdate({
            target: [botResourceBindings.sceneId, botResourceBindings.alias],
            set: {
              kind: input.kind,
              provider: input.provider,
              workspaceId: input.workspaceId,
              resourceId: input.resourceId,
              fieldMapping: input.fieldMapping,
              uniqueKey: input.uniqueKey,
              isDefault: input.isDefault,
              isActive: input.isActive,
            },
          });
      });
      reloadBotConfig();
      return { id };
    }),

  deleteResourceBinding: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(botResourceBindings)
        .where(eq(botResourceBindings.id, input.id));
      reloadBotConfig();
      return { success: true };
    }),

  /**
   * 从飞书拉取指定多维表的字段列表，供 admin UI 勾选生成 fieldMapping。
   * 仅 feishu 平台；workspaceId=app_token，tableId 必填。
   */
  fetchBitableFields: adminProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tableId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const token = await feishuTokenManager.getToken();
      const res = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${input.workspaceId}/tables/${input.tableId}/fields?page_size=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        throw new Error(`飞书 API HTTP 错误: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as {
        code: number;
        msg?: string;
        data?: {
          items?: Array<{
            field_id: string;
            field_name: string;
            type: number;
            ui_type?: string;
            property?: { multiple?: boolean };
          }>;
        };
      };
      if (data.code !== 0) {
        throw new Error(`飞书 API 错误: ${data.msg ?? data.code}`);
      }
      const items = data.data?.items ?? [];
      // ui_type 参考 飞书 OpenAPI；这里只用到几个常见值映射建议类型
      return items.map((it) => ({
        fieldId: it.field_id,
        fieldName: it.field_name,
        uiType: it.ui_type ?? '',
        // 给前端的建议映射类型；admin 仍可手动覆盖
        suggestedType: suggestMappingType(it.ui_type, it.property?.multiple),
      }));
    }),

  listEventLogs: adminProcedure
    .input(
      z
        .object({
          platform: BOT_PLATFORM_ENUM.optional(),
          sceneId: z.string().optional(),
          result: BOT_EVENT_RESULT_ENUM.optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          limit: z.number().int().min(1).max(10000).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        input.platform ? eq(botEventLogs.platform, input.platform) : undefined,
        input.sceneId ? eq(botEventLogs.sceneId, input.sceneId) : undefined,
        input.result ? eq(botEventLogs.result, input.result) : undefined,
        input.startDate
          ? gte(botEventLogs.createdAt, new Date(input.startDate))
          : undefined,
        input.endDate
          ? lte(botEventLogs.createdAt, new Date(input.endDate))
          : undefined,
      );

      const [items, [countResult]] = await Promise.all([
        ctx.db
          .select()
          .from(botEventLogs)
          .where(where)
          .orderBy(desc(botEventLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(botEventLogs)
          .where(where),
      ]);

      return { items, total: countResult?.count ?? 0 };
    }),

  getStats: adminProcedure.query(async ({ ctx }) => {
    const today = startOfBusinessDay();

    const [todayStats, sceneStats, platformStats] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`count(*)::int`,
          success: sql<number>`count(case when ${botEventLogs.result} = 'success' then 1 end)::int`,
          error: sql<number>`count(case when ${botEventLogs.result} = 'error' then 1 end)::int`,
          avgCostMs: sql<number>`coalesce(avg(${botEventLogs.costMs}), 0)::int`,
        })
        .from(botEventLogs)
        .where(gte(botEventLogs.createdAt, today)),
      ctx.db
        .select({
          sceneId: botEventLogs.sceneId,
          count: sql<number>`count(*)::int`,
        })
        .from(botEventLogs)
        .where(gte(botEventLogs.createdAt, today))
        .groupBy(botEventLogs.sceneId),
      ctx.db
        .select({
          platform: botEventLogs.platform,
          count: sql<number>`count(*)::int`,
        })
        .from(botEventLogs)
        .where(gte(botEventLogs.createdAt, today))
        .groupBy(botEventLogs.platform),
    ]);

    return {
      today: todayStats[0] ?? { total: 0, success: 0, error: 0, avgCostMs: 0 },
      byScene: sceneStats,
      byPlatform: platformStats,
    };
  }),

  // ---- 事件日志清理 ----

  /**
   * 共享状态观测。多实例部署时用来确认幂等/待确认状态是否在正常流转
   * （比如待确认记录长期堆积，说明有用户被卡在等待态没被清掉）。
   */
  getSharedStateStats: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const [dedupTotal, pendingTotal, pendingLive] = await Promise.all([
      ctx.db.select({ total: count() }).from(botEventDedup),
      ctx.db.select({ total: count() }).from(botPendingActions),
      ctx.db
        .select({ total: count() })
        .from(botPendingActions)
        .where(gte(botPendingActions.expiresAt, now)),
    ]);
    return {
      dedupTotal: dedupTotal[0]?.total ?? 0,
      pendingTotal: pendingTotal[0]?.total ?? 0,
      /** 未过期的待确认数 —— 正常应该接近 0 */
      pendingLive: pendingLive[0]?.total ?? 0,
    };
  }),

  /** 清理已过期的幂等 / 待确认记录（正常由 webhook 顺带 GC，这里是手动兜底） */
  purgeExpiredSharedState: adminProcedure.mutation(async ({ ctx }) => {
    const now = new Date();
    const [dedup, pending] = await Promise.all([
      ctx.db
        .delete(botEventDedup)
        .where(lt(botEventDedup.expiresAt, now))
        .returning({ k: botEventDedup.dedupKey }),
      ctx.db
        .delete(botPendingActions)
        .where(lt(botPendingActions.expiresAt, now))
        .returning({ k: botPendingActions.pendingKey }),
    ]);
    return { dedupDeleted: dedup.length, pendingDeleted: pending.length };
  }),

  getEventLogStats: adminProcedure.query(async ({ ctx }) => {
    const [countResult, minResult] = await Promise.all([
      ctx.db.select({ total: count() }).from(botEventLogs),
      ctx.db
        .select({ earliest: min(botEventLogs.createdAt) })
        .from(botEventLogs),
    ]);
    return {
      total: countResult[0]?.total ?? 0,
      earliestDate: minResult[0]?.earliest?.toISOString() ?? null,
    };
  }),

  purgeEventLogs: adminProcedure
    .input(
      z.object({
        beforeDate: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(botEventLogs)
        .where(lt(botEventLogs.createdAt, new Date(input.beforeDate)))
        .returning({ id: botEventLogs.id });
      return { deleted: deleted.length };
    }),
});
