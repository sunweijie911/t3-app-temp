import type { DisplayType } from '../core/field-render';
import type { FieldMappingValue } from '../core/types';

/**
 * 「逻辑值 → 平台单元格值」这一步的类型判定，三个 adapter 共用。
 *
 * 独立成文件是因为三家平台的日期写法各不相同（飞书裸毫秒、钉钉裸毫秒、
 * 企微类型化 date 单元格），但**判断这个值该不该按日期处理**的规则必须
 * 完全一致 —— 否则同一份 fieldMapping 换个 provider 就写出不同的数据。
 */

/**
 * 「YYYY-MM-DD」的判定与换算，整个 spreadsheets 目录**只有这一份**。
 *
 * 以前 field-types / record-filter / feishu-bitable 各写了一份同样的正则和
 * dayStartMs：三份要么一起改，要么就出现「飞书按 CST 零点比、内存过滤按
 * 另一个时刻比」这种同一条件两个答案的 bug。
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 是不是 YYYY-MM-DD 形态的日期串 */
export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** YYYY-MM-DD → 该日 **CST 零点** 的毫秒值 */
export function dayStartMs(s: string): number {
  return new Date(`${s}T00:00:00+08:00`).getTime();
}

/**
 * 带时间部分的日期时间串：`YYYY-MM-DD HH:mm[:ss]`（也容忍 ISO 的 `T` 分隔）。
 *
 * 这是**企微智能表格 date 字段读回来的形状**（官方 smart-sheet 记录值参考：
 * 写 `"2026-05-11 00:00:00"`，读也回同一个串），而飞书/钉钉的日期字段读回
 * 的是裸毫秒。三家形状不一致，下游只能按一种来比。
 */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/;

/** 是不是「带时间部分」的日期时间串（纯 YYYY-MM-DD 不算，用 isDateString） */
export function isDatetimeString(v: unknown): v is string {
  return typeof v === 'string' && DATETIME_RE.test(v);
}

/**
 * `YYYY-MM-DD` / `YYYY-MM-DD HH:mm[:ss]` → 毫秒值，按 **CST(+08:00)** 解析。
 *
 * 为什么要按 CST 而不是本机时区：容器一般跑 UTC，`new Date("2026-05-11
 * 00:00:00")` 会被当成 UTC 零点，与 dayStartMs 差 8 小时 —— 同一天的记录
 * 在「>= 2026-05-11」上给出两个不同的答案。
 *
 * 不是这两种形态时返回 null，调用方原样保留。
 */
export function datetimeStringToMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(v);
  const day = m?.[1];
  if (!day) return null;
  const time = m[2];
  if (!time) return dayStartMs(day);
  // 秒可省略；补齐后交给 Date 按 +08:00 解析
  const ms = new Date(
    `${day}T${time.length === 5 ? `${time}:00` : time}+08:00`,
  ).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** 取 plain 映射声明的 displayType；link / multiSelect 没有这个概念 */
export function displayTypeOf(
  mapping: FieldMappingValue | undefined,
): DisplayType | undefined {
  if (!mapping || typeof mapping === 'string') return undefined;
  return mapping.type === 'plain' ? mapping.displayType : undefined;
}

/**
 * 该列的值是否按日期解释。
 *
 * 声明过 'number' / 'text' 的列不是日期列 —— 值里出现的 YYYY-MM-DD
 * 就是它本来的内容。未声明时保留旧启发式（按日期处理），否则历史上
 * 用裸字符串映射的日期列会在升级瞬间全部写不进去。
 */
export function treatsValueAsDate(displayType?: DisplayType): boolean {
  return displayType !== 'number' && displayType !== 'text';
}

/**
 * YYYY-MM-DD → **CST 当天 00:00** 的毫秒值。
 *
 * 不是日期字符串、或该列声明为 number/text 时返回 null，调用方原样写入。
 * 三个 adapter 共用：文本列里合法的 "2026-05-11" 不能被写成时间戳。
 *
 * 为什么是 00:00 而不是 12:00：日期字段的筛选语义**只对一种时刻约定成立**。
 * 飞书 filter 的 ExactDate 值会被按日截断、记录侧用真实毫秒比较（见
 * feishu-bitable.ts 顶部的实测），于是 `>` `>=` `<` `<=` 的边界必须跟记录
 * 的时刻对齐：
 * - 平台自己（日期选择器、手工录入、导入）写的就是当天 00:00
 * - 机器人以前写 12:00，同一张表混进两种时刻后，同一个 `>= 某天`
 *   对两批行给出差一天的结果
 * 统一到 00:00 = 跟平台一致，也让整套边界精确。
 * 代价是非 CST 时区的客户端会把这一天渲染成前一天 16:00 —— 但表里
 * 原有数据本来就是这个性质，一致性比这个假设更重要。
 */
export function dateStringToMs(
  value: unknown,
  displayType?: DisplayType,
): number | null {
  if (!treatsValueAsDate(displayType)) return null;
  if (isDateString(value)) return dayStartMs(value);
  return null;
}
