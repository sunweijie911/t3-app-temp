import { feishuTokenManager } from '../auth/feishu-token';
import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';
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

function mapFields(
  fields: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    const platformKey = mapping[logicalKey] ?? logicalKey;
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
      // 飞书 datetime 字段不支持 isGreaterEqual/isLessEqual，用 isGreater/isLess ±1ms 模拟
      return [
        {
          field_name: fieldName,
          operator: 'isGreater',
          value: [String(startMs - 1)],
        },
        {
          field_name: fieldName,
          operator: 'isLess',
          value: [String(endMs + 1)],
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
    let v: unknown = obj.value;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const isEnd = op === 'isLess' || op === 'isLessEqual';
      const ms = dateStringToMs(v, isEnd);
      // 飞书 datetime 字段不支持 isGreaterEqual/isLessEqual，降级为 isGreater/isLess ±1ms
      if (op === 'isGreaterEqual') {
        return [
          {
            field_name: fieldName,
            operator: 'isGreater',
            value: [String(ms - 1)],
          },
        ];
      }
      if (op === 'isLessEqual') {
        return [
          {
            field_name: fieldName,
            operator: 'isLess',
            value: [String(ms + 1)],
          },
        ];
      }
      v = ms;
    }
    return [{ field_name: fieldName, operator: op, value: [String(v)] }];
  }

  // 简单值：YYYY-MM-DD → 当天范围（飞书 datetime 字段不支持 isGreaterEqual/isLessEqual，用 ±1ms 严格不等式）
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const startMs = dateStringToMs(raw, false);
    const endMs = dateStringToMs(raw, true);
    return [
      {
        field_name: fieldName,
        operator: 'isGreater',
        value: [String(startMs - 1)],
      },
      { field_name: fieldName, operator: 'isLess', value: [String(endMs + 1)] },
    ];
  }

  return [{ field_name: fieldName, operator: 'is', value: [String(raw)] }];
}

function reverseMapFields(
  fields: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const reverse = Object.fromEntries(
    Object.entries(mapping).map(([k, v]) => [v, k]),
  );
  const result: Record<string, unknown> = {};
  for (const [platformKey, value] of Object.entries(fields)) {
    const logicalKey = reverse[platformKey] ?? platformKey;
    result[logicalKey] = value;
  }
  return result;
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
      { fields: mapFields(fields, config.fieldMapping) },
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
      { fields: mapFields(fields, config.fieldMapping) },
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
    const conditions = Object.entries(filters).flatMap(([key, value]) => {
      const platformKey = config.fieldMapping[key] ?? key;
      return buildFilterConditions(platformKey, value);
    });

    const baseBody: Record<string, unknown> = {};
    if (conditions.length > 0) {
      baseBody.filter = { conjunction: 'and', conditions };
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
