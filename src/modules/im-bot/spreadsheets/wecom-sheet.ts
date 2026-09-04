// cspell:ignore wedoc smartsheet docid
import { wecomTokenManager } from '../auth/wecom-token';
import type { DisplayType } from '../core/field-render';
import type {
  FieldMappingValue,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
} from '../core/types';
import { dateStringToMs, displayTypeOf } from './field-types';
import { filterRecords } from './record-filter';
import type { SpreadsheetAdapter, SpreadsheetQueryResult } from './types';

/**
 * 企微智能表格（smartsheet）Adapter。
 *
 * 与飞书 Bitable 的两处协议差异：
 * 1. 定位用 docid + sheet_id 两级；我们把 workspaceId 当 docid、tableId 当 sheet_id。
 * 2. 单元格值不是裸值，而是**类型化数组**，形如
 *    `{"项目名称": [{"type":"text","text":"督导2.0"}]}`。
 *    这层转换是本文件唯一有实际逻辑的部分，因此单独导出以便单测。
 */

const API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet';
/** 单页拉取条数。保持 1000 不变 —— 首个请求与改动前完全一致，不引入回归 */
const PAGE_SIZE = 1000;
/** 续拉页数上限，防止超大表把内存和时延拖垮 */
const MAX_PAGES = 5;

async function wecomApi(path: string, body: unknown): Promise<unknown> {
  const token = await wecomTokenManager.getToken();
  const res = await fetch(
    `${API_BASE}${path}?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `企微智能表格 API HTTP 错误: ${res.status} ${res.statusText} path=${path}`,
    );
  }
  const data = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    [k: string]: unknown;
  };
  if (data.errcode && data.errcode !== 0) {
    // 与飞书 adapter 一致：不打印 body 原文，避免用户写入的字段值落进日志
    console.error('[WecomSheet] API 错误', {
      path,
      errcode: data.errcode,
      errmsg: data.errmsg,
    });
    throw new Error(`企微智能表格 API 错误: ${data.errmsg ?? data.errcode}`);
  }
  return data;
}

function platformKeyOf(mapping: FieldMappingValue): string {
  return typeof mapping === 'string' ? mapping : mapping.name;
}

/** 企微智能表格的类型化单元格 */
export type WecomCell =
  | { type: 'text'; text: string }
  | { type: 'number'; number: number }
  | { type: 'date'; date: number }
  | { type: 'checkbox'; checkbox: boolean };

/**
 * 把逻辑值转成企微的类型化单元格数组。
 * - number → number 单元格
 * - boolean → checkbox
 * - YYYY-MM-DD 字符串 → date（CST 当天 00:00，与飞书/钉钉侧共用
 *   field-types.ts 的换算）；声明为 number/text 的列走 text，
 *   不再误判成日期单元格
 * - 数组 → 逐元素转（多选/多值字段）
 * - 其它 → text
 */
export function toWecomCells(
  value: unknown,
  displayType?: DisplayType,
): WecomCell[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => toWecomCells(v, displayType));
  }
  if (typeof value === 'number') {
    return [{ type: 'number', number: value }];
  }
  if (typeof value === 'boolean') {
    return [{ type: 'checkbox', checkbox: value }];
  }
  const ms = dateStringToMs(value, displayType);
  if (ms !== null) return [{ type: 'date', date: ms }];
  return [{ type: 'text', text: String(value) }];
}

/** 把企微的类型化单元格数组还原为可读值 */
export function fromWecomCells(cells: unknown): unknown {
  if (!Array.isArray(cells)) return cells ?? '';
  const vals = cells.map((c) => {
    if (!c || typeof c !== 'object') return String(c ?? '');
    const cell = c as Record<string, unknown>;
    if (typeof cell.text === 'string') return cell.text;
    if (typeof cell.number === 'number') return cell.number;
    if (typeof cell.date === 'number') return cell.date;
    if (typeof cell.checkbox === 'boolean') return cell.checkbox;
    // 人员/关联等复合类型：优先取 name
    if (typeof cell.name === 'string') return cell.name;
    return '';
  });
  if (vals.length === 0) return '';
  if (vals.length === 1) return vals[0];
  return vals;
}

/** 逻辑字段 → 企微 values（平台字段名 + 类型化单元格） */
export function mapValuesForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Record<string, WecomCell[]> {
  const out: Record<string, WecomCell[]> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    // 与飞书侧一致：跳过 null/undefined，避免 LLM 幻觉字段静默清空数据
    if (value === null || value === undefined) continue;
    const mapping = config.fieldMapping[logicalKey];
    const platformKey = platformKeyOf(mapping ?? logicalKey);
    out[platformKey] = toWecomCells(value, displayTypeOf(mapping));
  }
  return out;
}

/** 企微 values → 逻辑字段（按 fieldMapping 反查，并补齐空列） */
export function mapValuesFromRead(
  values: Record<string, unknown>,
  fieldMapping: Record<string, FieldMappingValue>,
): Record<string, unknown> {
  const reverse = Object.fromEntries(
    Object.entries(fieldMapping).map(([k, v]) => [platformKeyOf(v), k]),
  );
  const mapped: Record<string, unknown> = {};
  for (const [platformKey, cells] of Object.entries(values)) {
    mapped[reverse[platformKey] ?? platformKey] = fromWecomCells(cells);
  }
  // 以 fieldMapping 为基准补齐空值，保证展示时表头完整（与飞书侧一致）
  const result: Record<string, unknown> = Object.fromEntries(
    Object.keys(fieldMapping).map((k) => [k, mapped[k] ?? '']),
  );
  for (const [k, v] of Object.entries(mapped)) {
    if (!(k in result)) result[k] = v;
  }
  return result;
}

interface WecomRecord {
  record_id: string;
  values?: Record<string, unknown>;
}

export class WecomSheetAdapter implements SpreadsheetAdapter {
  readonly platform = 'wecom' as const;
  readonly queryHardLimit = PAGE_SIZE * MAX_PAGES;

  async createRecord(
    config: SpreadsheetTableConfig,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await wecomApi('/add_records', {
      docid: config.workspaceId,
      sheet_id: config.tableId,
      records: [{ values: mapValuesForWrite(fields, config) }],
    })) as { records?: WecomRecord[] };
    const created = data.records?.[0];
    if (!created) throw new Error('企微智能表格未返回新建记录');
    return {
      recordId: created.record_id,
      fields: mapValuesFromRead(created.values ?? {}, config.fieldMapping),
    };
  }

  async updateRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await wecomApi('/update_records', {
      docid: config.workspaceId,
      sheet_id: config.tableId,
      records: [
        { record_id: recordId, values: mapValuesForWrite(fields, config) },
      ],
    })) as { records?: WecomRecord[] };
    const updated = data.records?.[0];
    return {
      recordId: updated?.record_id ?? recordId,
      fields: mapValuesFromRead(updated?.values ?? {}, config.fieldMapping),
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
    // 续拉：企微按 offset 翻页。以前只发一个请求，超过单页的记录被静默丢掉，
    // 再叠加内存过滤 —— 大表上表现为"查不到"而不是报错。
    //
    // offset 若不被支持，第二页会原样回第一页 —— 靠 record_id 去重识别出
    // "这页没有新记录"并立即停止，避免把同一批记录重复计进结果。
    const all: SpreadsheetRecord[] = [];
    const seen = new Set<string>();
    // 与钉钉同理：截断发生在内存过滤之前，只能由 adapter 自己上报
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = (await wecomApi('/get_records', {
        docid: config.workspaceId,
        sheet_id: config.tableId,
        limit: PAGE_SIZE,
        // 第一页不带 offset：请求体与改动前逐字节一致
        ...(page > 0 ? { offset: all.length } : {}),
      })) as { records?: WecomRecord[] };

      const rows = data.records ?? [];
      let fresh = 0;
      for (const r of rows) {
        if (r.record_id && seen.has(r.record_id)) continue;
        if (r.record_id) seen.add(r.record_id);
        fresh++;
        all.push({
          recordId: r.record_id,
          fields: mapValuesFromRead(r.values ?? {}, config.fieldMapping),
        });
      }

      if (fresh === 0 || rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    return { records: filterRecords(all, filters), truncated };
  }

  async deleteRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
  ): Promise<void> {
    await wecomApi('/delete_records', {
      docid: config.workspaceId,
      sheet_id: config.tableId,
      record_ids: [recordId],
    });
  }
}
