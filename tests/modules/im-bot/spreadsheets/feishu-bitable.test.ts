// cspell:ignore conds
import { describe, expect, it } from 'vitest';
import type {
  FieldMappingValue,
  SpreadsheetTableConfig,
} from '@/modules/im-bot/core/types';
import {
  buildFilterConditions,
  coerceFieldValue,
  mapFieldsForWrite,
  reverseMapFields,
} from '@/modules/im-bot/spreadsheets/feishu-bitable';

const makeConfig = (
  fieldMapping: Record<string, FieldMappingValue>,
): SpreadsheetTableConfig => ({
  platform: 'feishu',
  workspaceId: 'app1',
  tableId: 't1',
  fieldMapping,
});

describe('coerceFieldValue', () => {
  it('YYYY-MM-DD 字符串 → CST 12:00 毫秒时间戳', () => {
    const ms = coerceFieldValue('2026-05-11');
    expect(typeof ms).toBe('number');
    expect(new Date(ms as number).toISOString()).toBe(
      '2026-05-11T04:00:00.000Z',
    );
  });

  it('普通字符串原样返回', () => {
    expect(coerceFieldValue('hello')).toBe('hello');
  });

  it('数字 / 布尔 / null / 数组原样返回', () => {
    expect(coerceFieldValue(123)).toBe(123);
    expect(coerceFieldValue(true)).toBe(true);
    expect(coerceFieldValue(null)).toBeNull();
    expect(coerceFieldValue(['a'])).toEqual(['a']);
  });

  it('非 YYYY-MM-DD 的日期格式不被识别（如 2026/05/11）', () => {
    expect(coerceFieldValue('2026/05/11')).toBe('2026/05/11');
  });
});

describe('mapFieldsForWrite — 修复 null 静默清空数据', () => {
  it('过滤 null：LLM 幻觉字段不会被写入飞书', async () => {
    const config = makeConfig({ 项目名称: '项目名称', 备注: '备注' });
    const result = await mapFieldsForWrite(
      { 项目名称: '督导2.0', 备注: null },
      config,
    );
    expect(result).toEqual({ 项目名称: '督导2.0' });
    expect('备注' in result).toBe(false);
  });

  it('过滤 undefined', async () => {
    const config = makeConfig({ a: 'a', b: 'b' });
    const result = await mapFieldsForWrite({ a: '1', b: undefined }, config);
    expect(result).toEqual({ a: '1' });
  });

  it('空字符串保留（用户可显式清空）', async () => {
    const config = makeConfig({ note: 'note' });
    const result = await mapFieldsForWrite({ note: '' }, config);
    expect(result).toEqual({ note: '' });
  });

  it('多选字段：数组 → 字符串数组，过滤空元素', async () => {
    const config = makeConfig({
      tags: { name: 'tags', type: 'multiSelect' },
    });
    const result = await mapFieldsForWrite(
      { tags: ['a', '', null, 'b'] },
      config,
    );
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('多选字段：标量 → 包成单元素数组', async () => {
    const config = makeConfig({
      tags: { name: 'tags', type: 'multiSelect' },
    });
    const result = await mapFieldsForWrite({ tags: 'solo' }, config);
    expect(result.tags).toEqual(['solo']);
  });

  it('日期字符串通过 coerceFieldValue 转毫秒', async () => {
    const config = makeConfig({ createdAt: 'createdAt' });
    const result = await mapFieldsForWrite({ createdAt: '2026-05-11' }, config);
    expect(typeof result.createdAt).toBe('number');
  });

  it('无 mapping 的字段用 logicalKey 作为平台 key', async () => {
    const config = makeConfig({});
    const result = await mapFieldsForWrite({ extra: 'v' }, config);
    expect(result).toEqual({ extra: 'v' });
  });
});

describe('buildFilterConditions — 简单值', () => {
  it('字符串 → is 精确匹配', () => {
    expect(buildFilterConditions('name', '督导')).toEqual([
      { field_name: 'name', operator: 'is', value: ['督导'] },
    ]);
  });

  it('数字 → is + String', () => {
    expect(buildFilterConditions('price', 99)).toEqual([
      { field_name: 'price', operator: 'is', value: ['99'] },
    ]);
  });

  it('YYYY-MM-DD → 当天范围 (isGreater + isLess + ExactDate)', () => {
    const conds = buildFilterConditions('date', '2026-05-11');
    expect(conds).toHaveLength(2);
    expect(conds[0]?.operator).toBe('isGreater');
    expect(conds[0]?.value[0]).toBe('ExactDate');
    expect(conds[1]?.operator).toBe('isLess');
    expect(conds[1]?.value[0]).toBe('ExactDate');
  });
});

describe('buildFilterConditions — 高级 {op, value}', () => {
  it('contains', () => {
    expect(
      buildFilterConditions('name', { op: 'contains', value: '督' }),
    ).toEqual([{ field_name: 'name', operator: 'contains', value: ['督'] }]);
  });

  it('> / >= / < / <=', () => {
    expect(
      buildFilterConditions('p', { op: '>', value: 50 })[0]?.operator,
    ).toBe('isGreater');
    expect(
      buildFilterConditions('p', { op: '>=', value: 50 })[0]?.operator,
    ).toBe('isGreaterEqual');
    expect(
      buildFilterConditions('p', { op: '<', value: 50 })[0]?.operator,
    ).toBe('isLess');
    expect(
      buildFilterConditions('p', { op: '<=', value: 50 })[0]?.operator,
    ).toBe('isLessEqual');
  });

  it('isEmpty / isNotEmpty 不需要 value', () => {
    expect(buildFilterConditions('n', { op: 'isEmpty' })).toEqual([
      { field_name: 'n', operator: 'isEmpty', value: [] },
    ]);
    expect(buildFilterConditions('n', { op: 'isNotEmpty' })).toEqual([
      { field_name: 'n', operator: 'isNotEmpty', value: [] },
    ]);
  });

  it('between (date) → isGreater + isLess 双条件 (ExactDate)', () => {
    const conds = buildFilterConditions('date', {
      op: 'between',
      value: ['2026-05-01', '2026-05-31'],
    });
    expect(conds).toHaveLength(2);
    expect(conds[0]?.operator).toBe('isGreater');
    expect(conds[0]?.value[0]).toBe('ExactDate');
    expect(conds[1]?.operator).toBe('isLess');
  });

  it('日期字段 isGreaterEqual 降级为 isGreater - 1ms', () => {
    const conds = buildFilterConditions('date', {
      op: '>=',
      value: '2026-05-11',
    });
    expect(conds[0]?.operator).toBe('isGreater');
  });

  it('未知 op 退化为 is', () => {
    const conds = buildFilterConditions('n', { op: 'unknown_op', value: 'v' });
    expect(conds[0]?.operator).toBe('is');
  });
});

describe('reverseMapFields', () => {
  it('用 mapping 把飞书平台字段名反查回 logicalKey', () => {
    const out = reverseMapFields(
      { 项目名称: '督导', _备注: 'x' },
      { 项目名称: '项目名称' },
    );
    expect(out).toEqual({ 项目名称: '督导', _备注: 'x' });
  });

  it('object mapping (LinkFieldMapping) 用 mapping.name 作为平台字段名', () => {
    const out = reverseMapFields(
      { 关联项目: 'rec123' },
      {
        proj: {
          name: '关联项目',
          type: 'link',
          linkTableId: 't',
          displayField: 'd',
        },
      },
    );
    // 平台字段名 '关联项目' 反查为 logicalKey 'proj'
    expect(out).toEqual({ proj: 'rec123' });
  });

  it('mapping 中没有的平台字段保留为原名', () => {
    const out = reverseMapFields({ extra: 'v' }, { a: 'a' });
    expect(out).toEqual({ extra: 'v' });
  });
});
