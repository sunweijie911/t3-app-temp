import { describe, expect, it } from 'vitest';
import { readExistingMapping } from '@/modules/im-bot/admin/resource-bindings';

/**
 * 「重新拉取字段」必须是合并而不是覆盖。
 *
 * 实测踩到的场景：一张 15 列的财务表，4 个单选列在平台上有合法取值，
 * 但 fieldMapping 是在 options 提取上线之前生成的，一个都没存。
 * 补 options 的唯一办法就是重拉一次 —— 而覆盖式生成会顺手把
 * 「利润」上手工确认过的 displayType=number 冲成推断出来的 text
 * （飞书那列的 ui_type 是 Formula，自动推断只能给 text）。
 * 于是"修一个问题"会静默弄坏另一个。
 */
describe('readExistingMapping — 按平台列名索引已有配置', () => {
  it('对象映射：完整读出可保留的配置项', () => {
    const m = readExistingMapping(
      JSON.stringify({
        利润: { name: '利润', type: 'plain', displayType: 'number' },
        商品名称: {
          name: '商品名称',
          type: 'plain',
          displayType: 'text',
          primary: true,
        },
      }),
    );
    expect(m.get('利润')?.displayType).toBe('number');
    expect(m.get('商品名称')?.primary).toBe(true);
  });

  it('按平台列名索引，不是逻辑键 —— 两者可以不同名', () => {
    const m = readExistingMapping(
      JSON.stringify({ 月份: { name: '统计月份', type: 'plain' } }),
    );
    expect(m.has('统计月份')).toBe(true);
    expect(m.has('月份')).toBe(false);
  });

  it('保留 link 的子表配置（这两个值根本推断不出来）', () => {
    const m = readExistingMapping(
      JSON.stringify({
        部署学校: {
          name: '部署学校',
          type: 'link',
          linkTableId: 'tblXXX',
          displayField: '学校名',
        },
      }),
    );
    expect(m.get('部署学校')).toMatchObject({
      type: 'link',
      linkTableId: 'tblXXX',
      displayField: '学校名',
    });
  });

  it('保留 label —— 平台侧压根没有这个概念', () => {
    const m = readExistingMapping(
      JSON.stringify({
        单号: { name: '物流单号', type: 'plain', label: '快递单号' },
      }),
    );
    expect(m.get('物流单号')?.label).toBe('快递单号');
  });

  it('保留 sensitive', () => {
    const m = readExistingMapping(
      JSON.stringify({
        手机号: { name: '手机号', type: 'plain', sensitive: true },
      }),
    );
    expect(m.get('手机号')?.sensitive).toBe(true);
  });

  it('裸字符串映射除了逻辑键没有别的可保留配置', () => {
    const m = readExistingMapping(JSON.stringify({ 备注: '平台备注列' }));
    expect(m.get('平台备注列')).toEqual({
      logicalKey: '备注',
      type: 'plain',
    });
  });

  // logicalKey 是这份合并里最要紧的一项：uniqueKey、回复模板的
  // ${fields.xxx}、场景 prompt 里的字段名，引用的都是逻辑键。
  // 生成 JSON 时按平台列名重新起键会让它们一起指空，而保存不报错 ——
  // 最直接的后果是 dispatcher 取 createFields[uniqueKey] 得到 undefined，
  // CREATE 查重整段被跳过，重复记录一条条静默写进去。
  it('记住逻辑键，即使它与平台列名不同', () => {
    const m = readExistingMapping(
      JSON.stringify({ 月份: { name: '统计月份', type: 'plain' } }),
    );
    expect(m.get('统计月份')?.logicalKey).toBe('月份');
  });

  it('逻辑键与平台列名相同时也照常记录', () => {
    const m = readExistingMapping(
      JSON.stringify({ 日期: { name: '日期', type: 'plain' } }),
    );
    expect(m.get('日期')?.logicalKey).toBe('日期');
  });

  it('非法 displayType / type 按未配置处理，不带进选择器', () => {
    const m = readExistingMapping(
      JSON.stringify({ x: { name: 'x', type: '乱写', displayType: '乱写' } }),
    );
    expect(m.get('x')?.type).toBe('plain');
    expect(m.get('x')?.displayType).toBeUndefined();
  });

  it('空 / 非法 JSON 退化成空表（回到覆盖式生成，而不是报错卡住）', () => {
    expect(readExistingMapping(undefined).size).toBe(0);
    expect(readExistingMapping('').size).toBe(0);
    expect(readExistingMapping('not json').size).toBe(0);
    expect(readExistingMapping('[]').size).toBe(0);
    expect(readExistingMapping('{}').size).toBe(0);
  });

  it('缺 name 的条目跳过 —— 没有平台列名就无从索引', () => {
    const m = readExistingMapping(JSON.stringify({ x: { type: 'plain' } }));
    expect(m.size).toBe(0);
  });
});
