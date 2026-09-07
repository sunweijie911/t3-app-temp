// cspell:ignore notable
import { dingtalkTokenManager } from '../auth/dingtalk-token';
import type { DisplayType } from '../core/field-render';
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
 * 钉钉多维表（AI 表格 / notable）Adapter。
 *
 * 与飞书 Bitable 的差异：
 * 1. 定位用 baseId + sheetId 两级；workspaceId 当 baseId、tableId 当 sheetId。
 * 2. 鉴权走 header `x-acs-dingtalk-access-token`，不是 Bearer。
 * 3. 单元格值是裸值（不像企微的类型化数组），但日期要毫秒时间戳。
 * 4. 查询没有等价于飞书 search 的服务端 filter，先拉取再在内存过滤。
 */

const API_BASE = 'https://api.dingtalk.com/v2.0/notable/bases';
/** 单页拉取条数。保持 1000 不变 —— 首个请求与改动前完全一致，不引入回归 */
const PAGE_SIZE = 1000;
/** 续拉页数上限，防止超大表把内存和时延拖垮 */
const MAX_PAGES = 5;

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
 * （CST 当天 00:00，与飞书/企微侧共用 field-types.ts 的换算）。
 * 声明为 number/text 的列不做转换 —— 见 field-types.ts。
 */
export function toDingtalkValue(
  value: unknown,
  displayType?: DisplayType,
): unknown {
  return dateStringToMs(value, displayType) ?? value;
}

export function mapFieldsForWrite(
  fields: Record<string, unknown>,
  config: SpreadsheetTableConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    // 与其它 adapter 一致：跳过 null/undefined，避免 LLM 幻觉字段静默清空数据
    if (value === null || value === undefined) continue;
    const mapping = config.fieldMapping[logicalKey];
    const platformKey = platformKeyOf(mapping ?? logicalKey);
    out[platformKey] = toDingtalkValue(value, displayTypeOf(mapping));
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
    // 三个平台的读路径统一在这里归一化，下游不再各猜一次形状
    mapped[reverse[platformKey] ?? platformKey] = normalizeCell(value);
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

/**
 * 删除响应里可能承载「删掉了哪些」的键，按常见程度排。
 * 钉钉多维表这条接口的响应形状**没有公开文档**，只能宽容探测。
 */
const DELETE_ID_LIST_KEYS = [
  'ids',
  'recordIds',
  'record_ids',
  'deletedIds',
  'successIds',
  'records',
  'result',
  'value',
] as const;
/** 同上，承载「删掉了几条」的键 */
const DELETE_COUNT_KEYS = [
  'count',
  'deletedCount',
  'deleted_count',
  'successCount',
  'deleted',
  'successNum',
] as const;

/**
 * 从删除响应里判断到底删掉了没有。
 *
 * - `'deleted'` 有肯定信号（非空 id 列表，或计数 > 0）
 * - `'none'`    有否定信号（空列表，或计数为 0）
 * - `'unknown'` 认不出这个响应的形状
 *
 * 为什么要分出 `'none'`：删除接口的请求参数名无法离线核实（见
 * deleteRecord 的 TODO），而**参数名不对时钉钉返回的是 200 + 0 条删除，
 * 不会报错** —— 于是 dispatcher 收到一片 fulfilled，回一句「✅ 已删除 3
 * 条」，审计日志记 success，而表里一条没少。破坏性操作里「谎报成功」
 * 比「报错让人重试」危险得多，所以只要能**确定**是 0 条就必须抛错。
 *
 * 为什么保留 `'unknown'` 而不是一并抛错：那会让一个响应体为 `{}` 的
 * 正常成功也变成失败，把「可能没删掉」升级成「一定删不掉」。
 * 认不出时放行 + 打一条日志，与改动前行为一致。
 */
export function readDingtalkDeleteOutcome(
  data: Record<string, unknown>,
): 'deleted' | 'none' | 'unknown' {
  for (const key of DELETE_ID_LIST_KEYS) {
    const v = data[key];
    if (Array.isArray(v)) return v.length > 0 ? 'deleted' : 'none';
    // 布尔要在这里就认掉，不能只在函数末尾单查 data.result：
    // `{"deleted": false}` 是一个**明确的否定信号**，而它既不是数组、
    // 也过不了下面的 typeof number，会一路掉到 'unknown' 被当成成功放行
    // —— 正好是这个函数要防的那件事。
    if (typeof v === 'boolean') return v ? 'deleted' : 'none';
  }
  for (const key of DELETE_COUNT_KEYS) {
    const v = data[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v > 0 ? 'deleted' : 'none';
    }
    if (typeof v === 'boolean') return v ? 'deleted' : 'none';
  }
  return 'unknown';
}

/**
 * 已经报过的「认不出的响应形状」。
 *
 * 删除是并发跑的（DESTRUCTIVE_CONCURRENCY），每条都打会把日志刷满，
 * 所以要去重；但去重的粒度是**响应的键集合**而不是一个全局布尔 ——
 * 用布尔的话，第一种没认出的形状会把之后**所有**其它形状一起吞掉，
 * 而这行日志唯一的用途就是让人照着补 DELETE_*_KEYS。
 */
const warnedDeleteShapes = new Set<string>();
/** 键集合再多也不该无限涨（真实形状就那么几种，涨说明响应里带了随机键） */
const WARNED_SHAPES_MAX = 20;

/** 仅供单测隔离用例之间的状态 */
export function __resetDingtalkDeleteWarning(): void {
  warnedDeleteShapes.clear();
}

export class DingtalkSheetAdapter implements SpreadsheetAdapter {
  readonly platform = 'dingtalk' as const;
  readonly queryHardLimit = PAGE_SIZE * MAX_PAGES;

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
    return (await this.queryRecordsWithMeta(config, filters)).records;
  }

  async queryRecordsWithMeta(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetQueryResult> {
    // 续拉：钉钉按 nextToken 游标翻页。以前只发一个请求，超过单页的记录
    // 被静默丢掉，再叠加内存过滤 —— 大表上表现为"查不到"而不是报错。
    //
    // 游标字段名按响应实际返回的探测（不同版本文档里出现过 nextToken /
    // next_token），拿不到就只取第一页 —— 与改动前行为完全一致，不会回归。
    const all: SpreadsheetRecord[] = [];
    const seen = new Set<string>();
    let nextToken: string | undefined;
    // 截断必须在这里判断：过滤发生在拉取之后，用过滤后的条数与
    // queryHardLimit 比较永远不成立（拉满 5000 行、过滤后剩 1 条）
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `maxResults=${PAGE_SIZE}${
        nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ''
      }`;
      const data = await dingtalkApi(
        `/${config.workspaceId}/sheets/${config.tableId}/records?${query}`,
        'GET',
      );
      const rows = (data.records as DingtalkRecord[] | undefined) ?? [];
      let fresh = 0;
      for (const r of rows) {
        const recordId = readRecordId(r);
        // 游标不被支持时下一页会原样回第一页，靠 id 去重挡住重复计数
        if (recordId && seen.has(recordId)) continue;
        if (recordId) seen.add(recordId);
        fresh++;
        all.push({
          recordId,
          fields: mapFieldsFromRead(r.fields ?? {}, config.fieldMapping),
        });
      }

      nextToken =
        typeof data.nextToken === 'string'
          ? data.nextToken
          : typeof data.next_token === 'string'
            ? data.next_token
            : undefined;
      // 游标分页以 nextToken 为准：钉钉可能返回不足 maxResults 的一页却仍有后续，
      // 用"短页即止"会漏数据（那是 offset 分页才成立的启发式）。
      // fresh === 0 兜住"游标不被支持、下一页原样回第一页"的情形。
      if (!nextToken || fresh === 0) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    return { records: filterRecords(all, filters), truncated };
  }

  async deleteRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
  ): Promise<void> {
    // TODO(真机验证)：body 的参数名疑为 `recordIds` 而非 `ids`。
    // 钉钉多维表的接口形状**无法离线核实**（官方文档未公开这一条），
    // 现在这个形状是按早期实现沿用的。删除失败时优先查这里。
    //
    // 参数名不对时钉钉返回的是 200 + 0 条删除、**不报错**，所以不能只看
    // HTTP 状态码就当成功 —— 那样 dispatcher 会回「✅ 已删除 N 条」，
    // 而表里一条没少。下面据响应判定，能确定是 0 条时抛错。
    const data = await dingtalkApi(
      `/${config.workspaceId}/sheets/${config.tableId}/records/delete`,
      'POST',
      { ids: [recordId] },
    );

    const outcome = readDingtalkDeleteOutcome(data);
    if (outcome === 'none') {
      throw new Error(
        `钉钉多维表未删除任何记录（recordId=${recordId}）。` +
          '常见原因是删除接口的请求参数名不是 `ids`（疑为 `recordIds`），' +
          '请核对钉钉多维表的接口契约后修正 dingtalk-sheet.ts',
      );
    }
    if (outcome === 'unknown') {
      const shape = Object.keys(data).sort().join(',') || '(空响应)';
      if (
        !warnedDeleteShapes.has(shape) &&
        warnedDeleteShapes.size < WARNED_SHAPES_MAX
      ) {
        warnedDeleteShapes.add(shape);
        console.warn(
          '[DingtalkSheet] 删除响应里没有可识别的成功信号（键：',
          shape,
          '），无法确认记录是否真的被删除。请对照真机响应补充 DELETE_ID_LIST_KEYS / DELETE_COUNT_KEYS',
        );
      }
    }
  }
}
