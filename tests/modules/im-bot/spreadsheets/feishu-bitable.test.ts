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
  requiresAndConjunction,
  requiresOrConjunction,
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
  it('YYYY-MM-DD 字符串 → CST 当天 00:00 毫秒时间戳', () => {
    const ms = coerceFieldValue('2026-05-11');
    expect(typeof ms).toBe('number');
    expect(new Date(ms as number).toISOString()).toBe(
      '2026-05-10T16:00:00.000Z',
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

  it('YYYY-MM-DD → 单条 is + 当天零点（不再拆成两条区间）', () => {
    // 实测确认 filter 值按日截断，`is 当天零点` 即等价于"当天"；
    // 单条件还顺带消掉了与 _conjunction:'or' 的冲突
    const conds = buildFilterConditions('date', '2026-05-11');
    expect(conds).toHaveLength(1);
    expect(conds[0]?.operator).toBe('is');
    expect(conds[0]?.value[0]).toBe('ExactDate');
    expect(Number(conds[0]?.value[1])).toBe(
      new Date('2026-05-11T00:00:00+08:00').getTime(),
    );
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

describe('requiresAndConjunction — or 与区间条件不兼容', () => {
  it('日期区间展开的 isGreater + isLess 必须 AND', () => {
    const conds = buildFilterConditions('date', {
      op: 'between',
      value: ['2026-05-01', '2026-05-31'],
    });
    expect(requiresAndConjunction(conds)).toBe(true);
  });

  it('裸 YYYY-MM-DD 现在是单条件，可以与 or 混用', () => {
    // 改成单条 is 之后不再需要 AND —— 修掉了"按日期查询无法配 or"的限制
    expect(
      requiresAndConjunction(buildFilterConditions('d', '2026-05-11')),
    ).toBe(false);
  });

  it('单条件不构成冲突', () => {
    expect(requiresAndConjunction(buildFilterConditions('name', '督导'))).toBe(
      false,
    );
  });

  it('multiSelect 多个 contains 可以 OR（"包含A或包含B"是合法语义）', () => {
    // 不走 buildFilterConditions，直接模拟多选数组展开的形状
    const conds = [
      { field_name: 'tags', operator: 'contains', value: ['门户'] },
      { field_name: 'tags', operator: 'contains', value: ['督导'] },
    ];
    expect(requiresAndConjunction(conds)).toBe(false);
  });
});

describe('日期边界语义 — 由真实 API 实测反推（回归保护）', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = (d: string) => new Date(`${d}T00:00:00+08:00`).getTime();
  const only = (raw: unknown) => {
    const c = buildFilterConditions('date', raw);
    expect(c).toHaveLength(1);
    return { op: c[0]?.operator, ms: Number(c[0]?.value[1]) };
  };

  /*
   * 飞书把 filter 的 ExactDate 值按日截断到零点，记录侧用真实毫秒比较。
   * 所以"整天"语义的边界必须这样取，用「当天 23:59:59 ± 1ms」会静默查空。
   */

  it('= 当天 → is 当天零点', () => {
    expect(only('2026-05-11')).toEqual({ op: 'is', ms: start('2026-05-11') });
  });

  it('>= 当天 → isGreater 当天零点减 1ms（截断落到前一天，从而含当天）', () => {
    expect(only({ op: '>=', value: '2026-05-11' })).toEqual({
      op: 'isGreater',
      ms: start('2026-05-11') - 1,
    });
  });

  it('> 当天 → isGreater 当天零点（用次日零点会把次日整天吞掉）', () => {
    // 记录侧也是当天零点（见 field-types.ts），filter 值截断后与之相等，
    // 严格大于即"排除当天、包含次日"。
    // 实测：用次日零点时「> 01-02」少了 01-03 的记录（96 条 vs 97 条）
    expect(only({ op: '>', value: '2026-05-11' })).toEqual({
      op: 'isGreater',
      ms: start('2026-05-11'),
    });
  });

  it('<= 当天 → isLess 次日零点', () => {
    expect(only({ op: '<=', value: '2026-05-11' })).toEqual({
      op: 'isLess',
      ms: start('2026-05-11') + DAY,
    });
  });

  it('< 当天 → isLess 当天零点', () => {
    expect(only({ op: '<', value: '2026-05-11' })).toEqual({
      op: 'isLess',
      ms: start('2026-05-11'),
    });
  });

  it('between 的上界取终点次日零点，终点当天必须含在内', () => {
    const conds = buildFilterConditions('date', {
      op: 'between',
      value: ['2026-05-01', '2026-05-31'],
    });
    expect(conds).toHaveLength(2);
    expect(conds[0]?.operator).toBe('isGreater');
    expect(Number(conds[0]?.value[1])).toBe(start('2026-05-01') - 1);
    expect(conds[1]?.operator).toBe('isLess');
    // 关键：不是 05-31 23:59:59+1ms（那样会漏掉 05-31 当天）
    expect(Number(conds[1]?.value[1])).toBe(start('2026-05-31') + DAY);
  });

  it('单日 between（起止同一天）也能覆盖到那天', () => {
    const conds = buildFilterConditions('date', {
      op: 'between',
      value: ['2026-05-11', '2026-05-11'],
    });
    expect(Number(conds[0]?.value[1])).toBe(start('2026-05-11') - 1);
    expect(Number(conds[1]?.value[1])).toBe(start('2026-05-11') + DAY);
  });

  it('displayType=number 的列走数值区间，不套 ExactDate', () => {
    // 回归：between 原来无条件输出 ["ExactDate", ms]，数值列（分数/金额）
    // 上会被飞书判为非法筛选值。裸数字在 datetime 列上另有含义（精确毫秒），
    // 两者只能靠 fieldMapping 的 displayType 区分
    const conds = buildFilterConditions(
      '分数',
      { op: 'between', value: [50, 80] },
      'number',
    );
    expect(conds).toEqual([
      { field_name: '分数', operator: 'isGreaterEqual', value: ['50'] },
      { field_name: '分数', operator: 'isLessEqual', value: ['80'] },
    ]);
  });

  it('between 传毫秒数值时不做日截断（保留精确区间能力）', () => {
    const conds = buildFilterConditions('date', {
      op: 'between',
      value: [1000, 2000],
    });
    expect(Number(conds[0]?.value[1])).toBe(1000);
    expect(Number(conds[1]?.value[1])).toBe(2001);
  });
});

describe('displayType 决定值是否按日期解释（P1：文本列的 2026-05-11 曾被写成时间戳）', () => {
  it("声明 'text' 的列：日期样式的字符串原样写入", () => {
    expect(coerceFieldValue('2026-05-11', 'text')).toBe('2026-05-11');
  });

  it("声明 'number' 的列：日期样式的字符串原样写入", () => {
    expect(coerceFieldValue('2026-05-11', 'number')).toBe('2026-05-11');
  });

  it("声明 'date' 的列：转成 CST 当天 00:00 毫秒值", () => {
    // 00:00 而不是 12:00：与平台自己写入日期的时刻一致，
    // 否则 ExactDate 按日截断后各操作符的边界会差一天
    expect(coerceFieldValue('2026-05-11', 'date')).toBe(
      new Date('2026-05-11T00:00:00+08:00').getTime(),
    );
  });

  it('未声明 displayType 时保留旧启发式，历史配置不回归', () => {
    expect(typeof coerceFieldValue('2026-05-11')).toBe('number');
  });

  it('mapFieldsForWrite 按每列的声明分别处理', async () => {
    const out = await mapFieldsForWrite(
      { 期号: '2026-05-11', 上线日期: '2026-05-11' },
      makeConfig({
        期号: { name: '期号', type: 'plain', displayType: 'text' },
        上线日期: { name: '上线日期', type: 'plain', displayType: 'date' },
      }),
    );
    expect(out.期号).toBe('2026-05-11');
    expect(typeof out.上线日期).toBe('number');
  });

  it("筛选侧同理：'text' 列不生成 ExactDate 条件", () => {
    expect(buildFilterConditions('期号', '2026-05-11', 'text')).toEqual([
      { field_name: '期号', operator: 'is', value: ['2026-05-11'] },
    ]);
  });

  it("'text' 列的比较操作符也按字面量走，不做日粒度换算", () => {
    expect(
      buildFilterConditions('期号', { op: '>=', value: '2026-05-11' }, 'text'),
    ).toEqual([
      { field_name: '期号', operator: 'isGreaterEqual', value: ['2026-05-11'] },
    ]);
  });

  it('日期列的 ExactDate 语义不受影响', () => {
    const conds = buildFilterConditions('上线日期', '2026-05-11', 'date');
    expect(conds[0]?.value[0]).toBe('ExactDate');
  });
});

describe('buildFilterConditions — 数组筛选值 = 命中任一（回归）', () => {
  it('回归 —— 以前 String(数组) 拼成 "门户,督导" 一个字面量，恒不命中', () => {
    expect(buildFilterConditions('域', ['门户', '督导'])).toEqual([
      { field_name: '域', operator: 'is', value: ['门户'] },
      { field_name: '域', operator: 'is', value: ['督导'] },
    ]);
  });

  it('过滤空元素', () => {
    expect(buildFilterConditions('域', ['门户', '', null])).toEqual([
      { field_name: '域', operator: 'is', value: ['门户'] },
    ]);
  });

  it('日期列的数组元素各自转成 ExactDate', () => {
    const conds = buildFilterConditions('日期', ['2026-05-11', '2026-05-13']);
    expect(conds).toHaveLength(2);
    expect(conds[0]?.value[0]).toBe('ExactDate');
    expect(conds[1]?.value[0]).toBe('ExactDate');
  });

  it('声明为 text 的列不把数组元素当日期', () => {
    const conds = buildFilterConditions('备注', ['2026-05-11'], 'text');
    expect(conds).toEqual([
      { field_name: '备注', operator: 'is', value: ['2026-05-11'] },
    ]);
  });

  it('多值展开必须以 OR 连接，不是 AND', () => {
    const conds = buildFilterConditions('域', ['门户', '督导']);
    expect(requiresOrConjunction(conds)).toBe(true);
    expect(requiresAndConjunction(conds)).toBe(false);
  });

  it('区间展开仍然要 AND，两个判定互斥', () => {
    const conds = buildFilterConditions('日期', {
      op: 'between',
      value: ['2026-05-01', '2026-05-31'],
    });
    expect(requiresAndConjunction(conds)).toBe(true);
    expect(requiresOrConjunction(conds)).toBe(false);
  });

  it('单条件两个判定都不成立', () => {
    const conds = buildFilterConditions('名称', '督导');
    expect(requiresAndConjunction(conds)).toBe(false);
    expect(requiresOrConjunction(conds)).toBe(false);
  });
});
