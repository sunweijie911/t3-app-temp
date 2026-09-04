import type { FieldMappingValue } from './types';

/**
 * 字段渲染 / 脱敏原语。
 *
 * 从 scenes/db-scene.ts 提取到 core，因为面向用户的输出不止场景回复一处：
 * dispatcher 在 UPDATE 多条命中、DELETE 二次确认时也要把记录摆到群里，
 * 那条路径以前直接 JSON.stringify(fields) 输出，绕过了这里的脱敏与截断。
 */

const DATE_MS_MIN = 946684800000; // 2000-01-01
const DATE_MS_MAX = 4102444800000; // 2100-01-01

/** 单字段展示上限，避免长文本撑爆群消息 */
export const FIELD_DISPLAY_MAX_LEN = 200;
/** 单条群消息总长上限（飞书文本约 30K，留足余量） */
export const REPLY_TOTAL_MAX_LEN = 20_000;

/**
 * 字段名启发式：含"密码/密钥/秘钥/password/secret/token/api_key/凭证/敏感"
 * 等关键字时，输出前自动脱敏。即使 admin 忘了勾 sensitive，
 * 也不会因为字段名一眼可疑却明文泄漏到群里。
 */
export const SENSITIVE_KEY_PATTERN =
  /密码|密钥|秘钥|password|passwd|secret|token|api[_-]?key|凭证|敏感/i;

export const MASKED_PLACEHOLDER = '***（已脱敏）';

/**
 * @param forced fieldMapping 里显式 `sensitive: true` 的字段。
 *   以前只跑字段名正则，导致 admin 勾选了「手机号」这类不含敏感关键字的字段
 *   仍被明文发到群里 —— UI tooltip 承诺的脱敏形同虚设。
 */
export function maskSensitive(
  key: string,
  value: string,
  forced?: boolean,
): string {
  if (!value) return value;
  if (forced || SENSITIVE_KEY_PATTERN.test(key)) return MASKED_PLACEHOLDER;
  return value;
}

/** 群消息总长兜底截断 */
export function clampReply(s: string): string {
  if (s.length <= REPLY_TOTAL_MAX_LEN) return s;
  return `${s.slice(0, REPLY_TOTAL_MAX_LEN)}\n\n…（消息过长已截断，详见多维表）`;
}

const TRUNCATED_SUFFIX = '\n…（消息过长已截断）';

/** 单个码点的 UTF-8 字节数 */
function utf8Len(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** 字符串的 UTF-8 字节长度（平台的长度限制都是按字节算的） */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (const ch of s) n += utf8Len(ch.codePointAt(0) ?? 0);
  return n;
}

/**
 * 按 **UTF-8 字节数** 截断到平台上限。
 *
 * clampReply 按字符算、且只有一个面向飞书的全局阈值，但
 * - 平台的文本长度限制都是按字节计的，一个汉字占 3 字节
 * - 企微 / 钉钉的上限比飞书小一个量级
 * 超限时平台只返回业务错误码，reply() 里仅 console.error，
 * 用户是**一条回复都收不到**。所以最终发送前必须按各自上限再截一次。
 *
 * 按码点迭代，不会把多字节序列或代理对从中间切开。
 */
export function clampReplyBytes(s: string, maxBytes: number): string {
  if (utf8ByteLength(s) <= maxBytes) return s;

  const suffixBytes = utf8ByteLength(TRUNCATED_SUFFIX);
  // 上限小到放不下提示语时只做硬截断，否则加了后缀反而更长
  const budget = maxBytes - suffixBytes;
  const withSuffix = budget > 0;
  const limit = withSuffix ? budget : maxBytes;

  let used = 0;
  let out = '';
  for (const ch of s) {
    const n = utf8Len(ch.codePointAt(0) ?? 0);
    if (used + n > limit) break;
    out += ch;
    used += n;
  }
  return withSuffix ? out + TRUNCATED_SUFFIX : out;
}

/**
 * 回复字节预算的兜底值。
 *
 * 只在调用方拿不到 adapter 时使用（老调用方、测试替身）。取飞书的量级 ——
 * 三个平台里最宽松的那个，等于「不按预算裁」，与加预算之前的行为一致。
 */
export const DEFAULT_REPLY_BUDGET_BYTES = 30_000;

/**
 * 在字节预算内最多能完整放下几条。
 *
 * 为什么需要：`ChannelAdapter.maxReplyBytes` 把平台差异声明得很清楚
 * （飞书 30000 / 钉钉 20000 / **企微 2048**），但展示条数一直是全平台
 * 共用的常量（QUERY 10 条、投影 20 条、分组 20 组），按飞书的量级定的。
 * 企微上一条 6 字段的中文记录约 250 字节，10 条就 ~2500 字节 —— 超了之后
 * clampReplyBytes 会从**某条记录的中间**截断，用户看到半行乱码。
 * 与其事后砍，不如先按预算决定放几条，再明说"共 N 条，仅展示前 M 条"。
 *
 * @param overheadBytes 标题、警告、序号等非条目文本预留的字节
 * @returns 能放下的条数；**至少 1**（单条就超预算时交给 clampReplyBytes 截，
 *   总比回一句"共 8 条，仅展示前 0 条"强）
 */
export function fitCountByBytes(
  items: string[],
  budgetBytes: number,
  overheadBytes = 0,
): number {
  let used = overheadBytes;
  let count = 0;
  for (const item of items) {
    // +1 是条目之间的换行
    used += utf8ByteLength(item) + 1;
    if (used > budgetBytes) break;
    count++;
  }
  return Math.max(1, count);
}

/** 单字段展示截断，仅用于面向用户的最终输出，不影响内部值传递 */
export function truncateForDisplay(s: string): string {
  if (s.length <= FIELD_DISPLAY_MAX_LEN) return s;
  return `${s.slice(0, FIELD_DISPLAY_MAX_LEN)}…（已截断，共 ${s.length} 字，详见多维表）`;
}

export type DisplayType = 'number' | 'date' | 'text';

/**
 * 去掉 IEEE754 运算残留：26.612000000000023 → 26.612。
 *
 * 公式字段（利润、利润率）算出来的钱经常带一串 ...0000023，直接 String()
 * 丢进群里很难看。用 12 位有效数字收敛，不改变字段真实精度
 * ——按字段的显示格式（飞书 property.formatter）取小数位是另一件事。
 */
function trimFloatNoise(v: number): string {
  if (!Number.isFinite(v) || Number.isInteger(v)) return String(v);
  return String(Number.parseFloat(v.toPrecision(12)));
}

function formatDateMs(v: number): string {
  return new Date(v).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 把平台返回的复杂字段值转为字符串，不做截断。
 * displayType:
 * - 'number' / 'text'：原样输出（避免金额/版本号/文本被误格式化为日期）
 * - 'date'：数字始终格式化为日期
 * - 未指定：保留旧启发式（毫秒值落在 2000~2100 年区间时按日期渲染）
 */
export function fieldToStringRaw(
  v: unknown,
  displayType?: DisplayType,
): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (displayType === 'number' || displayType === 'text') {
      return trimFloatNoise(v);
    }
    if (displayType === 'date') return formatDateMs(v);
    if (v >= DATE_MS_MIN && v <= DATE_MS_MAX) return formatDateMs(v);
    return trimFloatNoise(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item != null && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.name === 'string') return obj.name;
          return fieldToStringRaw(item, displayType);
        }
        return String(item);
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if ('value' in obj && Array.isArray(obj.value)) {
      return fieldToStringRaw(obj.value, displayType);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

export function fieldToString(v: unknown, displayType?: DisplayType): string {
  return truncateForDisplay(fieldToStringRaw(v, displayType));
}

/** 从 fieldMapping 取该逻辑字段的展示元信息 */
export function fieldMeta(
  key: string,
  fieldMapping?: Record<string, FieldMappingValue>,
): { label: string; sensitive: boolean; displayType?: DisplayType } {
  const m = fieldMapping?.[key];
  if (typeof m !== 'object') return { label: key, sensitive: false };
  return {
    label: m.label || key,
    sensitive: m.sensitive === true,
    displayType: m.type === 'plain' ? m.displayType : undefined,
  };
}

/**
 * 单字段渲染入口：综合 fieldMapping 中的 label（用户友好名）、sensitive（脱敏）
 * 和 displayType（数字/日期渲染策略），返回展示用的 label 和 value。
 */
export function renderFieldEntry(
  key: string,
  value: unknown,
  fieldMapping?: Record<string, FieldMappingValue>,
): { label: string; display: string } {
  const { label, sensitive, displayType } = fieldMeta(key, fieldMapping);
  return {
    label,
    display: maskSensitive(key, fieldToString(value, displayType), sensitive),
  };
}

/** 取显式声明为主标识的逻辑字段名 */
export function primaryKeyOf(
  fieldMapping?: Record<string, FieldMappingValue>,
): string | undefined {
  if (!fieldMapping) return undefined;
  for (const [key, m] of Object.entries(fieldMapping)) {
    if (typeof m === 'object' && m.primary === true) return key;
  }
  return undefined;
}

/**
 * 把一条记录压成单行摘要，供候选列表（UPDATE 多条命中 / DELETE 确认）使用。
 * 走完整的脱敏 + 单字段截断，并限制字段个数，避免一行刷屏。
 *
 * 主标识排在最前。**不能靠 fieldMapping 的键顺序**——它存在 jsonb 里，
 * Postgres 按「键长度 + 字节序」重排，"第一列是名称类"的假设根本不成立：
 * 实测一张财务表的摘要变成「利润=-108 / 备注=… / 日期=… / 月份=1月」，
 * 删除确认时用户看不到商品名称，判断不出要删哪条。
 */
export function renderRecordSummary(
  fields: Record<string, unknown>,
  fieldMapping?: Record<string, FieldMappingValue>,
  maxFields = 4,
): string {
  const configured = fieldMapping
    ? Object.keys(fieldMapping).filter((k) => k in fields)
    : Object.keys(fields);
  const extra = Object.keys(fields).filter((k) => !configured.includes(k));
  const primary = primaryKeyOf(fieldMapping);
  const rest = [...configured, ...extra].filter((k) => k !== primary);
  const keys = primary && primary in fields ? [primary, ...rest] : rest;
  const parts = keys
    .map((k) => renderFieldEntry(k, fields[k], fieldMapping))
    .filter((e) => e.display !== '')
    .slice(0, maxFields)
    .map((e) => `${e.label}=${e.display}`);
  return parts.length > 0 ? parts.join(' / ') : '（全部字段为空）';
}
