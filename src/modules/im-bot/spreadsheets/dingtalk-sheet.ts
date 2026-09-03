// cspell:ignore notable
import { dingtalkTokenManager } from '../auth/dingtalk-token';
import type {
  FieldMappingValue,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
} from '../core/types';
import { filterRecords } from './record-filter';
import type { SpreadsheetAdapter } from './types';

/**
 * 钉钉多维表（AI 表格 / notable）Adapter。
 *
 * 与飞书 Bitable 的差异：
 * 1. 定位用 baseId + sheetId 两级；workspaceId 当 baseId、tableId 当 sheetId。
 * 2. 鉴权走 header `x-acs-dingtalk-access-token`，不是 Bearer。
 * 3. 单元格值是裸值（不像企微的类型化数组），但日期要毫秒时间戳。
 * 4. 查询没有等价于飞书 search 的服务端 filter，先拉取再在内存过滤。
 */

const API_BASE = 'https://api.dingtalk.com/v2.0/notable/bases';
/** 单次查询拉取上限，与飞书/企微侧对齐 */
const QUERY_LIMIT = 1000;

async function dingtalkApi(
  path: string,
  method: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = await dingtalkTokenManager.getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // 与其它 adapter 一致：不打印 body 原文，避免用户写入的字段值落进日志
    console.error('[DingtalkSheet] API 错误', {
      path,
      status: res.status,
      code: data.code,
      message: data.message,
    });
    throw new Error(
      `钉钉多维表 API 错误: ${String(data.message ?? res.statusText)}`,
    );
  }
  return data;
}

function platformKeyOf(mapping: FieldMappingValue): string {
  return typeof mapping === 'string' ? mapping : mapping.name;
}

/**
 * 逻辑值 → 钉钉单元格值。
 * 钉钉多维表接受裸值，只有日期需要转毫秒时间戳
 * （CST 当天 12:00，与飞书/企微侧对齐避免跨日）。
 */
export function toDingtalkValue(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00+08:00`).getTime();
  }
  return value;
}

export function mapFieldsForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    // 与其它 adapter 一致：跳过 null/undefined，避免 LLM 幻觉字段静默清空数据
    if (value === null || value === undefined) continue;
    const platformKey = platformKeyOf(
      config.fieldMapping[logicalKey] ?? logicalKey,
    );
    out[platformKey] = toDingtalkValue(value);
  }
  return out;
}

export function mapFieldsFromRead(
  fields: Record<string, unknown>,
  fieldMapping: Record<string, FieldMappingValue>,
): Record<string, unknown> {
  const reverse = Object.fromEntries(
    Object.entries(fieldMapping).map(([k, v]) => [platformKeyOf(v), k]),
  );
  const mapped: Record<string, unknown> = {};
  for (const [platformKey, value] of Object.entries(fields)) {
    mapped[reverse[platformKey] ?? platformKey] = value;
  }
  // 以 fieldMapping 为基准补齐空值，保证展示时表头完整
  const result: Record<string, unknown> = Object.fromEntries(
    Object.keys(fieldMapping).map((k) => [k, mapped[k] ?? '']),
  );
  for (const [k, v] of Object.entries(mapped)) {
    if (!(k in result)) result[k] = v;
  }
  return result;
}

interface DingtalkRecord {
  id?: string;
  recordId?: string;
  fields?: Record<string, unknown>;
}

function readRecordId(r: DingtalkRecord): string {
  return r.id ?? r.recordId ?? '';
}

export class DingtalkSheetAdapter implements SpreadsheetAdapter {
  readonly platform = 'dingtalk' as const;

  async createRecord(
    config: SpreadsheetTableConfig,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = await dingtalkApi(
      `/${config.workspaceId}/sheets/${config.tableId}/records`,
      'POST',
      { records: [{ fields: mapFieldsForWrite(fields, config) }] },
    );
    const created = (data.records as DingtalkRecord[] | undefined)?.[0];
    if (!created) throw new Error('钉钉多维表未返回新建记录');
    return {
      recordId: readRecordId(created),
      fields: mapFieldsFromRead(created.fields ?? {}, config.fieldMapping),
    };
  }

  async updateRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = await dingtalkApi(
      `/${config.workspaceId}/sheets/${config.tableId}/records`,
      'PUT',
      {
        records: [{ id: recordId, fields: mapFieldsForWrite(fields, config) }],
      },
    );
    const updated = (data.records as DingtalkRecord[] | undefined)?.[0];
    return {
      recordId: updated ? readRecordId(updated) || recordId : recordId,
      fields: mapFieldsFromRead(updated?.fields ?? {}, config.fieldMapping),
    };
  }

  async queryRecords(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetRecord[]> {
    const data = await dingtalkApi(
      `/${config.workspaceId}/sheets/${config.tableId}/records?maxResults=${QUERY_LIMIT}`,
      'GET',
    );
    const all = ((data.records as DingtalkRecord[] | undefined) ?? []).map(
      (r) => ({
        recordId: readRecordId(r),
        fields: mapFieldsFromRead(r.fields ?? {}, config.fieldMapping),
      }),
    );
    return filterRecords(all, filters);
  }

  async deleteRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
  ): Promise<void> {
    await dingtalkApi(
      `/${config.workspaceId}/sheets/${config.tableId}/records/delete`,
      'POST',
      { ids: [recordId] },
    );
  }
}
