// cspell:ignore pkey
import { TRPCError } from '@trpc/server';
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
import {
  reloadBotConfig,
  reloadPlatformCredentials,
} from '../services/bot-engine';

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

/** 飞书里语义上是「时刻」的列 */
const DATE_UI_TYPES = new Set(['DateTime', 'CreatedTime', 'ModifiedTime']);
/** 飞书里语义上是「数量」的列 —— 不能被当成日期毫秒值 */
const NUMBER_UI_TYPES = new Set([
  'Number',
  'Currency',
  'Progress',
  'Rating',
  'AutoNumber',
]);

/**
 * 推断 plain 映射的 displayType。
 *
 * 这一步以前是缺的：ui_type 明明拉回来了却只用来选 plain/link/multiSelect，
 * displayType 全靠管理员手写 JSON，于是实际配置里几乎不存在 ——
 * 日期列的格式提示进不了 prompt、金额被按毫秒渲染成日期、
 * 文本列里的 "2026-05-11" 被写成时间戳。
 */
function suggestDisplayType(
  uiType: string | undefined,
): 'date' | 'number' | 'text' {
  if (uiType && DATE_UI_TYPES.has(uiType)) return 'date';
  if (uiType && NUMBER_UI_TYPES.has(uiType)) return 'number';
  return 'text';
}

/** 取选项名，过滤空值。只有 SingleSelect / MultiSelect 这类列有 options */
function optionNamesOf(
  options: Array<{ name?: string }> | undefined,
): string[] | undefined {
  if (!options?.length) return undefined;
  const names = options
    .map((o) => o.name?.trim())
    .filter((n): n is string => !!n);
  return names.length > 0 ? names : undefined;
}

/** 从 fieldMapping 的一个 value 里取平台侧列名 */
function platformNameOf(mapping: unknown): string | null {
  if (typeof mapping === 'string') return mapping;
  if (mapping && typeof mapping === 'object') {
    const name = (mapping as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return null;
}

/** 从 fieldMapping 的一个 value 里取已存的合法取值 */
function storedOptionsOf(mapping: unknown): string[] {
  if (!mapping || typeof mapping !== 'object') return [];
  const opts = (mapping as { options?: unknown }).options;
  return Array.isArray(opts) ? opts.filter((o) => typeof o === 'string') : [];
}

/** fieldMapping 里被标为主标识的逻辑键 */
function primaryKeysOf(fieldMapping: Record<string, unknown>): string[] {
  return Object.entries(fieldMapping)
    .filter(
      ([, v]) =>
        v &&
        typeof v === 'object' &&
        (v as { primary?: unknown }).primary === true,
    )
    .map(([k]) => k);
}

/** 飞书 fields 接口返回的一列 */
interface LiveBitableField {
  field_id: string;
  field_name: string;
  type: number;
  ui_type?: string;
  property?: {
    multiple?: boolean;
    /** 单选 / 多选列的可选项，用来生成 prompt 里的合法取值清单 */
    options?: Array<{ name?: string }>;
  };
}

/** 单页字段数上限。翻页拉完，避免宽表（>100 列）静默丢字段 */
const FIELDS_PAGE_SIZE = 100;
const FIELDS_MAX_PAGES = 5;

/**
 * 拉取一张多维表当前的全部列。字段选择器与漂移检测共用。
 *
 * 会翻页：以前固定 `page_size=100` 且不翻页，>100 列的表会**静默丢字段**
 * —— 丢掉的列既进不了 fieldMapping，也就永远不会出现在 prompt 里。
 */
async function fetchLiveBitableFields(
  workspaceId: string,
  tableId: string,
): Promise<LiveBitableField[]> {
  const token = await feishuTokenManager.getToken();
  const all: LiveBitableField[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < FIELDS_MAX_PAGES; page++) {
    const query = `page_size=${FIELDS_PAGE_SIZE}${
      pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
    }`;
    const res = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${workspaceId}/tables/${tableId}/fields?${query}`,
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
        items?: LiveBitableField[];
        has_more?: boolean;
        page_token?: string;
      };
    };
    if (data.code !== 0) {
      throw new Error(`飞书 API 错误: ${data.msg ?? data.code}`);
    }
    all.push(...(data.data?.items ?? []));
    if (!data.data?.has_more || !data.data.page_token) break;
    pageToken = data.data.page_token;
  }
  return all;
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
        /**
         * 必填。前端 Form.Item 上的 `required` 只是个星号 —— 那些表单是
         * 受控 state + 直接 mutate，没有 form.validateFields()，什么都不校验。
         * 服务端放行的话，场景能存下来并显示「启用」，而 bot-engine 的
         * `if (!s.systemPrompt) continue` 会静默跳过它：机器人永远看不见
         * 这个场景，管理员也拿不到任何提示。
         */
        systemPrompt: z
          .string()
          .min(1, 'System Prompt 不能为空，否则该场景不会被机器人加载'),
        /** @deprecated 见 schema 里的说明；字段清单已改为从资源绑定自动派生 */
        fieldSchema: z.any().optional(),
        replyTemplate: z.string().optional(),
        /** 空数组 = 任何会话都能触发 */
        allowedChatIds: z.array(z.string().min(1)).default([]),
        /** 空数组 = 任何人都能写 */
        writerIds: z.array(z.string().min(1)).default([]),
        isActive: z.boolean().default(true),
        sortOrder: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();

      // sceneId 上另有唯一约束，而 ON CONFLICT 的目标是主键 id ——
      // 撞名时覆盖不到，Postgres 直接抛 duplicate key 裸错给管理员。
      // 先查一次，给一句能照着改的提示
      const [taken] = await ctx.db
        .select({ id: botScenes.id })
        .from(botScenes)
        .where(
          input.id
            ? and(eq(botScenes.sceneId, input.sceneId), ne(botScenes.id, id))
            : eq(botScenes.sceneId, input.sceneId),
        )
        .limit(1);
      if (taken) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `场景 ID「${input.sceneId}」已被占用，请换一个`,
        });
      }

      // 资源绑定是按 sceneId 字符串关联的，改了场景 ID 必须一起迁移，
      // 否则绑定全变成孤儿：机器人匹配到场景却找不到任何资源
      const [old] = input.id
        ? await ctx.db
            .select({ sceneId: botScenes.sceneId })
            .from(botScenes)
            .where(eq(botScenes.id, id))
            .limit(1)
        : [];

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
          allowedChatIds: input.allowedChatIds,
          writerIds: input.writerIds,
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
            allowedChatIds: input.allowedChatIds,
            writerIds: input.writerIds,
            isActive: input.isActive,
            sortOrder: input.sortOrder,
          },
        });

      if (old && old.sceneId !== input.sceneId) {
        await ctx.db
          .update(botResourceBindings)
          .set({ sceneId: input.sceneId })
          .where(eq(botResourceBindings.sceneId, old.sceneId));
      }

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
      reloadPlatformCredentials(input.platform);
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
        })
        // 钉钉/企微的文档 adapter 是抛错占位。不在这里拦住的话，绑定能存下来，
        // 到运行期才抛「尚未实现」—— 用户只会看到机器人报错，不知道是配置问题
        .refine((v) => v.kind !== 'doc' || v.provider === 'feishu', {
          message: '文档资源目前只支持飞书（钉钉 / 企微文档适配器尚未实现）',
          path: ['provider'],
        })
        // 主标识只能有一个：多个的话"优先展示主标识"就没有确定含义了
        .refine((v) => primaryKeysOf(v.fieldMapping).length <= 1, {
          message: '只能有一个字段标记为主标识（primary: true）',
          path: ['fieldMapping'],
        })
        // 表格必须有主标识。缺了就退回代码里反复警告的启发式：
        // fieldMapping 存在 jsonb 里，Postgres 按「键长度 + 字节序」重排键，
        // "第一列是名称类"的假设不成立 —— 实测删除确认会渲染成
        // 「利润=-108 / 备注=… / 月份=1月」，用户判断不出要删哪条
        .refine(
          (v) =>
            v.kind !== 'table' ||
            Object.keys(v.fieldMapping).length === 0 ||
            primaryKeysOf(v.fieldMapping).length === 1,
          {
            message:
              '表格资源必须指定一个主标识字段（候选列表、删除确认、查询投影都靠它定位记录）',
            path: ['fieldMapping'],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.id ?? nanoid();
      // uniqueKey 用 null 而非 undefined：drizzle 会跳过 undefined 的列，
      // 那样编辑时「清空唯一键」保存后仍是旧值
      const columns = {
        sceneId: input.sceneId,
        alias: input.alias,
        kind: input.kind,
        provider: input.provider,
        workspaceId: input.workspaceId,
        resourceId: input.resourceId,
        fieldMapping: input.fieldMapping,
        uniqueKey: input.uniqueKey ?? null,
        isDefault: input.isDefault,
        isActive: input.isActive,
      };

      await ctx.db.transaction(async (tx) => {
        // 同场景内只允许一条默认资源，否则 dispatcher 的默认解析会不确定。
        // 编辑时按 id 排除自己 —— 用别名排除的话，改了别名就会把自己也清掉
        if (input.isDefault) {
          await tx
            .update(botResourceBindings)
            .set({ isDefault: false })
            .where(
              and(
                eq(botResourceBindings.sceneId, input.sceneId),
                input.id
                  ? ne(botResourceBindings.id, input.id)
                  : ne(botResourceBindings.alias, input.alias),
              ),
            );
        }

        if (input.id) {
          // 编辑必须按 id 更新。带着旧 id 走 insert ... on conflict (sceneId, alias)：
          // 改了别名或换了场景时冲突不在那个目标索引上，而是撞主键，
          // Postgres 直接抛 duplicate key ... "bot_resource_binding_pkey"，
          // ON CONFLICT 覆盖不到 —— 表现为「改个别名就保存失败」
          const [taken] = await tx
            .select({ id: botResourceBindings.id })
            .from(botResourceBindings)
            .where(
              and(
                eq(botResourceBindings.sceneId, input.sceneId),
                eq(botResourceBindings.alias, input.alias),
                ne(botResourceBindings.id, input.id),
              ),
            )
            .limit(1);
          if (taken) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `场景「${input.sceneId}」下已存在别名「${input.alias}」的资源绑定，请换一个别名`,
            });
          }
          const [updated] = await tx
            .update(botResourceBindings)
            .set(columns)
            .where(eq(botResourceBindings.id, input.id))
            .returning({ id: botResourceBindings.id });
          if (!updated) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: '资源绑定不存在，可能已被其他人删除',
            });
          }
        } else {
          await tx
            .insert(botResourceBindings)
            .values({ id, ...columns })
            .onConflictDoUpdate({
              target: [botResourceBindings.sceneId, botResourceBindings.alias],
              set: columns,
            });
        }
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
      const items = await fetchLiveBitableFields(
        input.workspaceId,
        input.tableId,
      );
      // ui_type 参考 飞书 OpenAPI；这里只用到几个常见值映射建议类型
      return items.map((it) => ({
        fieldId: it.field_id,
        fieldName: it.field_name,
        uiType: it.ui_type ?? '',
        // 给前端的建议映射类型；admin 仍可手动覆盖
        suggestedType: suggestMappingType(it.ui_type, it.property?.multiple),
        suggestedDisplayType: suggestDisplayType(it.ui_type),
        // 合法取值。以前只取了 ui_type 和 multiple，options 白白丢掉，
        // 于是管理员只能把「支出分类：美妆产品 / 进货 / …」手抄进
        // 场景 prompt，飞书里一改选项就过期
        options: optionNamesOf(it.property?.options),
      }));
    }),

  /**
   * 字段漂移检测：把绑定里存的 fieldMapping 与飞书上**当前真实**的列对一遍。
   *
   * 为什么必须有：prompt 里的字段清单是从 fieldMapping 派生的（这一步是
   * 自动的），但 fieldMapping 本身只在管理员点「拉取字段」时才更新。于是
   * - 飞书**加一列** → LLM 不知道这列存在，用户说了也记不进去，且无任何提示
   * - 飞书**改列名** → 映射里还是旧的平台名，写入直接 InvalidFieldName
   * - 单选**加选项** → prompt 里的合法取值过期，LLM 挑一个不存在的值
   * 三种都是静默的，只能靠主动比对暴露出来。
   *
   * 为什么不放在加载绑定时自动做：getDispatcher() 是在**回调 ack 之前**
   * 被 await 的，每张表加一次 API 调用会直接恶化 3 秒 ack 预算。
   * 所以做成管理员按需触发的诊断，不进热路径。
   */
  checkResourceBindingDrift: adminProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(botResourceBindings)
        .where(
          input.id
            ? eq(botResourceBindings.id, input.id)
            : eq(botResourceBindings.isActive, true),
        );

      const results = [];
      for (const row of rows) {
        // 只有飞书表格能查字段；其余原样跳过并说明原因
        if (row.kind !== 'table' || row.provider !== 'feishu') {
          results.push({
            id: row.id,
            sceneId: row.sceneId,
            alias: row.alias,
            skipped: `${row.kind} / ${row.provider} 暂不支持字段比对`,
            missingOnPlatform: [],
            newOnPlatform: [],
            staleOptions: [],
          });
          continue;
        }

        const mapping = (row.fieldMapping ?? {}) as Record<string, unknown>;
        try {
          const live = await fetchLiveBitableFields(
            row.workspaceId,
            row.resourceId,
          );
          const liveByName = new Map(live.map((f) => [f.field_name, f]));

          /** 映射里有、平台上已经没有的列 —— 写入会报 InvalidFieldName */
          const missingOnPlatform: Array<{
            logicalKey: string;
            platformName: string;
          }> = [];
          /** 单选取值对不上 —— prompt 里的合法值过期了 */
          const staleOptions: Array<{
            logicalKey: string;
            stored: string[];
            live: string[];
          }> = [];

          for (const [logicalKey, value] of Object.entries(mapping)) {
            const platformName = platformNameOf(value);
            if (!platformName) continue;
            const liveField = liveByName.get(platformName);
            if (!liveField) {
              missingOnPlatform.push({ logicalKey, platformName });
              continue;
            }
            const liveOptions = optionNamesOf(liveField.property?.options);
            if (!liveOptions) continue;
            const stored = storedOptionsOf(value);
            const same =
              stored.length === liveOptions.length &&
              stored.every((o, i) => o === liveOptions[i]);
            if (!same) {
              staleOptions.push({ logicalKey, stored, live: liveOptions });
            }
          }

          const mappedPlatformNames = new Set(
            Object.values(mapping)
              .map(platformNameOf)
              .filter((n): n is string => !!n),
          );
          /** 平台上有、映射里没有的列 —— LLM 完全不知道它存在 */
          const newOnPlatform = live
            .map((f) => f.field_name)
            .filter((n) => !mappedPlatformNames.has(n));

          results.push({
            id: row.id,
            sceneId: row.sceneId,
            alias: row.alias,
            skipped: null,
            missingOnPlatform,
            newOnPlatform,
            staleOptions,
          });
        } catch (err) {
          results.push({
            id: row.id,
            sceneId: row.sceneId,
            alias: row.alias,
            skipped: `拉取字段失败：${err instanceof Error ? err.message : String(err)}`,
            missingOnPlatform: [],
            newOnPlatform: [],
            staleOptions: [],
          });
        }
      }
      return results;
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
          // 挂起二次确认的次数。单列出来，不并入 error，
          // 否则每次 DELETE / 单条 UPDATE 都会把错误率顶上去
          pending: sql<number>`count(case when ${botEventLogs.result} = 'pending' then 1 end)::int`,
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
      today: todayStats[0] ?? {
        total: 0,
        success: 0,
        error: 0,
        pending: 0,
        avgCostMs: 0,
      },
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
