import { feishuTokenManager } from '../auth/feishu-token';
import type {
  FieldMappingValue,
  LinkFieldMapping,
  MultiSelectFieldMapping,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
} from '../core/types';
import type { SpreadsheetAdapter } from './types';

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
    console.error('[FeishuBitable] API 错误', {
      path,
      body: JSON.stringify(body),
      code: data.code,
      msg: data.msg,
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
 * 把 LLM 返回的 YYYY-MM-DD 字符串转成飞书日期字段要求的毫秒时间戳
 * （CST 当天 12:00，避免时区误差跨日）。
 * 非日期字符串原样返回。
 */
function coerceFieldValue(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00+08:00`).getTime();
  }
  return value;
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
        `「${link.name}」未找到关联记录：${displayValue}（请先在子表「${link.linkTableId}」创建该记录）`,
      );
    }
    recordIds.push(recordId);
  }
  return recordIds;
}

async function mapFieldsForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
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
    result[platformKey] = coerceFieldValue(value);
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

function dateStringToMs(s: string, end = false): number {
  const time = end ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
  return new Date(`${s}${time}`).getTime();
}

/**
 * 把 LLM 输出的单字段 filter 值转换为飞书 Bitable filter conditions。
 * 支持的输入形式：
 * - 简单值: "小王" / 80 / true        → is 精确匹配
 * - YYYY-MM-DD 字符串                  → 当天 CST 范围
 * - { op: 'contains', value: '王' }
 * - { op: '>', value: 50 }
 * - { op: 'between', value: ['2026-05-01', '2026-05-31'] } → 日期段
 * - { op: 'isEmpty' } / { op: 'isNotEmpty' }
 */
function buildFilterConditions(
  fieldName: string,
  raw: unknown,
): Array<{ field_name: string; operator: string; value: string[] }> {
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
      const startMs =
        typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start)
          ? dateStringToMs(start, false)
          : Number(start);
      const endMs =
        typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end)
          ? dateStringToMs(end, true)
          : Number(end);
      // 飞书 datetime 字段：value 必须为 ["ExactDate", "<毫秒>"] 双元素；
      // 且不支持 isGreaterEqual/isLessEqual，用 isGreater/isLess ±1ms 模拟
      return [
        {
          field_name: fieldName,
          operator: 'isGreater',
          value: ['ExactDate', String(startMs - 1)],
        },
        {
          field_name: fieldName,
          operator: 'isLess',
          value: ['ExactDate', String(endMs + 1)],
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
    if (typeof rawV === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawV)) {
      const isEnd = op === 'isLess' || op === 'isLessEqual';
      const ms = dateStringToMs(rawV, isEnd);
      // 飞书 datetime 字段：value 必须 ["ExactDate", "<毫秒>"] 双元素；
      // 且不支持 isGreaterEqual/isLessEqual，降级为 isGreater/isLess ±1ms
      if (op === 'isGreaterEqual') {
        return [
          {
            field_name: fieldName,
            operator: 'isGreater',
            value: ['ExactDate', String(ms - 1)],
          },
        ];
      }
      if (op === 'isLessEqual') {
        return [
          {
            field_name: fieldName,
            operator: 'isLess',
            value: ['ExactDate', String(ms + 1)],
          },
        ];
      }
      return [
        {
          field_name: fieldName,
          operator: op,
          value: ['ExactDate', String(ms)],
        },
      ];
    }
    return [{ field_name: fieldName, operator: op, value: [String(rawV)] }];
  }

  // 简单值：YYYY-MM-DD → 当天范围
  // 飞书 datetime 字段：value 必须 ["ExactDate", "<毫秒>"] 双元素；
  // 且不支持 isGreaterEqual/isLessEqual，用 isGreater/isLess ±1ms 严格不等式
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const startMs = dateStringToMs(raw, false);
    const endMs = dateStringToMs(raw, true);
    return [
      {
        field_name: fieldName,
        operator: 'isGreater',
        value: ['ExactDate', String(startMs - 1)],
      },
      {
        field_name: fieldName,
        operator: 'isLess',
        value: ['ExactDate', String(endMs + 1)],
      },
    ];
  }

  return [{ field_name: fieldName, operator: 'is', value: [String(raw)] }];
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

function reverseMapFields(
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

export class FeishuBitableAdapter implements SpreadsheetAdapter {
  readonly platform = 'feishu' as const;

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
      if (mapping && isLinkMapping(mapping)) {
        conditions.push(
          ...(await buildLinkFilterConditions(
            config.workspaceId,
            mapping,
            value,
          )),
        );
      } else if (mapping && isMultiSelectMapping(mapping)) {
        conditions.push(
          ...buildMultiSelectFilterConditions(mapping.name, value),
        );
      } else {
        conditions.push(
          ...buildFilterConditions(platformKeyOf(mapping ?? key), value),
        );
      }
    }

    const baseBody: Record<string, unknown> = {};
    if (conditions.length > 0) {
      baseBody.filter = { conjunction, conditions };
    }

    // 翻页拉取，避免飞书默认 20 条上限漏数据；用 PAGE_SIZE=200 + MAX_PAGES=5 上限保护
    // (单次群聊回复展示前 10 条，1000 条已远超展示需求)
    const PAGE_SIZE = 200;
    const MAX_PAGES = 5;
    const allItems: Array<{
      record_id: string;
      fields: Record<string, unknown>;
    }> = [];
    let pageToken: string | undefined;

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
    }

    const logicalKeys = Object.keys(config.fieldMapping);
    return allItems.map((item) => {
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
