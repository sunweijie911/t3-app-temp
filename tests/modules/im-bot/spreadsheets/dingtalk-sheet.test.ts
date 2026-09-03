import { describe, expect, it } from 'vitest';
import type {
  FieldMappingValue,
  SpreadsheetTableConfig,
} from '@/modules/im-bot/core/types';
import {
  mapFieldsForWrite,
  mapFieldsFromRead,
  toDingtalkValue,
} from '@/modules/im-bot/spreadsheets/dingtalk-sheet';

const makeConfig = (
  fieldMapping: Record<string, FieldMappingValue>,
): SpreadsheetTableConfig => ({
  platform: 'dingtalk',
  workspaceId: 'base1',
  tableId: 'sheet1',
  fieldMapping,
});

describe('toDingtalkValue', () => {
  it('YYYY-MM-DD → CST 12:00 毫秒时间戳（与飞书/企微侧对齐避免跨日）', () => {
    const ms = toDingtalkValue('2026-05-11');
    expect(typeof ms).toBe('number');
    expect(new Date(ms as number).toISOString()).toBe(
      '2026-05-11T04:00:00.000Z',
    );
  });

  it('钉钉接受裸值，普通字符串/数字/布尔原样返回', () => {
    expect(toDingtalkValue('督导2.0')).toBe('督导2.0');
    expect(toDingtalkValue(99)).toBe(99);
    expect(toDingtalkValue(true)).toBe(true);
  });

  it('数组原样返回（多选字段）', () => {
    expect(toDingtalkValue(['门户', '督导'])).toEqual(['门户', '督导']);
  });

  it('非 YYYY-MM-DD 的日期串不被识别', () => {
    expect(toDingtalkValue('2026/05/11')).toBe('2026/05/11');
  });
});

describe('mapFieldsForWrite', () => {
  it('逻辑字段名按 fieldMapping 转成平台字段名', () => {
    const config = makeConfig({ Node版本: '项目Node' });
    expect(mapFieldsForWrite({ Node版本: '20' }, config)).toEqual({
      项目Node: '20',
    });
  });

  it('过滤 null / undefined：LLM 幻觉字段不会静默清空数据', () => {
    const config = makeConfig({ a: 'a', b: 'b' });
    expect(
      mapFieldsForWrite({ a: '1', b: null, c: undefined }, config),
    ).toEqual({ a: '1' });
  });

  it('空字符串保留（用户可显式清空）', () => {
    expect(
      mapFieldsForWrite({ note: '' }, makeConfig({ note: 'note' })),
    ).toEqual({ note: '' });
  });

  it('无 mapping 的字段用 logicalKey 作为平台字段名', () => {
    expect(mapFieldsForWrite({ extra: 'v' }, makeConfig({}))).toEqual({
      extra: 'v',
    });
  });

  it('对象 mapping 取其 name', () => {
    const config = makeConfig({
      标签: { name: '业务标签', type: 'multiSelect' },
    });
    expect(mapFieldsForWrite({ 标签: ['门户'] }, config)).toEqual({
      业务标签: ['门户'],
    });
  });

  it('日期字段写入时转毫秒', () => {
    const out = mapFieldsForWrite(
      { 上线日期: '2026-05-11' },
      makeConfig({ 上线日期: '上线日期' }),
    );
    expect(typeof out.上线日期).toBe('number');
  });
});

describe('mapFieldsFromRead', () => {
  it('平台字段名反查回 logicalKey', () => {
    expect(
      mapFieldsFromRead({ 项目Node: '20' }, { Node版本: '项目Node' }),
    ).toEqual({ Node版本: '20' });
  });

  it('以 fieldMapping 为基准补齐缺失列，保证表头完整', () => {
    expect(mapFieldsFromRead({ a: '1' }, { a: 'a', b: 'b' })).toEqual({
      a: '1',
      b: '',
    });
  });

  it('mapping 外的额外字段保留原名', () => {
    const out = mapFieldsFromRead({ extra: 'v' }, { a: 'a' });
    expect(out.extra).toBe('v');
    expect(out.a).toBe('');
  });
});

describe('displayType 决定值是否按日期解释（P1）', () => {
  it("声明 'text' / 'number' 的列不转时间戳", () => {
    expect(toDingtalkValue('2026-05-11', 'text')).toBe('2026-05-11');
    expect(toDingtalkValue('2026-05-11', 'number')).toBe('2026-05-11');
  });

  it("声明 'date' 的列仍转 CST 12:00 毫秒值", () => {
    expect(toDingtalkValue('2026-05-11', 'date')).toBe(
      new Date('2026-05-11T12:00:00+08:00').getTime(),
    );
  });

  it('mapFieldsForWrite 按每列声明分别处理', () => {
    const out = mapFieldsForWrite(
      { 期号: '2026-05-11', 上线日期: '2026-05-11' },
      makeConfig({
        期号: { name: '期号', type: 'plain', displayType: 'text' },
        上线日期: { name: '上线日期', type: 'plain', displayType: 'date' },
      }),
    );
    expect(out.期号).toBe('2026-05-11');
    expect(typeof out.上线日期).toBe('number');
  });
});
