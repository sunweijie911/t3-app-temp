import { describe, expect, it } from 'vitest';
import type {
  FieldMappingValue,
  ParsedIntent,
} from '@/modules/im-bot/core/types';
import {
  DatabaseDrivenScene,
  type DbSceneConfig,
  parseKeywords,
} from '@/modules/im-bot/scenes/db-scene';

const baseConfig: DbSceneConfig = {
  sceneId: 'sales',
  name: '销售',
  description: '销售记录',
  keywords: ['销售', '订单'],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 字面占位符，由 getSystemPrompt 替换
  systemPrompt: 'today=${today}',
};

function makeScene(overrides: Partial<DbSceneConfig> = {}) {
  return new DatabaseDrivenScene({ ...baseConfig, ...overrides });
}

const intentBase = { confidence: 1, summary: 's' } as const;

describe('parseKeywords', () => {
  it('null / undefined / 空字符串 → 空数组', () => {
    expect(parseKeywords(null)).toEqual([]);
    expect(parseKeywords(undefined)).toEqual([]);
    expect(parseKeywords('')).toEqual([]);
  });

  it('JSON 数组格式', () => {
    expect(parseKeywords('["a", "b"]')).toEqual(['a', 'b']);
  });

  it('JSON 含非字符串成员时过滤掉', () => {
    expect(parseKeywords('["a", 1, null, "b"]')).toEqual(['a', 'b']);
  });

  it('非法 JSON 走逗号分隔 fallback', () => {
    expect(parseKeywords('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('中文逗号同样支持', () => {
    expect(parseKeywords('a，b，c')).toEqual(['a', 'b', 'c']);
  });
});

describe('DatabaseDrivenScene.match', () => {
  it('无关键字时 score=0', () => {
    const s = makeScene({ keywords: [] });
    expect(s.match('hello')).toBe(0);
  });

  it('命中越多得分越高（按命中个数计分）', () => {
    const s = makeScene({ keywords: ['销售', '订单'] });
    expect(s.match('hello 销售')).toBe(1);
    expect(s.match('销售 订单')).toBe(2);
    expect(s.match('hello')).toBe(0);
  });

  it('关键词配得多的场景不会因为命中率低而输给关键词少的场景', () => {
    // 旧实现用 matched/total：detailed 命中 1/5=0.2 会输给 sparse 的 1/1=1.0，
    // 导致"关键词配得越全越难被选中"
    const detailed = makeScene({
      keywords: ['销售', '订单', '成交', '客户', '回款'],
    });
    const sparse = makeScene({ keywords: ['报销'] });
    expect(detailed.match('登记一下销售订单')).toBeGreaterThan(
      sparse.match('登记一下销售订单'),
    );
  });
});

describe('DatabaseDrivenScene.getSystemPrompt', () => {
  it('替换 today / senderName / chatName', () => {
    const s = makeScene({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 字面占位符
      systemPrompt: 'today=${today} u=${senderName} c=${chatName}',
    });
    const out = s.getSystemPrompt({
      today: '2026-05-11',
      senderName: '张三',
      chatName: '群A',
    });
    expect(out).toBe('today=2026-05-11 u=张三 c=群A');
  });

  it('chatName 缺失时替换为空字符串', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 字面占位符
    const s = makeScene({ systemPrompt: 'c=${chatName}!' });
    const out = s.getSystemPrompt({ today: 't', senderName: 'u' });
    expect(out).toBe('c=!');
  });
});

describe('DatabaseDrivenScene.parseResult', () => {
  it('合法 JSON 解析出 intent / fields / filters / projectFields', () => {
    const s = makeScene();
    const r = s.parseResult(
      '{"intent":"QUERY","filters":{"a":1},"projectFields":["b"],"confidence":0.9,"summary":"ok"}',
    );
    expect(r).not.toBeNull();
    expect(r?.intent).toBe('QUERY');
    expect(r?.filters).toEqual({ a: 1 });
    expect(r?.projectFields).toEqual(['b']);
  });

  it('非合法 intent 返回 null', () => {
    const s = makeScene();
    expect(
      s.parseResult(
        '{"intent":"WHAT","fields":{},"confidence":1,"summary":""}',
      ),
    ).toBeNull();
  });

  it('UNKNOWN 是合法 intent', () => {
    const s = makeScene();
    const r = s.parseResult(
      '{"intent":"UNKNOWN","fields":{},"confidence":0.8,"summary":""}',
    );
    expect(r?.intent).toBe('UNKNOWN');
  });

  it('projectFields 为空数组时返回 undefined（不污染下游分支判断）', () => {
    const s = makeScene();
    const r = s.parseResult(
      '{"intent":"QUERY","projectFields":[],"confidence":1,"summary":""}',
    );
    expect(r?.projectFields).toBeUndefined();
  });

  it('projectFields 内非字符串成员被过滤', () => {
    const s = makeScene();
    const r = s.parseResult(
      '{"intent":"QUERY","projectFields":["a",1,null,""],"confidence":1,"summary":""}',
    );
    expect(r?.projectFields).toEqual(['a']);
  });

  it('JSON 解析失败返回 null', () => {
    const s = makeScene();
    expect(s.parseResult('not json')).toBeNull();
  });
});

describe('DatabaseDrivenScene.formatReply — 错误分支', () => {
  it('result.success=false 返回错误', () => {
    const s = makeScene();
    const intent: ParsedIntent = {
      ...intentBase,
      intent: 'CREATE',
      fields: {},
    };
    const reply = s.formatReply(intent, { success: false, error: '失败原因' });
    expect(reply).toBe('❌ 操作失败: 失败原因');
  });

  it('awaitingConfirmation 的挂起提示不显示为「操作失败」', () => {
    // 回归：DELETE 确认 / 单条 UPDATE 确认 / uniqueKey 撞车 / 多条选序号
    // 都走 success=false，以前统一加「❌ 操作失败」，把设计正路显示成报错
    const s = makeScene();
    const intent: ParsedIntent = {
      ...intentBase,
      intent: 'DELETE',
      fields: {},
    };
    const reply = s.formatReply(intent, {
      success: false,
      awaitingConfirmation: true,
      error: '确认删除以下 2 条记录？',
    });
    expect(reply).toBe('⏳ 确认删除以下 2 条记录？');
    expect(reply).not.toContain('操作失败');
  });
});

describe('DatabaseDrivenScene.formatReply — CREATE / UPDATE', () => {
  it('CREATE 渲染所有非空字段', () => {
    const s = makeScene({ name: '销售' });
    const intent: ParsedIntent = {
      ...intentBase,
      intent: 'CREATE',
      fields: {},
    };
    const reply = s.formatReply(intent, {
      success: true,
      record: {
        recordId: 'r1',
        fields: { 商品: '安耐晒', 价格: 45, 备注: '' },
      },
    });
    expect(reply).toContain('✅ 已录入销售');
    expect(reply).toContain('商品：安耐晒');
    expect(reply).toContain('价格：45');
    expect(reply).not.toContain('备注：');
  });

  it('UPDATE 复用字段渲染（不是只输出 "已更新"）', () => {
    const s = makeScene({ name: '项目台账' });
    const intent: ParsedIntent = {
      ...intentBase,
      intent: 'UPDATE',
      fields: {},
    };
    const reply = s.formatReply(intent, {
      success: true,
      record: {
        recordId: 'r1',
        fields: { 项目名称: '督导2.0', 状态: '在用' },
      },
    });
    expect(reply).toContain('✅ 已更新项目台账');
    expect(reply).toContain('项目名称：督导2.0');
    expect(reply).toContain('状态：在用');
  });

  it('UPDATE record 全空字段时退化为简短提示', () => {
    const s = makeScene({ name: '台账' });
    const intent: ParsedIntent = {
      ...intentBase,
      intent: 'UPDATE',
      fields: {},
    };
    const reply = s.formatReply(intent, {
      success: true,
      record: { recordId: 'r1', fields: {} },
    });
    expect(reply).toBe('✅ 已更新台账');
  });
});

describe('DatabaseDrivenScene.formatReply — QUERY 默认渲染', () => {
  it('空结果给提示', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records: [] },
    );
    expect(reply).toContain('未找到匹配');
  });

  it('单条不带【第 N 条】', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      {
        success: true,
        records: [{ recordId: 'r1', fields: { 名称: 'A' } }],
      },
    );
    expect(reply).not.toContain('【第 1 条】');
    expect(reply).toContain('共 1 条');
  });

  it('多条加序号', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      {
        success: true,
        records: [
          { recordId: 'r1', fields: { 名称: 'A' } },
          { recordId: 'r2', fields: { 名称: 'B' } },
        ],
      },
    );
    expect(reply).toContain('【第 1 条】');
    expect(reply).toContain('【第 2 条】');
  });

  it('撞上 adapter 的翻页上限时附加截断提示', () => {
    const s = makeScene();
    const records = Array.from({ length: 1000 }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 名称: `n${i}` },
    }));
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records, hitQueryLimit: true },
    );
    // 不报具体条数：截断由 adapter 上报，钉钉/企微过滤后的条数不等于上限
    expect(reply).toContain('数据量已达单次拉取上限');
  });

  it('条数恰好 1000 但没撞上限时不误报截断', () => {
    // 回归：以前把飞书的 1000 硬编码在渲染层，钉钉/企微的上限并不是 1000，
    // 于是要么该提示时不提示，要么不该提示时乱提示
    const s = makeScene();
    const records = Array.from({ length: 1000 }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 名称: `n${i}` },
    }));
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records },
    );
    expect(reply).not.toContain('数据量已达单次拉取上限');
  });
});

describe('DatabaseDrivenScene.formatReply — QUERY 投影模式', () => {
  it('单条单字段：一句话最简回复', () => {
    const s = makeScene();
    const reply = s.formatReply(
      {
        ...intentBase,
        intent: 'QUERY',
        fields: {},
        projectFields: ['Node版本'],
      },
      {
        success: true,
        records: [
          {
            recordId: 'r1',
            fields: { 项目名称: '总管后台', Node版本: '14.21.3' },
          },
        ],
      },
    );
    expect(reply).toContain('总管后台 → Node版本：14.21.3');
    expect(reply).not.toContain('共 1 条');
  });

  it('多条投影：紧凑列表 + 序号', () => {
    const s = makeScene();
    const reply = s.formatReply(
      {
        ...intentBase,
        intent: 'QUERY',
        fields: {},
        projectFields: ['Node版本'],
      },
      {
        success: true,
        records: [
          { recordId: 'r1', fields: { 项目名称: '总管', Node版本: '14' } },
          { recordId: 'r2', fields: { 项目名称: '前台', Node版本: '18' } },
        ],
      },
    );
    expect(reply).toContain('共 2 条');
    expect(reply).toContain('1. 总管 → Node版本：14');
    expect(reply).toContain('2. 前台 → Node版本：18');
  });

  it('投影字段在记录中为空：提示该字段为空', () => {
    const s = makeScene();
    const reply = s.formatReply(
      {
        ...intentBase,
        intent: 'QUERY',
        fields: {},
        projectFields: ['Node版本'],
      },
      {
        success: true,
        records: [
          { recordId: 'r1', fields: { 项目名称: '总管', Node版本: '' } },
        ],
      },
    );
    expect(reply).toContain('（该字段为空）');
  });
});

describe('DatabaseDrivenScene.formatReply — UNKNOWN', () => {
  it('UNKNOWN 走默认分支输出操作完成', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'UNKNOWN', fields: {} },
      { success: true },
    );
    expect(reply).toBe('✅ 操作完成');
  });
});

describe('label / displayType 渲染', () => {
  const mapping: Record<string, FieldMappingValue> = {
    Node版本: { name: 'Node版本', type: 'plain', label: 'Node 版本' },
    amount: { name: 'amount', type: 'plain', displayType: 'number' },
    createdAt: { name: 'createdAt', type: 'plain', displayType: 'date' },
    项目名称: '项目名称',
  };

  it('CREATE 时优先用 label', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      {
        success: true,
        record: { recordId: 'r1', fields: { Node版本: '14.21.3' } },
      },
      mapping,
    );
    expect(reply).toContain('Node 版本：14.21.3');
    expect(reply).not.toContain('Node版本：14.21.3');
  });

  it('displayType=number 防止金额大数被误判为日期', () => {
    const s = makeScene();
    // 1999999999999 ≈ 2033 年的毫秒数，会落在 DATE_MS 区间触发旧 heuristic
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      {
        success: true,
        record: { recordId: 'r1', fields: { amount: 1999999999999 } },
      },
      mapping,
    );
    expect(reply).toContain('amount：1999999999999');
    expect(reply).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
  });

  it('displayType=date 始终按日期格式化（即使数字落在非日期范围）', () => {
    const s = makeScene();
    const ms = new Date('2026-01-15T00:00:00+08:00').getTime();
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      { success: true, record: { recordId: 'r1', fields: { createdAt: ms } } },
      mapping,
    );
    expect(reply).toMatch(/createdAt：\d{4}\/\d{2}\/\d{2}/);
  });

  it('无 mapping 时退化为 logicalKey + 旧 heuristic（仍能跑）', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      { success: true, record: { recordId: 'r1', fields: { Node版本: '14' } } },
    );
    expect(reply).toContain('Node版本：14');
  });
});

// biome-ignore-start lint/suspicious/noTemplateCurlyInString: 字面占位符
describe('replyTemplate', () => {
  it('${fields.xxx} 占位符替换 + 空行隐藏', () => {
    const s = makeScene({
      replyTemplate: '名称：${fields.name}\n备注：${fields.note}',
    });
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      {
        success: true,
        record: { recordId: 'r1', fields: { name: 'A', note: '' } },
      },
    );
    expect(reply).toContain('名称：A');
    expect(reply).not.toContain('备注：');
  });

  it('<!--each-->...<!--/each--> 循环块', () => {
    const s = makeScene({
      replyTemplate: '<!--each-->名称：${fields.name}<!--/each-->',
    });
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      {
        success: true,
        records: [
          { recordId: 'r1', fields: { name: 'A' } },
          { recordId: 'r2', fields: { name: 'B' } },
        ],
      },
    );
    expect(reply).toContain('【第 1 条】');
    expect(reply).toContain('名称：A');
    expect(reply).toContain('名称：B');
  });
});
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: end

describe('敏感字段脱敏', () => {
  it('字段名含 password 等敏感关键字时自动脱敏', () => {
    const s = makeScene();
    const reply = s.formatReply(
      { ...intentBase, intent: 'CREATE', fields: {} },
      {
        success: true,
        record: {
          recordId: 'r1',
          fields: {
            api_key: 'sk-abc123',
            发版账号: 'admin',
            发版密码: 'secret',
          },
        },
      },
    );
    expect(reply).not.toContain('sk-abc123');
    expect(reply).not.toContain('secret');
    expect(reply).toContain('***（已脱敏）');
    expect(reply).toContain('发版账号：admin');
  });
});

describe('DatabaseDrivenScene.getSystemPrompt — 字段清单自动注入', () => {
  const resource = {
    alias: '项目台账表',
    kind: 'table' as const,
    isDefault: true,
    actions: ['CREATE', 'UPDATE', 'QUERY', 'DELETE'] as const,
    fields: [{ key: '项目名称' }, { key: '上线日期', hint: '日期' }],
    uniqueKey: '项目名称',
  };

  it('管理员 prompt 在前，自动生成的字段清单追加在后', () => {
    const s = makeScene({ systemPrompt: '你是台账助手' });
    const out = s.getSystemPrompt({
      today: '2026-05-11',
      senderName: '张三',
      resources: [resource],
    });
    expect(out.startsWith('你是台账助手')).toBe(true);
    expect(out).toContain('可操作的资源与字段');
    expect(out).toContain('项目名称');
  });

  it('没有 resources 时与改动前完全一致（不追加任何内容）', () => {
    const s = makeScene({ systemPrompt: '你是台账助手' });
    expect(s.getSystemPrompt({ today: '2026-05-11', senderName: '张三' })).toBe(
      '你是台账助手',
    );
  });
});

// biome-ignore-start lint/suspicious/noTemplateCurlyInString: 字面占位符
describe('文档结果不被表格取向的回复模板吃掉（P1）', () => {
  const docIntent: ParsedIntent = {
    ...intentBase,
    intent: 'READ',
    fields: {},
  };

  it('配了 replyTemplate 的场景读文档，仍然渲染标题与正文', () => {
    const s = makeScene({
      replyTemplate: '共 ${count} 条\n${fieldList}',
    });

    const out = s.formatReply(docIntent, {
      success: true,
      doc: { title: '周报', text: '本周进展：完成三件事', url: 'https://x' },
    });

    expect(out).toContain('周报');
    expect(out).toContain('本周进展：完成三件事');
    expect(out).not.toContain('共 0 条');
  });

  it('APPEND 同理：回显写入内容而不是套模板', () => {
    const s = makeScene({ replyTemplate: '共 ${count} 条' });

    const out = s.formatReply(
      { ...intentBase, intent: 'APPEND', fields: {} },
      {
        success: true,
        doc: { title: '周报', text: '', url: 'https://x' },
        appendedText: '新增一行',
      },
    );

    expect(out).toContain('已写入《周报》');
    expect(out).toContain('新增一行');
  });

  it('表格结果仍然走模板（不影响原有行为）', () => {
    const s = makeScene({ replyTemplate: '共 ${count} 条' });

    const out = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records: [{ recordId: 'r1', fields: { a: 'x' } }] },
    );

    expect(out).toBe('共 1 条');
  });
});
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: end

describe('查询截断提示不谎报条数（P0-4 的连带修正）', () => {
  it('过滤后只剩少量记录时，不把返回条数说成"上限"', () => {
    const s = makeScene();

    const out = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      {
        success: true,
        hitQueryLimit: true,
        records: [
          { recordId: 'r1', fields: { a: 'x' } },
          { recordId: 'r2', fields: { a: 'y' } },
        ],
      },
    );

    expect(out).toContain('数据量已达单次拉取上限');
    // 旧文案会渲染成"已达单次查询上限 2 条"
    expect(out).not.toContain('上限 2 条');
  });

  it('没撞上限时不带任何提示', () => {
    const s = makeScene();

    const out = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records: [{ recordId: 'r1', fields: { a: 'x' } }] },
    );

    expect(out).not.toContain('上限');
  });
});

describe('查询投影的主标识不依赖 jsonb 键序（P0）', () => {
  // jsonb 读回来的键序：利润 在最前，商品名称 被排到后面
  const mapping: Record<string, FieldMappingValue> = {
    利润: { name: '利润', type: 'plain', displayType: 'number' },
    日期: { name: '日期', type: 'plain', displayType: 'date' },
    商品名称: {
      name: '商品名称',
      type: 'plain',
      displayType: 'text',
      primary: true,
    },
    支出金额: { name: '支出金额', type: 'plain', displayType: 'number' },
  };
  const records = [
    {
      recordId: 'r1',
      fields: {
        利润: -108,
        日期: new Date('2026-01-03T00:00:00+08:00').getTime(),
        商品名称: '韩束精华',
        支出金额: 108,
      },
    },
  ];

  it('投影模式用 primary 作标识，而不是排在最前的公式列', () => {
    const s = makeScene();

    const out = s.formatReply(
      {
        ...intentBase,
        intent: 'QUERY',
        fields: {},
        projectFields: ['支出金额'],
      },
      { success: true, records },
      mapping,
    );

    // 回归：以前取"记录第一个非空字段"，渲染成「-108 → 支出金额：108」
    expect(out).toContain('韩束精华 → 支出金额：108');
    expect(out).not.toContain('-108 →');
  });

  it('没配 primary 时退化路径也会跳过数字/日期列', () => {
    const s = makeScene();
    const noPrimary: Record<string, FieldMappingValue> = {
      ...mapping,
      商品名称: { name: '商品名称', type: 'plain', displayType: 'text' },
    };

    const out = s.formatReply(
      {
        ...intentBase,
        intent: 'QUERY',
        fields: {},
        projectFields: ['支出金额'],
      },
      { success: true, records },
      noPrimary,
    );

    expect(out).toContain('韩束精华 → 支出金额：108');
  });
});
