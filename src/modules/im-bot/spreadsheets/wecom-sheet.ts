// cspell:ignore wedoc smartsheet docid
import { wecomTokenManager } from '../auth/wecom-token';
import type {
  FieldMappingValue,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
} from '../core/types';
import { dateStringToMs, displayTypeOf } from './field-types';
import { normalizeCell } from './normalize';
import { filterRecords } from './record-filter';
import type { SpreadsheetAdapter, SpreadsheetQueryResult } from './types';

/**
 * 企微智能表格（smartsheet）Adapter。
 *
 * 与飞书 Bitable 的两处协议差异：
 * 1. 定位用 docid + sheet_id 两级；我们把 workspaceId 当 docid、tableId 当 sheet_id。
 * 2. `values` 的 key 是**字段名称**，value 的形状随字段类型变
 *    （文本裸字符串、数字裸 double、日期字符串、选项 `[{text}]`）。
 *    这层转换是本文件唯一有实际逻辑的部分，因此单独导出以便单测。
 */

const API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet';
/** 单页拉取条数。保持 1000 不变 —— 首个请求与改动前完全一致，不引入回归 */
const PAGE_SIZE = 1000;
/** 续拉页数上限，防止超大表把内存和时延拖垮 */
const MAX_PAGES = 5;

/** 写记录的两个接口。只有它们的错误才值得附带选项列诊断信息 */
function isWritePath(path: string): boolean {
  return path === '/add_records' || path === '/update_records';
}

/**
 * 从请求体里挑出「按选项形状写入」的列名，**只要列名不要值**。
 *
 * 选项列的 value 是 `[{text}]`（缺服务端 id，见 toWecomValue 的 TODO），
 * 平台拒绝时给的 errcode 不指名是哪一列 —— 有这行日志才能一眼看出
 * "报错的这次写入正好碰了这几个选项列"。
 */
function optionColumnsOf(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const records = (body as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  const names = new Set<string>();
  for (const rec of records) {
    const values = (rec as { values?: unknown })?.values;
    if (!values || typeof values !== 'object') continue;
    for (const [key, cell] of Object.entries(values)) {
      if (
        Array.isArray(cell) &&
        cell.every((v) => v !== null && typeof v === 'object')
      ) {
        names.add(key);
      }
    }
  }
  return [...names];
}

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
    // 与飞书 adapter 一致：不打印 body 原文，避免用户写入的字段值落进日志。
    // 但写接口出错时**只打列名**：选项列少了服务端 id 是已知风险
    // （见 toWecomValue 的 TODO），错误码本身不说是哪一列，
    // 没有这行就只能靠猜。列名来自 fieldMapping，不含用户数据。
    console.error('[WecomSheet] API 错误', {
      path,
      errcode: data.errcode,
      errmsg: data.errmsg,
      ...(isWritePath(path) ? { optionColumns: optionColumnsOf(body) } : {}),
    });
    throw new Error(`企微智能表格 API 错误: ${data.errmsg ?? data.errcode}`);
  }
  return data;
}

function platformKeyOf(mapping: FieldMappingValue): string {
  return typeof mapping === 'string' ? mapping : mapping.name;
}

/** 选项 / 多选字段的写入形状：只有 text，没有服务端的选项 id */
export interface WecomOption {
  text: string;
}

/**
 * 该列是否按「选项」写入。
 *
 * 单选与多选在 add_records 里都要 `[{id,text}]`，我们没有服务端返回的选项 id，
 * 只给 text。判据是 fieldMapping 的显式声明（multiSelect，或 plain 带 options）
 * —— 从值本身分辨不出「一个字符串」是文本还是单选。
 */
function isOptionField(mapping: FieldMappingValue | undefined): boolean {
  if (!mapping || typeof mapping === 'string') return false;
  if (mapping.type === 'multiSelect') return true;
  return mapping.type === 'plain' && (mapping.options?.length ?? 0) > 0;
}

/**
 * 逻辑值 → 企微 `values` 里的一个 value。
 *
 * 形状按官方 add_records 文档（path/101240，与本机 wecom-cli 的
 * smart-sheet-record-values 参考一致）：
 * - 文本 / 电话 / 邮箱 / 条码：**裸字符串**
 * - 数字 / 货币 / 百分比 / 进度：**裸 double**
 * - 复选框：**裸布尔**
 * - 日期：**字符串** `"YYYY-MM-DD HH:mm:ss"`
 * - 单选 / 多选：`[{id, text}]`，只有 text 时写 `[{text}]`
 *
 * 以前这里写的是自造的类型化数组 `[{type:'text',text}]` —— 那是**读**
 * 回来的形状，写进去平台并不认，数字列会被当文本、日期列直接写不进去。
 */
export function toWecomValue(
  value: unknown,
  mapping?: FieldMappingValue,
): unknown {
  const displayType = displayTypeOf(mapping);
  // 清空一列：选项列要给空数组，其它列给空串 —— 给错形状平台会报参数错误
  if (value === null || value === undefined || value === '') {
    return isOptionField(mapping) ? [] : '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  // 数组一律按多选写：元素只有 text，没有选项 id
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map((v): WecomOption => ({ text: String(v) }));
  }

  // 选项判定必须排在日期之前：声明了 options 的列即使值长得像 'YYYY-MM-DD'
  // （比如选项就是几个日期档位），也得按 [{text}] 写 —— 写成日期串平台会
  // 报参数错误。反过来日期列不会声明 options，这个顺序没有副作用。
  //
  // TODO(企微选项 id)：官方 add_records 契约要求 `[{id,text}]`，我们只给
  // text。实测大多数表能按 text 匹配到既有选项，但**新选项 / 同名选项**上
  // 平台可能直接拒绝或落成空值，且错误码不指名列（诊断信息见 wecomApi 的
  // optionColumns 日志）。后续方案：`spreadsheets/fields.ts` 的 digOptions
  // 已经从平台拉到过完整选项，把 `{id,text}` 一并落进 fieldMapping.options，
  // 这里再按 text 反查 id 写全形状。
  if (isOptionField(mapping)) return [{ text: String(value) } as WecomOption];

  // 日期统一为 CST 当天 00:00（见 field-types.ts 里为什么是 00:00），
  // 所以时间部分恒为 00:00:00；声明为 number/text 的列不做这层转换
  if (dateStringToMs(value, displayType) !== null) {
    return `${value} 00:00:00`;
  }

  return String(value);
}

/** 逻辑字段 → 企微 values（key 是平台字段名称，value 随字段类型） */
export function mapValuesForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    // 与飞书侧一致：跳过 null/undefined，避免 LLM 幻觉字段静默清空数据
    if (value === null || value === undefined) continue;
    const mapping = config.fieldMapping[logicalKey];
    const platformKey = platformKeyOf(mapping ?? logicalKey);
    out[platformKey] = toWecomValue(value, mapping);
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
  for (const [platformKey, cell] of Object.entries(values)) {
    // 读侧形状比写侧杂得多（裸值 / [{text}] / [{id,text}] / [{userName}] /
    // 早期写入的 [{type,text}]），统一交给 normalize.ts 收口
    mapped[reverse[platformKey] ?? platformKey] = normalizeCell(cell);
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
