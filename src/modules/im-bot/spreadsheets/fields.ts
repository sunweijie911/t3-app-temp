// cspell:ignore singlelink duplexlink multiselect multipleselect
// cspell:ignore datetime createdtime modifiedtime createtime updatetime autonumber
import { dingtalkTokenManager } from '../auth/dingtalk-token';
import { feishuTokenManager } from '../auth/feishu-token';
import { wecomTokenManager } from '../auth/wecom-token';
import type { BotPlatform } from '../constants';
import type { DisplayType } from '../core/field-render';

/**
 * 「读取一张表当前的真实列」这件事的 provider 无关层。
 *
 * 为什么必须抽出来：字段选择器和字段漂移检测以前都硬绑飞书 API，后台按钮
 * 也写死 `disabled={provider !== 'feishu'}`。而 upsertResourceBinding 又强制
 * 表格绑定必须恰好有一个 `primary: true` —— 于是钉钉/企微的绑定只能手写
 * fieldMapping JSON，连平台列名都要人肉抄。最容易配错、也最有价值的两项
 * （单选合法取值 options、取值语义 displayType）恰好只有飞书能自动生成。
 * 运行时三平台早就对等了，配置面不该还是单平台的。
 */

/** 后台字段选择器消费的一列 */
export interface LiveTableField {
  fieldId: string;
  fieldName: string;
  /** 平台原始类型字符串，原样透传给后台展示，便于人工核对推断对不对 */
  uiType: string;
  suggestedType: 'plain' | 'link' | 'multiSelect';
  suggestedDisplayType: DisplayType;
  /** 单选 / 多选列的合法取值，注入 prompt 后 LLM 不会再自造 */
  options?: string[];
}

export interface TableFieldSource {
  readonly platform: BotPlatform;
  /** @param workspaceId 飞书 app_token / 钉钉 baseId / 企微 docid */
  listFields(
    workspaceId: string,
    resourceId: string,
  ): Promise<LiveTableField[]>;
}

// ── 共享的类型推断规则 ────────────────────────────────────────
//
// 三家的类型名不同，但「什么算日期、什么算数量」的判断必须一致 ——
// 否则同一份逻辑配置换个 provider 就推断出不同的 displayType，
// 而 displayType 直接决定值写进去是时间戳还是字符串（见 field-types.ts）。

/** 取选项名，过滤空值 */
function optionNames(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names = raw
    .map((o) => {
      if (typeof o === 'string') return o.trim();
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>;
        // 飞书 property.options[].name / 企微 .text / 钉钉 .name
        for (const key of ['name', 'text', 'value', 'label']) {
          const v = obj[key];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
      return '';
    })
    .filter((n): n is string => !!n);
  return names.length > 0 ? names : undefined;
}

/** 归一化平台类型名：去掉前缀/下划线并小写，`FIELD_TYPE_MULTI_SELECT` → `multiselect` */
function normalizeType(raw: string): string {
  return raw
    .replace(/^FIELD_TYPE_/i, '')
    .replace(/[_\-\s]/g, '')
    .toLowerCase();
}

const LINK_TYPES = new Set(['singlelink', 'duplexlink', 'link', 'reference']);
const MULTI_SELECT_TYPES = new Set(['multiselect', 'multipleselect']);
const DATE_TYPES = new Set([
  'datetime',
  'date',
  'createdtime',
  'modifiedtime',
  'createtime',
  'updatetime',
]);
const NUMBER_TYPES = new Set([
  'number',
  'currency',
  'progress',
  'rating',
  'autonumber',
  'percent',
]);

function suggestType(
  rawType: string,
  multiple?: boolean,
): 'plain' | 'link' | 'multiSelect' {
  const t = normalizeType(rawType);
  if (LINK_TYPES.has(t)) return 'link';
  if (MULTI_SELECT_TYPES.has(t) || multiple === true) return 'multiSelect';
  return 'plain';
}

function suggestDisplayType(rawType: string): DisplayType {
  const t = normalizeType(rawType);
  if (DATE_TYPES.has(t)) return 'date';
  if (NUMBER_TYPES.has(t)) return 'number';
  return 'text';
}

/**
 * 从一条平台字段记录里尽量把 options 挖出来。
 *
 * 三家把选项挂在不同层级（飞书 `property.options`、企微常见于
 * `property.select.options` / `select_option`、钉钉 `property.options`），
 * 而且各自的响应结构还随版本变过。这里做**宽容探测**而不是写死路径：
 * 挖不到就返回 undefined，退化成「没有合法取值清单」，不会让整次拉取失败。
 */
function digOptions(field: Record<string, unknown>): string[] | undefined {
  const property = field.property;
  const candidates: unknown[] = [property, field];
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const direct = optionNames(obj.options);
    if (direct) return direct;
    for (const nested of ['select', 'multiSelect', 'multi_select', 'choice']) {
      const child = obj[nested];
      if (child && typeof child === 'object') {
        const found = optionNames((child as Record<string, unknown>).options);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// ── 飞书 ──────────────────────────────────────────────────────

/** 单页字段数上限。翻页拉完，避免宽表（>100 列）静默丢字段 */
const FIELDS_PAGE_SIZE = 100;
/** 钉钉 / 企微字段接口的单页条数 */
const DINGTALK_FIELDS_PAGE_SIZE = 200;
const WECOM_FIELDS_PAGE_SIZE = 200;
const FIELDS_MAX_PAGES = 5;

class FeishuFieldSource implements TableFieldSource {
  readonly platform = 'feishu' as const;

  async listFields(
    workspaceId: string,
    resourceId: string,
  ): Promise<LiveTableField[]> {
    const token = await feishuTokenManager.getToken();
    const all: LiveTableField[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < FIELDS_MAX_PAGES; page++) {
      const query = `page_size=${FIELDS_PAGE_SIZE}${
        pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
      }`;
      const res = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${workspaceId}/tables/${resourceId}/fields?${query}`,
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
          items?: Array<Record<string, unknown>>;
          has_more?: boolean;
          page_token?: string;
        };
      };
      if (data.code !== 0) {
        throw new Error(`飞书 API 错误: ${data.msg ?? data.code}`);
      }
      for (const it of data.data?.items ?? []) {
        const uiType = String(it.ui_type ?? '');
        const property = (it.property ?? {}) as { multiple?: boolean };
        all.push({
          fieldId: String(it.field_id ?? ''),
          fieldName: String(it.field_name ?? ''),
          uiType,
          suggestedType: suggestType(uiType, property.multiple),
          suggestedDisplayType: suggestDisplayType(uiType),
          options: digOptions(it),
        });
      }
      if (!data.data?.has_more || !data.data.page_token) break;
      pageToken = data.data.page_token;
    }
    return all;
  }
}

// ── 钉钉多维表 ────────────────────────────────────────────────

class DingtalkFieldSource implements TableFieldSource {
  readonly platform = 'dingtalk' as const;

  async listFields(
    workspaceId: string,
    resourceId: string,
  ): Promise<LiveTableField[]> {
    const token = await dingtalkTokenManager.getToken();
    const all: LiveTableField[] = [];
    // 与飞书侧同理必须翻页：宽表不翻页会**静默丢列**，丢掉的列既进不了
    // fieldMapping，还会被漂移检测报成「平台上已经没有了」。
    // 钉钉用 nextToken 游标（与 dingtalk-sheet.ts 的记录翻页同一套）。
    let nextToken: string | undefined;
    const seen = new Set<string>();

    for (let page = 0; page < FIELDS_MAX_PAGES; page++) {
      const query = `maxResults=${DINGTALK_FIELDS_PAGE_SIZE}${
        nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ''
      }`;
      const res = await fetch(
        `https://api.dingtalk.com/v2.0/notable/bases/${workspaceId}/sheets/${resourceId}/fields?${query}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        throw new Error(
          `钉钉多维表 API 错误: ${String(data.message ?? res.statusText)}`,
        );
      }
      // 字段数组的键名在不同版本文档里出现过 fields / records / value，逐个探测。
      // 都拿不到就返回空数组 —— 漂移检测对"0 列"有专门的跳过分支，
      // 不会把它误报成"整表的列都被删了"
      const items = [data.fields, data.records, data.value].find((v) =>
        Array.isArray(v),
      ) as Array<Record<string, unknown>> | undefined;

      let fresh = 0;
      for (const f of items ?? []) {
        const rawType = String(f.type ?? f.fieldType ?? '');
        // 钉钉的列名键名同样出现过 name / fieldName / title
        const name = String(f.name ?? f.fieldName ?? f.title ?? '');
        const id = String(f.id ?? f.fieldId ?? name);
        // 游标不被支持时下一页会原样回第一页，靠 id 去重挡住重复
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        fresh++;
        all.push({
          fieldId: id,
          fieldName: name,
          uiType: rawType,
          suggestedType: suggestType(rawType),
          suggestedDisplayType: suggestDisplayType(rawType),
          options: digOptions(f),
        });
      }

      nextToken =
        typeof data.nextToken === 'string'
          ? data.nextToken
          : typeof data.next_token === 'string'
            ? data.next_token
            : undefined;
      if (!nextToken || fresh === 0) break;
    }
    return all;
  }
}

// ── 企微智能表格 ──────────────────────────────────────────────

class WecomFieldSource implements TableFieldSource {
  readonly platform = 'wecom' as const;

  async listFields(
    workspaceId: string,
    resourceId: string,
  ): Promise<LiveTableField[]> {
    const token = await wecomTokenManager.getToken();
    const all: LiveTableField[] = [];
    // 企微按 offset 翻页（与 wecom-sheet.ts 的记录翻页同一套）。
    // 不翻页 = 宽表静默丢列，见 DingtalkFieldSource 上的说明。
    const seen = new Set<string>();

    for (let page = 0; page < FIELDS_MAX_PAGES; page++) {
      const res = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/get_fields?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docid: workspaceId,
            sheet_id: resourceId,
            limit: WECOM_FIELDS_PAGE_SIZE,
            // 第一页不带 offset：请求体与不翻页时逐字节一致
            ...(page > 0 ? { offset: all.length } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        throw new Error(
          `企微智能表格 API HTTP 错误: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        fields?: Array<Record<string, unknown>>;
      };
      if (data.errcode && data.errcode !== 0) {
        throw new Error(
          `企微智能表格 API 错误: ${data.errmsg ?? data.errcode}`,
        );
      }

      const items = data.fields ?? [];
      let fresh = 0;
      for (const f of items) {
        const rawType = String(f.field_type ?? f.fieldType ?? f.type ?? '');
        const name = String(f.field_title ?? f.field_name ?? f.name ?? '');
        const id = String(f.field_id ?? f.fieldId ?? name);
        // offset 若不被支持，第二页会原样回第一页 —— 靠 id 去重识别出来
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        fresh++;
        all.push({
          fieldId: id,
          fieldName: name,
          uiType: rawType,
          suggestedType: suggestType(rawType),
          suggestedDisplayType: suggestDisplayType(rawType),
          options: digOptions(f),
        });
      }
      if (fresh === 0 || items.length < WECOM_FIELDS_PAGE_SIZE) break;
    }
    return all;
  }
}

const sources: Record<BotPlatform, TableFieldSource> = {
  feishu: new FeishuFieldSource(),
  dingtalk: new DingtalkFieldSource(),
  wecom: new WecomFieldSource(),
};

export function getTableFieldSource(platform: BotPlatform): TableFieldSource {
  return sources[platform];
}

/** 单测与漂移检测共用的推断入口 */
export const __testing = {
  normalizeType,
  suggestType,
  suggestDisplayType,
  digOptions,
  optionNames,
};
