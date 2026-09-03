import { describe, expect, it } from 'vitest';
import type {
  FieldMappingValue,
  SpreadsheetTableConfig,
} from '@/modules/im-bot/core/types';
import {
  fromWecomCells,
  mapValuesForWrite,
  mapValuesFromRead,
  toWecomCells,
} from '@/modules/im-bot/spreadsheets/wecom-sheet';

const makeConfig = (
  fieldMapping: Record<string, FieldMappingValue>,
): SpreadsheetTableConfig => ({
  platform: 'wecom',
  workspaceId: 'docid1',
  tableId: 'sheet1',
  fieldMapping,
});

describe('toWecomCells — 逻辑值 → 类型化单元格', () => {
  it('字符串 → text 单元格', () => {
    expect(toWecomCells('督导2.0')).toEqual([
      { type: 'text', text: '督导2.0' },
    ]);
  });

  it('数字 → number 单元格（不会被当成文本）', () => {
    expect(toWecomCells(99)).toEqual([{ type: 'number', number: 99 }]);
  });

  it('布尔 → checkbox 单元格', () => {
    expect(toWecomCells(true)).toEqual([{ type: 'checkbox', checkbox: true }]);
    expect(toWecomCells(false)).toEqual([
      { type: 'checkbox', checkbox: false },
    ]);
  });

  it('YYYY-MM-DD → date 单元格，取 CST 当天 12:00 避免跨日', () => {
    const cells = toWecomCells('2026-05-11');
    expect(cells).toHaveLength(1);
    const cell = cells[0] as { type: string; date: number };
    expect(cell.type).toBe('date');
    expect(new Date(cell.date).toISOString()).toBe('2026-05-11T04:00:00.000Z');
  });

  it('非 YYYY-MM-DD 的日期串仍当文本（与飞书侧行为一致）', () => {
    expect(toWecomCells('2026/05/11')).toEqual([
      { type: 'text', text: '2026/05/11' },
    ]);
  });

  it('数组 → 逐元素转（多选字段）', () => {
    expect(toWecomCells(['门户', '督导'])).toEqual([
      { type: 'text', text: '门户' },
      { type: 'text', text: '督导' },
    ]);
  });

  it('数组内混合类型分别按类型转', () => {
    expect(toWecomCells(['a', 1])).toEqual([
      { type: 'text', text: 'a' },
      { type: 'number', number: 1 },
    ]);
  });

  it('null / undefined / 空串 → 空数组', () => {
    expect(toWecomCells(null)).toEqual([]);
    expect(toWecomCells(undefined)).toEqual([]);
    expect(toWecomCells('')).toEqual([]);
  });

  it('数组里的空元素被过滤掉', () => {
    expect(toWecomCells(['a', '', null, 'b'])).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('数字 0 与 false 不被当成空值丢弃', () => {
    expect(toWecomCells(0)).toEqual([{ type: 'number', number: 0 }]);
    expect(toWecomCells(false)).toEqual([
      { type: 'checkbox', checkbox: false },
    ]);
  });
});

describe('fromWecomCells — 类型化单元格 → 可读值', () => {
  it('单个 text 单元格 → 字符串', () => {
    expect(fromWecomCells([{ type: 'text', text: 'v' }])).toBe('v');
  });

  it('单个 number 单元格 → 数字（保持类型，供 displayType 判断）', () => {
    expect(fromWecomCells([{ type: 'number', number: 42 }])).toBe(42);
  });

  it('checkbox → 布尔', () => {
    expect(fromWecomCells([{ type: 'checkbox', checkbox: true }])).toBe(true);
  });

  it('多个单元格 → 数组', () => {
    expect(
      fromWecomCells([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('空数组 → 空串（下游渲染会过滤掉）', () => {
    expect(fromWecomCells([])).toBe('');
  });

  it('人员/关联等复合类型退回取 name', () => {
    expect(fromWecomCells([{ type: 'user', name: '张三' }])).toBe('张三');
  });

  it('非数组输入原样返回，不炸', () => {
    expect(fromWecomCells('raw')).toBe('raw');
    expect(fromWecomCells(null)).toBe('');
  });
});

describe('mapValuesForWrite', () => {
  it('逻辑字段名按 fieldMapping 转成平台字段名', () => {
    const config = makeConfig({ Node版本: '项目Node' });
    expect(mapValuesForWrite({ Node版本: '20' }, config)).toEqual({
      项目Node: [{ type: 'text', text: '20' }],
    });
  });

  it('过滤 null / undefined：LLM 幻觉字段不会静默清空数据', () => {
    const config = makeConfig({ a: 'a', b: 'b' });
    const out = mapValuesForWrite({ a: '1', b: null, c: undefined }, config);
    expect(out).toEqual({ a: [{ type: 'text', text: '1' }] });
  });

  it('无 mapping 的字段用 logicalKey 作为平台字段名', () => {
    expect(mapValuesForWrite({ extra: 'v' }, makeConfig({}))).toEqual({
      extra: [{ type: 'text', text: 'v' }],
    });
  });

  it('对象 mapping 取其 name 作为平台字段名', () => {
    const config = makeConfig({
      标签: { name: '业务标签', type: 'multiSelect' },
    });
    expect(mapValuesForWrite({ 标签: ['门户'] }, config)).toEqual({
      业务标签: [{ type: 'text', text: '门户' }],
    });
  });
});

describe('mapValuesFromRead', () => {
  it('平台字段名反查回 logicalKey', () => {
    const out = mapValuesFromRead(
      { 项目Node: [{ type: 'text', text: '20' }] },
      { Node版本: '项目Node' },
    );
    expect(out).toEqual({ Node版本: '20' });
  });

  it('以 fieldMapping 为基准补齐缺失列，保证表头完整', () => {
    const out = mapValuesFromRead(
      { a: [{ type: 'text', text: '1' }] },
      {
        a: 'a',
        b: 'b',
      },
    );
    expect(out).toEqual({ a: '1', b: '' });
  });

  it('mapping 外的额外字段保留原名', () => {
    const out = mapValuesFromRead(
      { extra: [{ type: 'text', text: 'v' }] },
      { a: 'a' },
    );
    expect(out.extra).toBe('v');
    expect(out.a).toBe('');
  });
});

describe('displayType 决定单元格类型（P1：文本列曾被写成 date 单元格）', () => {
  it("声明 'text' 的列 → text 单元格", () => {
    expect(toWecomCells('2026-05-11', 'text')).toEqual([
      { type: 'text', text: '2026-05-11' },
    ]);
  });

  it("声明 'date' 的列 → date 单元格", () => {
    expect(toWecomCells('2026-05-11', 'date')).toEqual([
      { type: 'date', date: new Date('2026-05-11T12:00:00+08:00').getTime() },
    ]);
  });

  it('未声明时保留旧启发式（date 单元格）', () => {
    expect(toWecomCells('2026-05-11')[0]?.type).toBe('date');
  });

  it('mapValuesForWrite 按每列声明分别处理', () => {
    const out = mapValuesForWrite(
      { 期号: '2026-05-11', 上线日期: '2026-05-11' },
      makeConfig({
        期号: { name: '期号', type: 'plain', displayType: 'text' },
        上线日期: { name: '上线日期', type: 'plain', displayType: 'date' },
      }),
    );
    expect(out.期号?.[0]?.type).toBe('text');
    expect(out.上线日期?.[0]?.type).toBe('date');
  });
});
