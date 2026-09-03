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

/** 单字段展示截断，仅用于面向用户的最终输出，不影响内部值传递 */
export function truncateForDisplay(s: string): string {
  if (s.length <= FIELD_DISPLAY_MAX_LEN) return s;
  return `${s.slice(0, FIELD_DISPLAY_MAX_LEN)}…（已截断，共 ${s.length} 字，详见多维表）`;
}

export type DisplayType = 'number' | 'date';

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
 * - 'number'：数字原样输出（避免金额/版本号被误格式化为日期）
 * - 'date'：数字始终格式化为日期
 * - 未指定：保留旧启发式（毫秒值落在 2000~2100 年区间时按日期渲染）
 */
export function fieldToStringRaw(
  v: unknown,
  displayType?: DisplayType,
): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (displayType === 'number') return String(v);
    if (displayType === 'date') return formatDateMs(v);
    if (v >= DATE_MS_MIN && v <= DATE_MS_MAX) return formatDateMs(v);
    return String(v);
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

/**
 * 把一条记录压成单行摘要，供候选列表（UPDATE 多条命中 / DELETE 确认）使用。
 * 走完整的脱敏 + 单字段截断，并限制字段个数，避免一行刷屏。
 */
export function renderRecordSummary(
  fields: Record<string, unknown>,
  fieldMapping?: Record<string, FieldMappingValue>,
  maxFields = 4,
): string {
  // 有 fieldMapping 时按配置顺序取（第一列通常是名称类主标识），否则按记录自身顺序
  const keys = fieldMapping
    ? Object.keys(fieldMapping).filter((k) => k in fields)
    : Object.keys(fields);
  const extra = Object.keys(fields).filter((k) => !keys.includes(k));
  const parts = [...keys, ...extra]
    .map((k) => renderFieldEntry(k, fields[k], fieldMapping))
    .filter((e) => e.display !== '')
    .slice(0, maxFields)
    .map((e) => `${e.label}=${e.display}`);
  return parts.length > 0 ? parts.join(' / ') : '（全部字段为空）';
}
