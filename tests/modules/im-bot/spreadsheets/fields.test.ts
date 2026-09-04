// cspell:ignore multiselect autonumber duplexlink
import { describe, expect, it } from 'vitest';
import { __testing } from '@/modules/im-bot/spreadsheets/fields';

const { normalizeType, suggestType, suggestDisplayType, digOptions } =
  __testing;

describe('normalizeType — 抹平三家的类型名写法', () => {
  it('去掉企微的 FIELD_TYPE_ 前缀与下划线', () => {
    expect(normalizeType('FIELD_TYPE_MULTI_SELECT')).toBe('multiselect');
    expect(normalizeType('FIELD_TYPE_DATE_TIME')).toBe('datetime');
  });
  it('飞书的驼峰 ui_type 原样小写', () => {
    expect(normalizeType('DuplexLink')).toBe('duplexlink');
    expect(normalizeType('AutoNumber')).toBe('autonumber');
  });
  it('钉钉的小写类型名不受影响', () => {
    expect(normalizeType('number')).toBe('number');
  });
});

describe('suggestType — 映射类型推断三家必须一致', () => {
  it('关联类 → link', () => {
    for (const t of ['SingleLink', 'DuplexLink', 'link', 'FIELD_TYPE_LINK']) {
      expect(suggestType(t)).toBe('link');
    }
  });
  it('多选类 → multiSelect', () => {
    for (const t of ['MultiSelect', 'FIELD_TYPE_MULTI_SELECT', 'multiSelect']) {
      expect(suggestType(t)).toBe('multiSelect');
    }
  });
  it('property.multiple 也算多选（飞书）', () => {
    expect(suggestType('Text', true)).toBe('multiSelect');
  });
  it('其余一律 plain', () => {
    for (const t of ['Text', 'FIELD_TYPE_TEXT', 'number', '']) {
      expect(suggestType(t)).toBe('plain');
    }
  });
});

describe('suggestDisplayType — 决定值写进平台的形状，三家不能分叉', () => {
  // displayType 直接决定 "2026-05-11" 是被转成毫秒时间戳还是当字符串写，
  // 见 field-types.ts。同一列换个 provider 推断出不同结果 = 写出不同的数据。
  it('时刻类 → date', () => {
    for (const t of [
      'DateTime',
      'CreatedTime',
      'ModifiedTime',
      'FIELD_TYPE_DATE_TIME',
      'date',
    ]) {
      expect(suggestDisplayType(t)).toBe('date');
    }
  });
  it('数量类 → number', () => {
    for (const t of [
      'Number',
      'Currency',
      'Progress',
      'Rating',
      'AutoNumber',
      'FIELD_TYPE_NUMBER',
    ]) {
      expect(suggestDisplayType(t)).toBe('number');
    }
  });
  it('其余 → text（文本列里的 2026-05-11 不能被写成时间戳）', () => {
    for (const t of ['Text', 'SingleSelect', 'FIELD_TYPE_TEXT', '']) {
      expect(suggestDisplayType(t)).toBe('text');
    }
  });
});

describe('digOptions — 宽容探测三家不同的 options 挂载位置', () => {
  it('飞书 property.options[].name', () => {
    expect(
      digOptions({
        property: { options: [{ name: '进货' }, { name: '美妆' }] },
      }),
    ).toEqual(['进货', '美妆']);
  });
  it('企微 property.select.options[].text', () => {
    expect(
      digOptions({
        property: {
          select: { options: [{ text: '已发货' }, { text: '待发' }] },
        },
      }),
    ).toEqual(['已发货', '待发']);
  });
  it('钉钉顶层 options', () => {
    expect(digOptions({ options: [{ name: 'A' }] })).toEqual(['A']);
  });
  it('纯字符串数组也认', () => {
    expect(digOptions({ property: { options: ['A', 'B'] } })).toEqual([
      'A',
      'B',
    ]);
  });
  it('挖不到就返回 undefined，而不是让整次拉取失败', () => {
    expect(digOptions({ property: { formatter: '0.00' } })).toBeUndefined();
    expect(digOptions({})).toBeUndefined();
  });
  it('空名与空数组按"没有选项"处理', () => {
    expect(digOptions({ property: { options: [] } })).toBeUndefined();
    expect(
      digOptions({ property: { options: [{ name: '  ' }] } }),
    ).toBeUndefined();
  });
});
