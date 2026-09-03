import { describe, expect, it } from 'vitest';
import {
  clampReply,
  clampReplyBytes,
  fieldMeta,
  fieldToString,
  MASKED_PLACEHOLDER,
  primaryKeyOf,
  renderFieldEntry,
  renderRecordSummary,
  utf8ByteLength,
} from '@/modules/im-bot/core/field-render';
import type { FieldMappingValue } from '@/modules/im-bot/core/types';

describe('renderFieldEntry — sensitive 标记生效', () => {
  it('fieldMapping 显式 sensitive:true 时脱敏（字段名不含敏感关键字）', () => {
    // 回归：以前 renderFieldEntry 只读 label/displayType，从不读 sensitive，
    // 导致 admin 勾了「手机号」仍被明文发到群里
    const mapping: Record<string, FieldMappingValue> = {
      手机号: { name: '手机号', type: 'plain', sensitive: true },
    };
    expect(renderFieldEntry('手机号', '13800138000', mapping).display).toBe(
      MASKED_PLACEHOLDER,
    );
  });

  it('link / multiSelect 字段的 sensitive 同样生效', () => {
    const mapping: Record<string, FieldMappingValue> = {
      负责人: {
        name: '负责人',
        type: 'link',
        linkTableId: 't',
        displayField: 'd',
        sensitive: true,
      },
      标签: { name: '标签', type: 'multiSelect', sensitive: true },
    };
    expect(renderFieldEntry('负责人', '张三', mapping).display).toBe(
      MASKED_PLACEHOLDER,
    );
    expect(renderFieldEntry('标签', ['内部'], mapping).display).toBe(
      MASKED_PLACEHOLDER,
    );
  });

  it('未标记 sensitive 且字段名无关键字时正常输出', () => {
    const mapping: Record<string, FieldMappingValue> = {
      项目名称: { name: '项目名称', type: 'plain' },
    };
    expect(renderFieldEntry('项目名称', '督导2.0', mapping).display).toBe(
      '督导2.0',
    );
  });

  it('字段名启发式仍然兜底（admin 忘勾也不泄漏）', () => {
    expect(renderFieldEntry('登录password', 'p@ss').display).toBe(
      MASKED_PLACEHOLDER,
    );
  });

  it('空值不会被脱敏成占位符', () => {
    const mapping: Record<string, FieldMappingValue> = {
      手机号: { name: '手机号', type: 'plain', sensitive: true },
    };
    expect(renderFieldEntry('手机号', '', mapping).display).toBe('');
  });
});

describe('fieldMeta', () => {
  it('字符串 mapping 退化为 label=key、不敏感', () => {
    expect(fieldMeta('a', { a: 'a' })).toEqual({
      label: 'a',
      sensitive: false,
    });
  });

  it('label 为空串时回退到 logicalKey', () => {
    expect(
      fieldMeta('a', { a: { name: 'a', type: 'plain', label: '' } }).label,
    ).toBe('a');
  });

  it('displayType 只对 plain 生效', () => {
    expect(
      fieldMeta('a', { a: { name: 'a', type: 'plain', displayType: 'number' } })
        .displayType,
    ).toBe('number');
    expect(
      fieldMeta('t', { t: { name: 't', type: 'multiSelect' } }).displayType,
    ).toBeUndefined();
  });
});

describe('renderRecordSummary — 候选列表单行摘要', () => {
  const mapping: Record<string, FieldMappingValue> = {
    项目名称: '项目名称',
    手机号: { name: '手机号', type: 'plain', sensitive: true },
    备注: '备注',
  };

  it('按 fieldMapping 顺序输出，且脱敏生效', () => {
    const s = renderRecordSummary(
      { 备注: 'x', 手机号: '13800138000', 项目名称: '督导2.0' },
      mapping,
    );
    expect(s.startsWith('项目名称=督导2.0')).toBe(true);
    expect(s).toContain(`手机号=${MASKED_PLACEHOLDER}`);
    expect(s).not.toContain('13800138000');
  });

  it('长文本被单字段截断，不会整段塞进群消息', () => {
    const s = renderRecordSummary({ 备注: 'a'.repeat(5000) }, mapping);
    expect(s.length).toBeLessThan(400);
    expect(s).toContain('已截断');
  });

  it('限制字段个数，避免一行刷屏', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`f${i}`, `v${i}`]),
    );
    const s = renderRecordSummary(wide, undefined, 4);
    expect(s.split(' / ')).toHaveLength(4);
  });

  it('全空字段给出可读占位而非空串', () => {
    expect(renderRecordSummary({ a: '', b: null }, undefined)).toBe(
      '（全部字段为空）',
    );
  });

  it('mapping 外的额外字段仍会参与渲染', () => {
    const s = renderRecordSummary({ 未映射列: 'v' }, mapping);
    expect(s).toContain('未映射列=v');
  });
});

describe('clampReply', () => {
  it('超长文本截断并提示', () => {
    const out = clampReply('x'.repeat(25_000));
    expect(out.length).toBeLessThan(21_000);
    expect(out).toContain('消息过长已截断');
  });

  it('正常长度原样返回', () => {
    expect(clampReply('短消息')).toBe('短消息');
  });
});

describe('clampReplyBytes — 按 UTF-8 字节截断', () => {
  it('未超限时原样返回', () => {
    expect(clampReplyBytes('短消息', 2048)).toBe('短消息');
  });

  it('按字节而非字符判定：一个汉字算 3 字节', () => {
    // 回归：以前只有按字符的全局阈值(20000)，20000 个汉字 = 60KB，
    // 在企微(2048 字节)侧整条发不出去，用户一条回复都收不到
    expect(utf8ByteLength('汉')).toBe(3);
    const long = '汉'.repeat(1000); // 3000 字节，字符数只有 1000
    const out = clampReplyBytes(long, 2048);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(2048);
    expect(out).toContain('已截断');
  });

  it('不会把多字节字符切成半个', () => {
    // 上限落在一个汉字中间：应整字丢弃而不是产生乱码
    const out = clampReplyBytes('汉'.repeat(10), 20);
    expect(out.includes('�')).toBe(false);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(20);
  });

  it('不会切断代理对（emoji 占 4 字节）', () => {
    const out = clampReplyBytes('🎉'.repeat(10), 30);
    // 只允许成对出现的代理项，出现落单的高位/低位即说明被从中间切开
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(out)).toBe(false);
    expect(out).toBe('🎉'.repeat(7)); // 30 字节放得下 7 个整 emoji
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(30);
  });

  it('上限小到放不下提示语时只做硬截断', () => {
    const out = clampReplyBytes('汉'.repeat(10), 6);
    expect(out).toBe('汉汉');
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(6);
  });
});

describe('主标识与浮点噪声（P0/P1）', () => {
  // 模拟 jsonb 读回来的键序：Postgres 按「键长度 + 字节序」重排，
  // 写进去的「商品名称, 支出分类, …」变成下面这样
  const jsonbOrdered: Record<string, FieldMappingValue> = {
    利润: { name: '利润', type: 'plain', displayType: 'number' },
    备注: { name: '备注', type: 'plain', displayType: 'text' },
    日期: { name: '日期', type: 'plain', displayType: 'date' },
    月份: { name: '月份', type: 'plain', displayType: 'text' },
    商品名称: { name: '商品名称', type: 'plain', displayType: 'text' },
    支出金额: { name: '支出金额', type: 'plain', displayType: 'number' },
  };
  const record = {
    利润: -108,
    备注: '订单号：5116777000035406',
    日期: new Date('2026-01-03T00:00:00+08:00').getTime(),
    月份: '1月',
    商品名称: '韩束紧致抚纹精华乳100ml',
    支出金额: 108,
  };

  it('primaryKeyOf 取显式声明的主标识', () => {
    expect(primaryKeyOf(jsonbOrdered)).toBeUndefined();
    expect(
      primaryKeyOf({
        ...jsonbOrdered,
        商品名称: {
          name: '商品名称',
          type: 'plain',
          displayType: 'text',
          primary: true,
        },
      }),
    ).toBe('商品名称');
  });

  it('声明了 primary 的字段排在摘要最前', () => {
    const withPrimary: Record<string, FieldMappingValue> = {
      ...jsonbOrdered,
      商品名称: {
        name: '商品名称',
        type: 'plain',
        displayType: 'text',
        primary: true,
      },
    };

    const summary = renderRecordSummary(record, withPrimary);

    // 回归：不声明 primary 时，jsonb 键序会让删除确认展示成
    // 「利润=-108 / 备注=… / 日期=… / 月份=1月」，看不到商品名称
    expect(summary.startsWith('商品名称=韩束紧致抚纹精华乳100ml')).toBe(true);
    // 主标识占掉第一格，其余字段顺次跟上（仍受 maxFields 限制）
    expect(summary.split(' / ')).toHaveLength(4);
  });

  it('没声明 primary 时行为不变（不引入回归）', () => {
    expect(renderRecordSummary(record, jsonbOrdered)).toBe(
      '利润=-108 / 备注=订单号：5116777000035406 / 日期=2026/01/03 / 月份=1月',
    );
  });

  it('公式字段的浮点残留被收敛，真实精度不变', () => {
    const t = (v: number) => fieldToString(v, 'number');
    expect(t(26.612000000000023)).toBe('26.612');
    expect(t(8.729999999999997)).toBe('8.73');
    expect(t(2.4999999999999982)).toBe('2.5');
    // 真实精度不能被抹掉
    expect(t(172.188)).toBe('172.188');
    expect(t(0.0001)).toBe('0.0001');
    expect(t(108)).toBe('108');
    expect(t(-108)).toBe('-108');
  });
});
