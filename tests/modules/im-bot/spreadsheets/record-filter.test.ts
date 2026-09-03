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

describe('filterRecords — 日期按 CST 自然日比较', () => {
  /** 写入侧统一落在当天 12:00 CST，这里按真实存储值构造 */
  const at = (day: string) => new Date(`${day}T12:00:00+08:00`).getTime();
  const records: SpreadsheetRecord[] = [
    { recordId: 'd1', fields: { 名称: 'A', 上线日期: at('2026-05-10') } },
    { recordId: 'd2', fields: { 名称: 'B', 上线日期: at('2026-05-11') } },
    { recordId: 'd3', fields: { 名称: 'C', 上线日期: at('2026-05-12') } },
  ];

  it('等值：回归 —— 以前 String(毫秒) 与 YYYY-MM-DD 比较恒不命中', () => {
    expect(
      filterRecords(records, { 上线日期: '2026-05-11' }).map((r) => r.recordId),
    ).toEqual(['d2']);
  });

  it('>= 含当天，> 不含当天（与飞书 ExactDate 边界一致）', () => {
    expect(
      filterRecords(records, {
        上线日期: { op: '>=', value: '2026-05-11' },
      }).map((r) => r.recordId),
    ).toEqual(['d2', 'd3']);
    expect(
      filterRecords(records, {
        上线日期: { op: '>', value: '2026-05-11' },
      }).map((r) => r.recordId),
    ).toEqual(['d3']);
  });

  it('<= 含当天，< 不含当天', () => {
    expect(
      filterRecords(records, {
        上线日期: { op: '<=', value: '2026-05-11' },
      }).map((r) => r.recordId),
    ).toEqual(['d1', 'd2']);
    expect(
      filterRecords(records, {
        上线日期: { op: '<', value: '2026-05-11' },
      }).map((r) => r.recordId),
    ).toEqual(['d1']);
  });

  it('between 是闭区间，两端当天都算进来', () => {
    expect(
      filterRecords(records, {
        上线日期: { op: 'between', value: ['2026-05-10', '2026-05-11'] },
      }).map((r) => r.recordId),
    ).toEqual(['d1', 'd2']);
  });

  it('!= 按自然日排除', () => {
    expect(
      filterRecords(records, {
        上线日期: { op: '!=', value: '2026-05-11' },
      }).map((r) => r.recordId),
    ).toEqual(['d1', 'd3']);
  });

  it('日期跨 UTC 日界仍归到 CST 当天（早 8 点前不算前一天）', () => {
    const early: SpreadsheetRecord[] = [
      {
        recordId: 'e1',
        // 2026-05-11 01:00 CST = 2026-05-10 17:00 UTC
        fields: { 上线日期: new Date('2026-05-11T01:00:00+08:00').getTime() },
      },
    ];
    expect(filterRecords(early, { 上线日期: '2026-05-11' })).toHaveLength(1);
    expect(filterRecords(early, { 上线日期: '2026-05-10' })).toHaveLength(0);
  });

  it('文本列存的 YYYY-MM-DD 同样按日期比较', () => {
    const textCol: SpreadsheetRecord[] = [
      { recordId: 't1', fields: { 上线日期: '2026-05-11' } },
    ];
    expect(
      filterRecords(textCol, { 上线日期: { op: '>=', value: '2026-05-11' } }),
    ).toHaveLength(1);
  });

  it('非日期字段的数值比较不受影响', () => {
    const numberRecords: SpreadsheetRecord[] = [
      { recordId: 'n1', fields: { 分数: 80 } },
      { recordId: 'n2', fields: { 分数: 50 } },
    ];
    expect(
      filterRecords(numberRecords, { 分数: { op: '>', value: 60 } }).map(
        (r) => r.recordId,
      ),
    ).toEqual(['n1']);
    expect(
      filterRecords(numberRecords, {
        分数: { op: 'between', value: [40, 60] },
      }).map((r) => r.recordId),
    ).toEqual(['n2']);
  });
});
