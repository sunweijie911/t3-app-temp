import { describe, expect, it } from 'vitest';
import type { SpreadsheetRecord } from '@/modules/im-bot/core/types';
import { filterRecords } from '@/modules/im-bot/spreadsheets/record-filter';

describe('filterRecords — 客户端过滤', () => {
  const records: SpreadsheetRecord[] = [
    { recordId: 'r1', fields: { 名称: 'A', 分数: 80, 域: '门户' } },
    { recordId: 'r2', fields: { 名称: 'B', 分数: 50, 域: '督导' } },
    { recordId: 'r3', fields: { 名称: 'C', 分数: 90, 域: '' } },
  ];

  it('无有效筛选键时原样返回', () => {
    expect(filterRecords(records, {})).toHaveLength(3);
    // 只有保留键同样视为无筛选
    expect(filterRecords(records, { _conjunction: 'or' })).toHaveLength(3);
  });

  it('等值匹配', () => {
    expect(
      filterRecords(records, { 名称: 'A' }).map((r) => r.recordId),
    ).toEqual(['r1']);
  });

  it('数字字段的等值匹配按字符串比较也能命中', () => {
    expect(filterRecords(records, { 分数: 80 })).toHaveLength(1);
  });

  it('多条件默认 AND', () => {
    expect(filterRecords(records, { 名称: 'A', 域: '门户' })).toHaveLength(1);
    expect(filterRecords(records, { 名称: 'A', 域: '督导' })).toHaveLength(0);
  });

  it('_conjunction=or 时多条件取并集', () => {
    const out = filterRecords(records, {
      名称: 'A',
      域: '督导',
      _conjunction: 'or',
    });
    expect(out.map((r) => r.recordId)).toEqual(['r1', 'r2']);
  });

  it('contains', () => {
    expect(
      filterRecords(records, { 名称: { op: 'contains', value: 'A' } }),
    ).toHaveLength(1);
  });

  it('数值比较 > / >= / < / <=', () => {
    expect(
      filterRecords(records, { 分数: { op: '>', value: 80 } }),
    ).toHaveLength(1);
    expect(
      filterRecords(records, { 分数: { op: '>=', value: 80 } }),
    ).toHaveLength(2);
    expect(
      filterRecords(records, { 分数: { op: '<', value: 80 } }),
    ).toHaveLength(1);
    expect(
      filterRecords(records, { 分数: { op: '<=', value: 80 } }),
    ).toHaveLength(2);
  });

  it('isEmpty / isNotEmpty', () => {
    expect(
      filterRecords(records, { 域: { op: 'isEmpty' } }).map((r) => r.recordId),
    ).toEqual(['r3']);
    expect(filterRecords(records, { 域: { op: 'isNotEmpty' } })).toHaveLength(
      2,
    );
  });

  it('!= / isNot', () => {
    expect(
      filterRecords(records, { 名称: { op: '!=', value: 'A' } }),
    ).toHaveLength(2);
  });

  it('未知 op 退化为等值匹配（与飞书侧一致）', () => {
    expect(
      filterRecords(records, { 名称: { op: 'weird_op', value: 'A' } }),
    ).toHaveLength(1);
  });

  it('数组字段值按拼接后的字符串做 contains', () => {
    const multi: SpreadsheetRecord[] = [
      { recordId: 'm1', fields: { 标签: ['门户', '督导'] } },
    ];
    expect(
      filterRecords(multi, { 标签: { op: 'contains', value: '督导' } }),
    ).toHaveLength(1);
  });
});
