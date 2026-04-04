import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { BOT_EVENT_RESULT_ENUM, BOT_PLATFORM_ENUM } from '../constants';
import {
  botEventLogs,
  botPlatforms,
  botScenes,
  botTableMappings,
} from '../schema';
import { reloadBotConfig } from '../services/bot-engine';

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
          .delete(botTableMappings)
          .where(eq(botTableMappings.sceneId, deleted.sceneId));
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
    return ctx.db.select().from(botPlatforms);
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
      await ctx.db
        .insert(botPlatforms)
        .values({
          id,
          platform: input.platform,
          name: input.name,
          credentials: input.credentials,
          isActive: input.isActive,
        })
        .onConflictDoUpdate({
          target: botPlatforms.platform,
          set: {
            name: input.name,
            credentials: input.credentials,
            isActive: input.isActive,
          },
        });
      reloadBotConfig();
      return { id };
    }),

  listTableMappings: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(botTableMappings);
  }),

  upsertTableMapping: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        sceneId: z.string().min(1),
        platform: BOT_PLATFORM_ENUM,
        workspaceId: z.string().min(1),
        tableId: z.string().min(1),
        fieldMapping: z.record(z.string(), z.string()).default({}),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();
      await ctx.db
        .insert(botTableMappings)
        .values({
          id,
          sceneId: input.sceneId,
          platform: input.platform,
          workspaceId: input.workspaceId,
          tableId: input.tableId,
          fieldMapping: input.fieldMapping,
          isActive: input.isActive,
        })
        .onConflictDoUpdate({
          target: [botTableMappings.sceneId, botTableMappings.platform],
          set: {
            workspaceId: input.workspaceId,
            tableId: input.tableId,
            fieldMapping: input.fieldMapping,
            isActive: input.isActive,
          },
        });
      reloadBotConfig();
      return { id };
    }),

  deleteTableMapping: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(botTableMappings)
        .where(eq(botTableMappings.id, input.id));
      reloadBotConfig();
      return { success: true };
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
});
