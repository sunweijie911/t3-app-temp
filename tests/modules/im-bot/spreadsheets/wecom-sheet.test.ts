// cspell:ignore zhangsan
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/auth/wecom-token', () => ({
  wecomTokenManager: { getToken: vi.fn(async () => 'wx-token') },
}));

import { fieldToStringRaw } from '@/modules/im-bot/core/field-render';
import type {
  FieldMappingValue,
  SpreadsheetTableConfig,
} from '@/modules/im-bot/core/types';
import {
  mapValuesForWrite,
  mapValuesFromRead,
  toWecomValue,
  WecomSheetAdapter,
} from '@/modules/im-bot/spreadsheets/wecom-sheet';

const makeConfig = (
  fieldMapping: Record<string, FieldMappingValue>,
): SpreadsheetTableConfig => ({
  platform: 'wecom',
  workspaceId: 'docid1',
  tableId: 'sheet1',
  fieldMapping,
});

/**
 * 写入形状对齐官方 add_records（path/101240）：
 * 文本裸串、数字裸 double、复选框裸布尔、日期 "YYYY-MM-DD HH:mm:ss"、
 * 选项 [{text}]。以前写的是自造的 [{type:'text',text}]，平台不认。
 */
describe('toWecomValue — 逻辑值 → 官方 values 形状', () => {
  it('字符串 → 裸字符串（不是 [{type:text}]）', () => {
    expect(toWecomValue('督导2.0')).toBe('督导2.0');
  });

  it('数字 → 裸 double', () => {
    expect(toWecomValue(99)).toBe(99);
    expect(toWecomValue(123.45)).toBe(123.45);
  });

  it('布尔 → 裸布尔（复选框）', () => {
    expect(toWecomValue(true)).toBe(true);
    expect(toWecomValue(false)).toBe(false);
  });

  it('YYYY-MM-DD → "YYYY-MM-DD 00:00:00" 字符串', () => {
    // 本模块日期统一落在 CST 当天 00:00，所以时间部分恒为 00:00:00
    expect(toWecomValue('2026-05-11')).toBe('2026-05-11 00:00:00');
  });

  it('非 YYYY-MM-DD 的日期串仍当文本（与飞书侧行为一致）', () => {
    expect(toWecomValue('2026/05/11')).toBe('2026/05/11');
  });

  it('数组 → 按元素 [{text}]（多选，没有服务端选项 id）', () => {
    expect(toWecomValue(['门户', '督导'])).toEqual([
      { text: '门户' },
      { text: '督导' },
    ]);
  });

  it('数组元素不带 type 字段 —— select 只认 {id,text}', () => {
    const out = toWecomValue(['门户']) as Array<Record<string, unknown>>;
    expect(out[0]).not.toHaveProperty('type');
  });

  it('数组里的空元素被过滤掉', () => {
    expect(toWecomValue(['a', '', null, 'b'])).toEqual([
      { text: 'a' },
      { text: 'b' },
    ]);
  });

  it('数字 0 与 false 不被当成空值丢弃', () => {
    expect(toWecomValue(0)).toBe(0);
    expect(toWecomValue(false)).toBe(false);
  });

  it('null / undefined / 空串 → 空串（清空该列）', () => {
    expect(toWecomValue(null)).toBe('');
    expect(toWecomValue(undefined)).toBe('');
    expect(toWecomValue('')).toBe('');
  });

  it('清空选项列给空数组，不是空串（形状不对平台会报参数错误）', () => {
    const multi: FieldMappingValue = { name: '业务域', type: 'multiSelect' };
    expect(toWecomValue('', multi)).toEqual([]);
    expect(toWecomValue(null, multi)).toEqual([]);
  });
});

describe('toWecomValue — 选项字段', () => {
  it('声明 multiSelect 的列，单值也写 [{text}]', () => {
    expect(
      toWecomValue('门户', { name: '业务域', type: 'multiSelect' }),
    ).toEqual([{ text: '门户' }]);
  });

  it('plain + options（单选列）同样写 [{text}]', () => {
    expect(
      toWecomValue('已完成', {
        name: '状态',
        type: 'plain',
        options: ['待办', '已完成'],
      }),
    ).toEqual([{ text: '已完成' }]);
  });

  it('没有 options 的普通文本列写裸串', () => {
    expect(toWecomValue('随便写点', { name: '备注', type: 'plain' })).toBe(
      '随便写点',
    );
  });

  it('字符串映射（无类型声明）写裸串', () => {
    expect(toWecomValue('v', '平台列名')).toBe('v');
  });

  it('★ 选项判定排在日期之前：选项值长得像日期也按 [{text}] 写', () => {
    // 选项列的档位可能本身就是日期（"2026-05-11" 这一期），先判日期的话
    // 会写成 "2026-05-11 00:00:00" 的日期串，平台报参数错误
    expect(
      toWecomValue('2026-05-11', {
        name: '期次',
        type: 'plain',
        options: ['2026-05-11', '2026-05-18'],
      }),
    ).toEqual([{ text: '2026-05-11' }]);
    expect(
      toWecomValue('2026-05-11', { name: '期次', type: 'multiSelect' }),
    ).toEqual([{ text: '2026-05-11' }]);
  });
});

describe('wecomApi 写接口报错时的诊断日志（选项列缺 id 是已知风险）', () => {
  const adapter = new WecomSheetAdapter();
  const config: SpreadsheetTableConfig = {
    platform: 'wecom',
    workspaceId: 'doc1',
    tableId: 'sheet1',
    fieldMapping: {
      名称: '名称',
      业务域: { name: '业务域', type: 'multiSelect' },
    },
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubErr() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ errcode: 40058, errmsg: 'invalid values' }),
            { status: 200 },
          ),
      ),
    );
  }

  it('add_records 出错时点名涉及的选项列，但**不打印值**', async () => {
    stubErr();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      adapter.createRecord(config, { 名称: 'A', 业务域: ['门户'] }),
    ).rejects.toThrow();

    const [, payload] = err.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.optionColumns).toEqual(['业务域']);
    // 值不能落进日志：那是用户数据
    expect(JSON.stringify(payload)).not.toContain('门户');
    err.mockRestore();
  });

  it('读接口出错时不带这项 —— get_records 跟选项 id 没关系', async () => {
    stubErr();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(adapter.queryRecords(config, {})).rejects.toThrow();

    const [, payload] = err.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty('optionColumns');
    err.mockRestore();
  });
});

describe('displayType 决定日期是否转换（P1：文本列曾被写成日期）', () => {
  it("声明 'text' 的列保持原串", () => {
    expect(
      toWecomValue('2026-05-11', {
        name: '期号',
        type: 'plain',
        displayType: 'text',
      }),
    ).toBe('2026-05-11');
  });

  it("声明 'number' 的列不转日期", () => {
    expect(
      toWecomValue('2026-05-11', {
        name: '编号',
        type: 'plain',
        displayType: 'number',
      }),
    ).toBe('2026-05-11');
  });

  it("声明 'date' 的列 → 日期时间串", () => {
    expect(
      toWecomValue('2026-05-11', {
        name: '上线日期',
        type: 'plain',
        displayType: 'date',
      }),
    ).toBe('2026-05-11 00:00:00');
  });

  it('mapValuesForWrite 按每列声明分别处理', () => {
    const out = mapValuesForWrite(
      { 期号: '2026-05-11', 上线日期: '2026-05-11' },
      makeConfig({
        期号: { name: '期号', type: 'plain', displayType: 'text' },
        上线日期: { name: '上线日期', type: 'plain', displayType: 'date' },
      }),
    );
    expect(out.期号).toBe('2026-05-11');
    expect(out.上线日期).toBe('2026-05-11 00:00:00');
  });
});

describe('mapValuesForWrite', () => {
  it('逻辑字段名按 fieldMapping 转成平台字段名', () => {
    const config = makeConfig({ Node版本: '项目Node' });
    expect(mapValuesForWrite({ Node版本: '20' }, config)).toEqual({
      项目Node: '20',
    });
  });

  it('过滤 null / undefined：LLM 幻觉字段不会静默清空数据', () => {
    const config = makeConfig({ a: 'a', b: 'b' });
    const out = mapValuesForWrite({ a: '1', b: null, c: undefined }, config);
    expect(out).toEqual({ a: '1' });
  });

  it('无 mapping 的字段用 logicalKey 作为平台字段名', () => {
    expect(mapValuesForWrite({ extra: 'v' }, makeConfig({}))).toEqual({
      extra: 'v',
    });
  });

  it('对象 mapping 取其 name 作为平台字段名，多选写 [{text}]', () => {
    const config = makeConfig({
      标签: { name: '业务标签', type: 'multiSelect' },
    });
    expect(mapValuesForWrite({ 标签: ['门户'] }, config)).toEqual({
      业务标签: [{ text: '门户' }],
    });
  });

  it('数字列写裸数，不再被平台当成文本', () => {
    const config = makeConfig({
      金额: { name: '金额', type: 'plain', displayType: 'number' },
    });
    expect(mapValuesForWrite({ 金额: 123.45 }, config)).toEqual({
      金额: 123.45,
    });
  });
});

describe('mapValuesFromRead — 读侧兼容各种形状', () => {
  it('平台字段名反查回 logicalKey', () => {
    const out = mapValuesFromRead({ 项目Node: '20' }, { Node版本: '项目Node' });
    expect(out).toEqual({ Node版本: '20' });
  });

  it('裸值原样读回（文本 / 数字 / 布尔）', () => {
    const out = mapValuesFromRead(
      { a: 'v', b: 42, c: true },
      { a: 'a', b: 'b', c: 'c' },
    );
    expect(out).toEqual({ a: 'v', b: 42, c: true });
  });

  it('[{text}] 单选（无选项 id）→ 字符串，不是数组', () => {
    const out = mapValuesFromRead(
      { 状态: [{ text: '已完成' }] },
      { 状态: '状态' },
    );
    expect(out.状态).toBe('已完成');
  });

  it('[{id,text}] 多选 → 字符串数组（成员筛选依赖它）', () => {
    const out = mapValuesFromRead(
      {
        业务域: [
          { id: 'opt1', text: '门户' },
          { id: 'opt2', text: '督导' },
        ],
      },
      { 业务域: '业务域' },
    );
    expect(out.业务域).toEqual(['门户', '督导']);
  });

  it('[{userId,userName}] 人员 → 姓名数组（单个也保持数组，与飞书同形）', () => {
    const out = mapValuesFromRead(
      { 负责人: [{ userId: 'zhangsan', userName: '张三' }] },
      { 负责人: '负责人' },
    );
    expect(out.负责人).toEqual(['张三']);
  });

  it('早期写入的 [{type,text}] 仍读得回来', () => {
    const out = mapValuesFromRead(
      { a: [{ type: 'text', text: 'v' }] },
      { a: 'a' },
    );
    expect(out.a).toBe('v');
  });

  it('早期写入的 [{type:number,number}] / checkbox 仍读得回来', () => {
    const out = mapValuesFromRead(
      {
        n: [{ type: 'number', number: 42 }],
        c: [{ type: 'checkbox', checkbox: true }],
      },
      { n: 'n', c: 'c' },
    );
    expect(out.n).toBe(42);
    expect(out.c).toBe(true);
  });

  it('以 fieldMapping 为基准补齐缺失列，保证表头完整', () => {
    const out = mapValuesFromRead({ a: '1' }, { a: 'a', b: 'b' });
    expect(out).toEqual({ a: '1', b: '' });
  });

  it('mapping 外的额外字段保留原名', () => {
    const out = mapValuesFromRead({ extra: 'v' }, { a: 'a' });
    expect(out.extra).toBe('v');
    expect(out.a).toBe('');
  });

  it('空数组 → 空串（下游渲染会过滤掉）', () => {
    const out = mapValuesFromRead({ a: [] }, { a: 'a' });
    expect(out.a).toBe('');
  });
});

/**
 * P0 回归：企微日期写进去是 "2026-05-11 00:00:00"，读回来还是这个串。
 *
 * 归一化层不把它收口成毫秒的话，record-filter 的 actualMs 只认数字和纯
 * YYYY-MM-DD —— 等值 / >= / between **全部 0 命中**，field-render 还会把
 * 带时分秒的原始串直接发到群里。这条用例把「写 → 读 → 筛 → 渲染」串起来，
 * 任何一环退回旧行为都会红。
 */
describe('企微日期 write → read → filterRecords 往返（P0）', () => {
  const adapter = new WecomSheetAdapter();
  const config: SpreadsheetTableConfig = {
    platform: 'wecom',
    workspaceId: 'doc1',
    tableId: 'sheet1',
    fieldMapping: {
      名称: '名称',
      日期: { name: '日期', type: 'plain', displayType: 'date' },
    },
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  /** mock 一次 get_records，返回平台真实的日期形态 */
  function stubRead() {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errcode: 0,
            records: [
              {
                record_id: 'r1',
                values: { 名称: 'A', 日期: '2026-05-11 00:00:00' },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('写侧把 2026-05-11 落成平台要的日期时间串', () => {
    expect(mapValuesForWrite({ 日期: '2026-05-11' }, config).日期).toBe(
      '2026-05-11 00:00:00',
    );
  });

  it('等值筛选命中（以前恒 0 条）', async () => {
    stubRead();
    const out = await adapter.queryRecords(config, { 日期: '2026-05-11' });
    expect(out).toHaveLength(1);
  });

  it('>= 与 between 同样命中', async () => {
    stubRead();
    expect(
      await adapter.queryRecords(config, {
        日期: { op: '>=', value: '2026-05-01' },
      }),
    ).toHaveLength(1);

    stubRead();
    expect(
      await adapter.queryRecords(config, {
        日期: { op: 'between', value: ['2026-05-01', '2026-05-31'] },
      }),
    ).toHaveLength(1);
  });

  it('区间外的日期仍然筛不出来（不是"全都命中"式的假阳性）', async () => {
    stubRead();
    expect(
      await adapter.queryRecords(config, { 日期: '2026-05-12' }),
    ).toHaveLength(0);

    stubRead();
    expect(
      await adapter.queryRecords(config, {
        日期: { op: 'between', value: ['2026-06-01', '2026-06-30'] },
      }),
    ).toHaveLength(0);
  });

  it('渲染成 2026/05/11，而不是带时分秒的原始串', async () => {
    stubRead();
    const [record] = await adapter.queryRecords(config, {});
    expect(fieldToStringRaw(record?.fields.日期, 'date')).toBe('2026/05/11');
  });
});
