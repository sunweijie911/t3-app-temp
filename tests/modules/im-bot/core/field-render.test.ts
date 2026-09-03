import { describe, expect, it } from 'vitest';
import {
  clampReply,
  fieldMeta,
  MASKED_PLACEHOLDER,
  renderFieldEntry,
  renderRecordSummary,
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
