import { feishuTokenManager } from '../auth/feishu-token';
import type { DisplayType } from '../core/field-render';
import type {
  FieldMappingValue,
  LinkFieldMapping,
  MultiSelectFieldMapping,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
} from '../core/types';
import {
  dateStringToMs,
  displayTypeOf,
  treatsValueAsDate,
} from './field-types';
import type { SpreadsheetAdapter, SpreadsheetQueryResult } from './types';

async function feishuApi(path: string, method: string, body?: unknown) {
  const token = await feishuTokenManager.getToken();
  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `飞书 Bitable API HTTP 错误: ${res.status} ${res.statusText} path=${path}`,
    );
  }
  const data = (await res.json()) as {
    code: number;
    data?: unknown;
    msg?: string;
  };
  if (data.code !== 0) {
    // 不打印 body 原文，避免用户写入的手机号/身份证等敏感字段值落进日志
    const fieldNames =
      body && typeof body === 'object' && 'fields' in body
        ? Object.keys(
            (body as { fields?: Record<string, unknown> }).fields ?? {},
          )
        : [];
    console.error('[FeishuBitable] API 错误', {
      path,
      code: data.code,
      msg: data.msg,
      fieldNames,
    });
    throw new Error(`飞书 Bitable API 错误: ${data.msg ?? data.code}`);
  }
  return data.data;
}

// ── Link 字段反查 (displayValue → record_id) ──────────────
// 进程内 LRU 缓存。命中 5min；找不到（负缓存）30s — 避免"先建子表→再写主表"流程被卡 5min。
// key 形如 `${baseToken}:${linkTableId}:${displayField}=${displayValue}`
const LINK_CACHE_TTL_MS = 5 * 60 * 1000;
const LINK_CACHE_NEG_TTL_MS = 30 * 1000;
const LINK_CACHE_MAX = 1000;
const linkResolveCache = new Map<
  string,
  { recordId: string | null; expiresAt: number }
>();

function cacheGet(key: string): string | null | undefined {
  const entry = linkResolveCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    linkResolveCache.delete(key);
    return undefined;
  }
  // LRU：命中后移到队尾
  linkResolveCache.delete(key);
  linkResolveCache.set(key, entry);
  return entry.recordId;
}

function cacheSet(key: string, recordId: string | null) {
  if (linkResolveCache.size >= LINK_CACHE_MAX) {
    const oldest = linkResolveCache.keys().next().value;
    if (oldest) linkResolveCache.delete(oldest);
  }
  const ttl = recordId === null ? LINK_CACHE_NEG_TTL_MS : LINK_CACHE_TTL_MS;
  linkResolveCache.set(key, {
    recordId,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * 在 link 子表中按 displayField=displayValue 反查一条 record_id。
 * 找不到返回 null，调用方根据上下文决定抛错或忽略。
 */
async function resolveLinkRecordId(
  workspaceId: string,
  link: LinkFieldMapping,
  displayValue: string,
): Promise<string | null> {
  const cacheKey = `${workspaceId}:${link.linkTableId}:${link.displayField}=${displayValue}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const data = (await feishuApi(
    `/apps/${workspaceId}/tables/${link.linkTableId}/records/search?page_size=1`,
    'POST',
    {
      filter: {
        conjunction: 'and',
        conditions: [
          {
            field_name: link.displayField,
            operator: 'is',
            value: [displayValue],
          },
        ],
      },
    },
  )) as { items?: Array<{ record_id: string }> };
  const recordId = data.items?.[0]?.record_id ?? null;
  cacheSet(cacheKey, recordId);
  return recordId;
}

function isLinkMapping(v: FieldMappingValue): v is LinkFieldMapping {
  return typeof v === 'object' && v.type === 'link';
}

function isMultiSelectMapping(
  v: FieldMappingValue,
): v is MultiSelectFieldMapping {
  return typeof v === 'object' && v.type === 'multiSelect';
}

function platformKeyOf(mapping: FieldMappingValue): string {
  return typeof mapping === 'string' ? mapping : mapping.name;
}

/**
 * 把 LLM 返回的 YYYY-MM-DD 字符串转成飞书日期字段要求的毫秒时间戳。
 * 非日期字符串、或声明为 number/text 的列，原样返回。
 *
 * displayType 必须传：文本列里合法的 "2026-05-11" 曾被无条件转成
 * 1778472000000 写进平台 —— 要么写进去一串数字，要么整条写入失败。
 */
export function coerceFieldValue(
  value: unknown,
  displayType?: DisplayType,
): unknown {
  return dateStringToMs(value, displayType) ?? value;
}

/**
 * 把 LLM 输出的 link 字段显示值（字符串或字符串数组）解析为飞书需要的 record_id 数组。
 * 找不到的 displayValue 抛错（CREATE/UPDATE 时让用户先去子表创建）。
 */
async function resolveLinkValueForWrite(
  workspaceId: string,
  link: LinkFieldMapping,
  raw: unknown,
): Promise<string[]> {
  const values = Array.isArray(raw) ? raw : [raw];
  const recordIds: string[] = [];
  for (const v of values) {
    if (v == null || v === '') continue;
    const displayValue = String(v);
    const recordId = await resolveLinkRecordId(workspaceId, link, displayValue);
    if (!recordId) {
      throw new Error(
        `「${link.name}」未找到关联记录：${displayValue}（请先在「${link.name}」对应的子表中创建该记录）`,
      );
    }
    recordIds.push(recordId);
  }
  return recordIds;
}

export async function mapFieldsForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    // 跳过 null/undefined：飞书 Bitable 收到 {字段: null} 会清空该字段，
    // LLM 幻觉输出无关字段为 null 时不能让它静默删数据
    if (value === null || value === undefined) continue;
    const mapping = config.fieldMapping[logicalKey];
    if (mapping && isLinkMapping(mapping)) {
      result[mapping.name] = await resolveLinkValueForWrite(
        config.workspaceId,
        mapping,
        value,
      );
      continue;
    }
    if (mapping && isMultiSelectMapping(mapping)) {
      // 飞书多选字段写入需要 string[]；兼容标量、数组、null
      const arr = Array.isArray(value) ? value : value == null ? [] : [value];
      result[mapping.name] = arr
        .filter((v) => v != null && v !== '')
        .map((v) => String(v));
      continue;
    }
    const platformKey = platformKeyOf(mapping ?? logicalKey);
    result[platformKey] = coerceFieldValue(value, displayTypeOf(mapping));
  }
  return result;
}

// 飞书 Bitable filter operator 集合
const OP_ALIASES: Record<string, string> = {
  is: 'is',
  '=': 'is',
  '==': 'is',
  isnot: 'isNot',
  '!=': 'isNot',
  '<>': 'isNot',
  contains: 'contains',
  '~': 'contains',
  doesnotcontain: 'doesNotContain',
  isempty: 'isEmpty',
  isnotempty: 'isNotEmpty',
  '>': 'isGreater',
  isgreater: 'isGreater',
  '>=': 'isGreaterEqual',
  isgreaterequal: 'isGreaterEqual',
  '<': 'isLess',
  isless: 'isLess',
  '<=': 'isLessEqual',
  islessequal: 'isLessEqual',
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → 该日 CST 零点的毫秒值 */
function dayStartMs(s: string): number {
  return new Date(`${s}T00:00:00+08:00`).getTime();
}

/** YYYY-MM-DD → 次日 CST 零点的毫秒值 */
function nextDayStartMs(s: string): number {
  return dayStartMs(s) + ONE_DAY_MS;
}

/*
 * ── 飞书 datetime 字段筛选语义（2026-09 对真实 API 实测得出）──────────
 *
 * 关键：**filter 里的 ExactDate 值会被按日截断到零点，而记录侧用真实毫秒比较**。
 * 三组实测数据（记录值 = 2026-05-11 12:00 CST）：
 *   isLess    ExactDate(05-11 23:59:59.001) → 0 条  （值截断成 05-11 00:00，12:00 不小于它）
 *   isLess    ExactDate(05-12 00:00)        → 1 条
 *   isGreater ExactDate(05-11 00:00)        → 命中  （12:00 确实大于当天零点）
 *
 * 由此推出各操作符该取的边界（都以"整天"为语义单位）：
 *   = 当天    → is        当天零点
 *   >= 当天   → isGreater 当天零点 - 1ms   （截断落到前一天）
 *   >  当天   → isGreater 次日零点
 *   <= 当天   → isLess    次日零点
 *   <  当天   → isLess    当天零点
 *
 * 原实现统一用「当天 23:59:59 ± 1ms」，截断后仍是当天零点，导致 isLess 侧
 * 把当天整个排除 —— 所有按日期查询的场景都静默返回空。
 */

/**
 * 把 LLM 输出的单字段 filter 值转换为飞书 Bitable filter conditions。
 * 支持的输入形式：
 * - 简单值: "小王" / 80 / true        → is 精确匹配
 * - YYYY-MM-DD 字符串                  → 当天 CST 范围
 * - { op: 'contains', value: '王' }
 * - { op: '>', value: 50 }
 * - { op: 'between', value: ['2026-05-01', '2026-05-31'] } → 日期段
 * - { op: 'between', value: [50, 80] } + displayType 'number' → 数值区间
 * - { op: 'isEmpty' } / { op: 'isNotEmpty' }
 */
export function buildFilterConditions(
  fieldName: string,
  raw: unknown,
  /**
   * 该字段在 fieldMapping 里声明的展示类型。
   * 'number' / 'text' 都会关掉日期解释：between 切回数值区间，
   * 值里的 YYYY-MM-DD 按字面量比较而不是生成 ExactDate 条件
   * —— 对文本列下 ExactDate 条件，飞书要么报错要么恒不命中。
   */
  displayType?: DisplayType,
): Array<{ field_name: string; operator: string; value: string[] }> {
  const asDate = treatsValueAsDate(displayType);
  // 高级对象语法
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as { op?: string; value?: unknown };
    const opKey = (obj.op ?? '').toString().toLowerCase();

    if (
      opKey === 'between' &&
      Array.isArray(obj.value) &&
      obj.value.length === 2
    ) {
      const [start, end] = obj.value as [unknown, unknown];
      const isDate = (v: unknown): v is string =>
        asDate && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

      // 数值/文本列不能套 ExactDate —— 那是 datetime 字段专用的值格式。
      // 裸数字在 datetime 列上表示精确毫秒（见下方分支），两者从值本身分辨不出来，
      // 只能靠 fieldMapping 的 displayType 显式声明。
      if (!asDate) {
        return [
          {
            field_name: fieldName,
            operator: 'isGreaterEqual',
            value: [String(start)],
          },
          {
            field_name: fieldName,
            operator: 'isLessEqual',
            value: [String(end)],
          },
        ];
      }

      // 下界：当天零点 - 1ms（落到前一天，isGreater 即可含当天）
      const lowerMs = isDate(start) ? dayStartMs(start) - 1 : Number(start);
      // 上界：次日零点（日粒度下 isLess 才能含当天）
      const upperMs = isDate(end) ? nextDayStartMs(end) : Number(end) + 1;
      // 飞书 datetime 字段：value 必须为 ["ExactDate", "<毫秒>"] 双元素；
      // 且不支持 isGreaterEqual/isLessEqual，用 isGreater/isLess 开区间表达
      return [
        {
          field_name: fieldName,
          operator: 'isGreater',
          value: ['ExactDate', String(lowerMs)],
        },
        {
          field_name: fieldName,
          operator: 'isLess',
          value: ['ExactDate', String(upperMs)],
        },
      ];
    }

    const op = OP_ALIASES[opKey];
    if (!op) {
      return [
        { field_name: fieldName, operator: 'is', value: [String(obj.value)] },
      ];
    }
    if (op === 'isEmpty' || op === 'isNotEmpty') {
      return [{ field_name: fieldName, operator: op, value: [] }];
    }
    const rawV: unknown = obj.value;
    if (
      asDate &&
      typeof rawV === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(rawV)
    ) {
      // 飞书 datetime 字段：value 必须 ["ExactDate", "<毫秒>"] 双元素；
      // 且不支持 isGreaterEqual/isLessEqual，用开区间 + 日粒度边界表达
      if (op === 'isGreaterEqual') {
        // >= 当天 ⇔ > 当天零点前一毫秒（落在前一天）
        return [
          {
            field_name: fieldName,
            operator: 'isGreater',
            value: ['ExactDate', String(dayStartMs(rawV) - 1)],
          },
        ];
      }
      if (op === 'isLessEqual') {
        // <= 当天 ⇔ < 次日零点
        return [
          {
            field_name: fieldName,
            operator: 'isLess',
            value: ['ExactDate', String(nextDayStartMs(rawV))],
          },
        ];
      }
      if (op === 'isLess') {
        // < 当天 ⇔ < 当天零点
        return [
          {
            field_name: fieldName,
            operator: 'isLess',
            value: ['ExactDate', String(dayStartMs(rawV))],
          },
        ];
      }
      if (op === 'isGreater') {
        // > 当天 ⇔ > 次日零点。不能用当天零点：记录的真实时刻（如当天 12:00）
        // 确实大于当天零点，会把"当天"这一天错误地算进来
        return [
          {
            field_name: fieldName,
            operator: 'isGreater',
            value: ['ExactDate', String(nextDayStartMs(rawV))],
          },
        ];
      }
      return [
        {
          field_name: fieldName,
          operator: op,
          value: ['ExactDate', String(dayStartMs(rawV))],
        },
      ];
    }
    return [{ field_name: fieldName, operator: op, value: [String(rawV)] }];
  }

  // 简单值：YYYY-MM-DD → 用单条 `is` 匹配当天。
  //
  // 实测确认 ExactDate 是日粒度比较，所以 `is 当天零点` 就等价于"当天"，
  // 不需要拆成 isGreater + isLess 两条。这样还顺带消掉了与 `_conjunction:'or'`
  // 的冲突 —— 单条件不触发 requiresAndConjunction。
  if (asDate && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return [
      {
        field_name: fieldName,
        operator: 'is',
        value: ['ExactDate', String(dayStartMs(raw))],
      },
    ];
  }

  return [{ field_name: fieldName, operator: 'is', value: [String(raw)] }];
}

/** 区间类操作符 —— 由单个 filter key 展开出的多个此类条件之间只能是 AND 关系 */
const RANGE_OPERATORS = new Set([
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
]);

/**
 * 判断某个 filter key 展开出的条件组是否**必须**以 AND 连接。
 *
 * 日期区间（between、裸 YYYY-MM-DD、>=/<= 降级）会被展开成
 * isGreater + isLess 两个条件，二者语义上是「且」。若外层 conjunction 是 'or'，
 * 就变成「大于起点 或 小于终点」→ 全表命中。
 *
 * multiSelect 数组展开出的多个 contains 条件不在此列 —— 那种情况下
 * 「包含 A 或 包含 B」本身就是用户想要的语义。
 */
export function requiresAndConjunction(
  conditions: Array<{ operator: string }>,
): boolean {
  return (
    conditions.length > 1 &&
    conditions.every((c) => RANGE_OPERATORS.has(c.operator))
  );
}

/**
 * 为 link 字段构造 filter conditions：先把 displayValue 反查为 record_id，
 * 再用飞书 link 字段支持的 contains 操作符匹配。
 * 反查不到返回特殊 condition 让结果集为空，避免误匹配整表。
 */
async function buildLinkFilterConditions(
  workspaceId: string,
  link: LinkFieldMapping,
  raw: unknown,
): Promise<Array<{ field_name: string; operator: string; value: string[] }>> {
  // 提取实际值；支持 { op, value } 和裸值
  let value: unknown = raw;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as { value?: unknown };
    if ('value' in obj) value = obj.value;
  }
  if (value == null || value === '') {
    return [{ field_name: link.name, operator: 'isEmpty', value: [] }];
  }
  const recordId = await resolveLinkRecordId(workspaceId, link, String(value));
  if (!recordId) {
    // 反查不到：用一个不可能成立的条件让结果集为空
    return [
      { field_name: link.name, operator: 'is', value: ['__not_found__'] },
    ];
  }
  return [{ field_name: link.name, operator: 'contains', value: [recordId] }];
}

export function reverseMapFields(
  fields: Record<string, unknown>,
  mapping: Record<string, FieldMappingValue>,
): Record<string, unknown> {
  const reverse = Object.fromEntries(
    Object.entries(mapping).map(([k, v]) => [platformKeyOf(v), k]),
  );
  const result: Record<string, unknown> = {};
  for (const [platformKey, value] of Object.entries(fields)) {
    const logicalKey = reverse[platformKey] ?? platformKey;
    result[logicalKey] = value;
  }
  return result;
}

/**
 * 多选字段过滤构造：simple value 用 contains（飞书多选字段不支持 is）。
 * 数组：每元素一个 contains 条件，由调用方决定 conjunction（默认 and）。
 * 高级 {op, value} 语法继续走通用 buildFilterConditions。
 */
function buildMultiSelectFilterConditions(
  fieldName: string,
  raw: unknown,
): Array<{ field_name: string; operator: string; value: string[] }> {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return buildFilterConditions(fieldName, raw);
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((v) => v != null && v !== '')
      .map((v) => ({
        field_name: fieldName,
        operator: 'contains',
        value: [String(v)],
      }));
  }
  if (raw == null || raw === '') {
    return [{ field_name: fieldName, operator: 'isEmpty', value: [] }];
  }
  return [
    { field_name: fieldName, operator: 'contains', value: [String(raw)] },
  ];
}

/** 翻页拉取参数：单页 200 条、最多 5 页 */
const FEISHU_PAGE_SIZE = 200;
const FEISHU_MAX_PAGES = 5;

export class FeishuBitableAdapter implements SpreadsheetAdapter {
  readonly platform = 'feishu' as const;
  readonly queryHardLimit = FEISHU_PAGE_SIZE * FEISHU_MAX_PAGES;

  async createRecord(
    config: SpreadsheetTableConfig,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records`,
      'POST',
      { fields: await mapFieldsForWrite(fields, config) },
    )) as { record: { record_id: string; fields: Record<string, unknown> } };
    return {
      recordId: data.record.record_id,
      fields: reverseMapFields(data.record.fields, config.fieldMapping),
    };
  }

  async updateRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records/${recordId}`,
      'PUT',
      { fields: await mapFieldsForWrite(fields, config) },
    )) as { record: { record_id: string; fields: Record<string, unknown> } };
    return {
      recordId: data.record.record_id,
      fields: reverseMapFields(data.record.fields, config.fieldMapping),
    };
  }

  async queryRecords(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetRecord[]> {
    return (await this.queryRecordsWithMeta(config, filters)).records;
  }

  async queryRecordsWithMeta(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetQueryResult> {
    // _conjunction 协议：默认 and；'or' 时多条件以 OR 连接
    const conjunction = filters._conjunction === 'or' ? 'or' : 'and';
    const conditions: Array<{
      field_name: string;
      operator: string;
      value: string[];
    }> = [];
    for (const [key, value] of Object.entries(filters)) {
      // 跳过保留键（以 _ 开头）
      if (key.startsWith('_')) continue;
      const mapping = config.fieldMapping[key];
      let built: Array<{
        field_name: string;
        operator: string;
        value: string[];
      }>;
      if (mapping && isLinkMapping(mapping)) {
        built = await buildLinkFilterConditions(
          config.workspaceId,
          mapping,
          value,
        );
      } else if (mapping && isMultiSelectMapping(mapping)) {
        built = buildMultiSelectFilterConditions(mapping.name, value);
      } else {
        built = buildFilterConditions(
          platformKeyOf(mapping ?? key),
          value,
          displayTypeOf(mapping),
        );
      }

      // 飞书 bitable filter 是单层扁平结构，表达不出 A AND (B OR C)。
      // 区间条件必须 AND，与外层 'or' 不兼容 —— 静默返回全表比报错危险得多。
      if (conjunction === 'or' && requiresAndConjunction(built)) {
        throw new Error(
          `筛选条件「${key}」是一个区间（需要「且」），无法与「或」条件混用。请拆成两次查询，或改用单一条件`,
        );
      }
      conditions.push(...built);
    }

    const baseBody: Record<string, unknown> = {};
    if (conditions.length > 0) {
      baseBody.filter = { conjunction, conditions };
    }

    // 翻页拉取，避免飞书默认 20 条上限漏数据
    // (单次群聊回复展示前 10 条，1000 条已远超展示需求)
    const PAGE_SIZE = FEISHU_PAGE_SIZE;
    const MAX_PAGES = FEISHU_MAX_PAGES;
    const allItems: Array<{
      record_id: string;
      fields: Record<string, unknown>;
    }> = [];
    let pageToken: string | undefined;
    // 翻页上限用完时平台还说 has_more —— 结果被截断了，要让上层提示用户
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const path = `/apps/${config.workspaceId}/tables/${config.tableId}/records/search?page_size=${PAGE_SIZE}${
        pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
      }`;
      const data = (await feishuApi(path, 'POST', baseBody)) as {
        items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
        has_more?: boolean;
        page_token?: string;
      };
      if (data.items) allItems.push(...data.items);
      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    const logicalKeys = Object.keys(config.fieldMapping);
    const records = allItems.map((item) => {
      const mapped = reverseMapFields(item.fields, config.fieldMapping);
      // 以 fieldMapping 配置的字段为基准，空值填 '' 而非缺失，保证表头完整
      const fields: Record<string, unknown> = Object.fromEntries(
        logicalKeys.map((k) => [k, mapped[k] ?? '']),
      );
      // 保留未在 mapping 中定义的额外字段
      for (const [k, v] of Object.entries(mapped)) {
        if (!(k in fields)) fields[k] = v;
      }
      return { recordId: item.record_id, fields };
    });
    return { records, truncated };
  }

  async deleteRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
  ): Promise<void> {
    await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records/${recordId}`,
      'DELETE',
    );
  }
}
