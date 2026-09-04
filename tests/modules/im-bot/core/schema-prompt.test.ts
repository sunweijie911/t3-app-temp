import { describe, expect, it } from 'vitest';
import { renderResourceSchema } from '@/modules/im-bot/core/schema-prompt';
import type { ResourceBinding } from '@/modules/im-bot/core/types';
import { sceneResourceOf } from '@/modules/im-bot/core/types';

const tableBinding: ResourceBinding = {
  alias: '项目台账表',
  kind: 'table',
  provider: 'feishu',
  workspaceId: 'app1',
  resourceId: 't1',
  isDefault: true,
  uniqueKey: '项目名称',
  fieldMapping: {
    项目名称: '项目名称',
    业务域: { name: '业务域', type: 'multiSelect' },
    部署学校: {
      name: '部署学校',
      type: 'link',
      linkTableId: 'tbl2',
      displayField: '学校名',
    },
    上线日期: { name: '上线日期', type: 'plain', displayType: 'date' },
    合同金额: { name: '合同金额', type: 'plain', displayType: 'number' },
    登录密码: { name: '登录密码', type: 'plain', sensitive: true },
  },
};

describe('sceneResourceOf', () => {
  it('按 kind 带出可用动词，按映射类型带出取值提示', () => {
    const r = sceneResourceOf(tableBinding);
    expect(r.actions).toEqual(['CREATE', 'UPDATE', 'QUERY', 'DELETE']);
    expect(r.uniqueKey).toBe('项目名称');
    const byKey = Object.fromEntries(r.fields.map((f) => [f.key, f]));
    expect(byKey.业务域?.hint).toContain('多选');
    expect(byKey.部署学校?.hint).toContain('学校名');
    expect(byKey.上线日期?.hint).toContain('YYYY-MM-DD');
    expect(byKey.合同金额?.hint).toContain('数字');
    expect(byKey.登录密码?.sensitive).toBe(true);
  });

  it('普通字符串映射不硬猜类型（避免误导 LLM 给数字加引号）', () => {
    const r = sceneResourceOf(tableBinding);
    expect(r.fields.find((f) => f.key === '项目名称')?.hint).toBeUndefined();
  });

  it('doc 资源只带文档动词', () => {
    const r = sceneResourceOf({
      ...tableBinding,
      alias: '周报',
      kind: 'doc',
      fieldMapping: {},
    });
    expect(r.actions).toEqual(['READ', 'APPEND', 'QUERY']);
  });
});

describe('renderResourceSchema', () => {
  it('没有绑定时返回空串（prompt 不受影响）', () => {
    expect(renderResourceSchema([])).toBe('');
  });

  it('渲染字段清单、动词与唯一键', () => {
    const out = renderResourceSchema([sceneResourceOf(tableBinding)]);
    expect(out).toContain('「项目台账表」');
    expect(out).toContain('CREATE / UPDATE / QUERY / DELETE');
    expect(out).toContain('- 上线日期（日期，格式 YYYY-MM-DD）');
    expect(out).toContain('登录密码（回复中会脱敏）');
    expect(out).toContain('唯一键：项目名称');
  });

  it('单资源时不提 resource 字段，多资源时才提示怎么选', () => {
    const single = renderResourceSchema([sceneResourceOf(tableBinding)]);
    expect(single).not.toContain('用 resource 字段');

    const multi = renderResourceSchema([
      sceneResourceOf(tableBinding),
      sceneResourceOf({
        ...tableBinding,
        alias: '周报文档',
        kind: 'doc',
        isDefault: false,
        uniqueKey: undefined,
        fieldMapping: {},
      }),
    ]);
    expect(multi).toContain('用 resource 字段');
    expect(multi).toContain('默认资源');
    expect(multi).toContain('fields.content');
  });

  it('file 类型没有可用动词时明说，而不是渲染成空清单', () => {
    const out = renderResourceSchema([
      sceneResourceOf({ ...tableBinding, kind: 'file', fieldMapping: {} }),
    ]);
    expect(out).toContain('暂不支持任何操作');
  });
});

describe('资源类型标签（P1：doc 曾在 prompt 里自称"未实现"）', () => {
  it('doc 资源不再对 LLM 声称未实现，同时给出可用动词', () => {
    const out = renderResourceSchema([
      sceneResourceOf({
        ...tableBinding,
        alias: '周报文档',
        kind: 'doc',
        fieldMapping: {},
      }),
    ]);
    expect(out).toContain('「周报文档」— 文档');
    expect(out).not.toContain('未实现');
    expect(out).toContain('READ / APPEND / QUERY');
  });
});

describe('renderResourceSchema — 单选合法取值（回归）', () => {
  it('把 options 渲染成"只能取"清单，替掉手抄进 prompt 的做法', () => {
    const out = renderResourceSchema([
      {
        alias: '交易明细',
        kind: 'table',
        isDefault: true,
        actions: ['CREATE', 'UPDATE', 'QUERY', 'DELETE'],
        fields: [
          {
            key: '支出分类',
            options: ['美妆产品', '进货', '代购'],
          },
          { key: '备注' },
        ],
      },
    ]);
    expect(out).toContain('只能取：美妆产品 / 进货 / 代购');
    expect(out).toContain('不得自造、不得改写');
    // 没有 options 的字段不产生这一行。注意不能断言 '只能取' ——
    // 字段清单的表头「key 只能取下列字段名」本来就含这三个字
    const afterPlainField = out.slice(out.indexOf('备注'));
    expect(afterPlainField).not.toContain('只能取：');
  });

  it('options 为空数组时不渲染', () => {
    const out = renderResourceSchema([
      {
        alias: 'T',
        kind: 'table',
        isDefault: true,
        actions: ['QUERY'],
        fields: [{ key: 'A', options: [] }],
      },
    ]);
    expect(out).not.toContain('只能取：');
  });
});

describe('sceneResourceOf — options 从 fieldMapping 派生', () => {
  it('plain 与 multiSelect 的 options 都带出来，link 没有这个概念', () => {
    const r = sceneResourceOf({
      alias: 'T',
      kind: 'table',
      provider: 'feishu',
      workspaceId: 'w',
      resourceId: 't',
      isDefault: true,
      fieldMapping: {
        支出分类: {
          name: '支出分类',
          type: 'plain',
          options: ['进货', '代购'],
        },
        标签: { name: '标签', type: 'multiSelect', options: ['A', 'B'] },
        学校: {
          name: '学校',
          type: 'link',
          linkTableId: 'tbl2',
          displayField: '名称',
        },
        备注: '备注',
      },
    });
    const byKey = Object.fromEntries(r.fields.map((f) => [f.key, f.options]));
    expect(byKey.支出分类).toEqual(['进货', '代购']);
    expect(byKey.标签).toEqual(['A', 'B']);
    expect(byKey.学校).toBeUndefined();
    expect(byKey.备注).toBeUndefined();
  });
});
