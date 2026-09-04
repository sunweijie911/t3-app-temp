// cspell:ignore isanyof anyof oneof
import type { SpreadsheetRecord } from '../core/types';

/**
 * 客户端侧记录过滤。
 *
 * 企微 get_records 与钉钉多维表 records 都没有等价于飞书 search 的服务端
 * filter，所以先拉取再在内存过滤。语义与飞书侧保持一致（含 `_conjunction`
 * 协议与**日粒度日期比较**），代价是大表查询会多传数据 ——
 * 等确认各自的服务端 filter 参数后可下推。
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateStr(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** YYYY-MM-DD → 该日 CST 零点的毫秒值 */
function dayStartMs(s: string): number {
  return new Date(`${s}T00:00:00+08:00`).getTime();
}

/** 毫秒值 → 它在 CST 下所属自然日的 YYYY-MM-DD */
function cstDayOf(ms: number): string {
  return new Date(ms + CST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 把记录侧的值转成可比较的毫秒值。
 * 平台读回的日期字段是毫秒数（企微 date 单元格、钉钉裸值都是），
 * 但也兼容配置成文本列的 'YYYY-MM-DD'。
 */
function actualMs(actual: unknown): number | null {
  if (typeof actual === 'number' && Number.isFinite(actual)) return actual;
  if (isDateStr(actual)) return dayStartMs(actual);
  return null;
}

/**
 * 日期比较。
 *
 * 与飞书 adapter 的 ExactDate 边界一一对应：筛选值是「整天」，
 * 记录侧是真实时刻（机器人写入统一落在当天 00:00，见 field-types.ts；
 * 平台自己写的也是零点），所以 `> 当天` 必须从次日零点算起，
 * `<= 当天` 要取到次日零点前。这套边界对零点记录精确成立。
 *
 * 这层以前没有：filterRecords 直接 `String(1778...000) === '2026-05-11'`，
 * 于是钉钉/企微上**任何按日期的查询都恒返回 0 条** —— 静默给错答案。
 *
 * @returns null 表示两侧不构成日期比较，交回普通比较分支
 */
function compareAsDate(
  actual: unknown,
  expected: unknown,
  op: string,
): boolean | null {
  if (!isDateStr(expected)) return null;
  const ms = actualMs(actual);
  if (ms === null) return null;

  const start = dayStartMs(expected);
  const end = start + ONE_DAY_MS;
  switch (op) {
    case '>':
      return ms >= end;
    case '>=':
      return ms >= start;
    case '<':
      return ms < start;
    case '<=':
      return ms < end;
    case '!=':
      return cstDayOf(ms) !== expected;
    default:
      return cstDayOf(ms) === expected;
  }
}

/** between：闭区间「起始日 00:00 ~ 结束日 23:59:59.999」，与飞书侧一致 */
function matchBetween(actual: unknown, value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [rawStart, rawEnd] = value as [unknown, unknown];
  const ms = actualMs(actual);
  if (ms === null) {
    // 非日期字段的 between 退化为数值区间
    const n = Number(actual);
    if (Number.isNaN(n)) return false;
    return n >= Number(rawStart) && n <= Number(rawEnd);
  }
  const lower = isDateStr(rawStart) ? dayStartMs(rawStart) : Number(rawStart);
  const upper = isDateStr(rawEnd)
    ? dayStartMs(rawEnd) + ONE_DAY_MS
    : Number(rawEnd) + 1;
  return ms >= lower && ms < upper;
}

/**
 * 单值等值判定：先按日期语义比，再退回字符串比。
 *
 * 记录侧是多值单元格（多选 / 关联）时按**成员命中**判定，而不是把整格
 * 拼成 `'门户 督导'` 去做等值比较 —— 后者让多选格永远匹配不上任何单值，
 * 而飞书侧对多选字段走的是 contains。两边必须给出同样的答案。
 */
function matchesValue(actual: unknown, expected: unknown): boolean {
  const byDate = compareAsDate(actual, expected, '=');
  if (byDate !== null) return byDate;
  const exp = String(expected ?? '');
  if (Array.isArray(actual)) {
    return actual.some((member) => String(member ?? '') === exp);
  }
  return String(actual ?? '') === exp;
}

/**
 * 「命中任一」：筛选值是数组时逐元素比，标量时退化为单值比较。
 *
 * 与飞书侧的 ANY_OF_OPS 展开一一对应。少了这层，`{op:'in',value:[...]}`
 * 会落到等值分支拿 `String(['待发货','已发货'])` 去比，
 * 恒不命中 —— 钉钉/企微上表现为静默 0 条（飞书那边则是 InvalidFilter）。
 */
function matchesAny(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((one) => matchesValue(actual, one));
  }
  return matchesValue(actual, expected);
}

export function filterRecords(
  records: SpreadsheetRecord[],
  filters: Record<string, unknown>,
): SpreadsheetRecord[] {
  const keys = Object.keys(filters).filter((k) => !k.startsWith('_'));
  if (keys.length === 0) return records;
  const useOr = filters._conjunction === 'or';

  const matchOne = (r: SpreadsheetRecord, key: string): boolean => {
    const expected = filters[key];
    const actual = r.fields[key];
    const actualStr = Array.isArray(actual)
      ? actual.map(String).join(' ')
      : String(actual ?? '');
    // 数组筛选值 = 「命中任一」，且必须判在 object 分支**之前**：
    // `typeof [] === 'object'` 为真，走进 { op, value } 分支后两者都解构成
    // undefined，于是 default 分支拿 v='' 做等值比较 —— 任何数组筛选都
    // 静默退化成「该字段为空」。实测 {业务域:['门户','督导']} 只命中
    // 业务域为空的那条记录，而飞书侧对同一份 LLM 输出给的是另一个错答案。
    if (Array.isArray(expected)) {
      return matchesAny(actual, expected);
    }
    if (expected !== null && typeof expected === 'object') {
      const { op, value } = expected as { op?: string; value?: unknown };
      const opKey = (op ?? '').toLowerCase();
      const v = String(value ?? '');
      switch (opKey) {
        case 'contains':
        case '~':
          return actualStr.includes(v);
        case 'isempty':
          return actualStr === '';
        case 'isnotempty':
          return actualStr !== '';
        case 'between':
          return matchBetween(actual, value);
        // 「命中任一」。LLM 会自发产出 op:'in'，即使 prompt 没教过它
        case 'in':
        case 'isanyof':
        case 'anyof':
        case 'oneof':
        case 'includes':
          return matchesAny(actual, value);
        case '!=':
        case 'isnot':
          return compareAsDate(actual, value, '!=') ?? actualStr !== v;
        case '>':
        case '>=':
        case '<':
        case '<=':
          return (
            compareAsDate(actual, value, opKey) ??
            compareNumeric(actual, value, opKey)
          );
        default:
          // 未知 op 退化为等值；值是数组时按「命中任一」，
          // 否则又会走回 String(数组) 那个静默给错答案的比较
          return matchesAny(actual, value);
      }
    }
    return matchesValue(actual, expected);
  };

  return records.filter((r) =>
    useOr
      ? keys.some((k) => matchOne(r, k))
      : keys.every((k) => matchOne(r, k)),
  );
}

function compareNumeric(actual: unknown, value: unknown, op: string): boolean {
  const a = Number(actual);
  const b = Number(value);
  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}
