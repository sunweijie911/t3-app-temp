import type { DisplayType } from '../core/field-render';
import type { FieldMappingValue } from '../core/types';

/**
 * 「逻辑值 → 平台单元格值」这一步的类型判定，三个 adapter 共用。
 *
 * 独立成文件是因为三家平台的日期写法各不相同（飞书裸毫秒、钉钉裸毫秒、
 * 企微类型化 date 单元格），但**判断这个值该不该按日期处理**的规则必须
 * 完全一致 —— 否则同一份 fieldMapping 换个 provider 就写出不同的数据。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * YYYY-MM-DD → CST 当天 12:00 的毫秒值（取 12:00 避免时区误差跨日）。
 *
 * 不是日期字符串、或该列声明为 number/text 时返回 null，调用方原样写入。
 * 以前三个 adapter 各自无条件转换：文本列里合法的 "2026-05-11" 会被
 * 写成 1778472000000，或者整条写入直接失败。
 */
export function dateStringToMs(
  value: unknown,
  displayType?: DisplayType,
): number | null {
  if (!treatsValueAsDate(displayType)) return null;
  if (typeof value === 'string' && DATE_RE.test(value)) {
    return new Date(`${value}T12:00:00+08:00`).getTime();
  }
  return null;
}
