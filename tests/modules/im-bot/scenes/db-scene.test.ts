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

  it('命中越多得分越高', () => {
    const s = makeScene({ keywords: ['销售', '订单'] });
    expect(s.match('hello 销售')).toBe(0.5);
    expect(s.match('销售 订单')).toBe(1);
    expect(s.match('hello')).toBe(0);
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

  it('1000 条上限附加截断提示', () => {
    const s = makeScene();
    const records = Array.from({ length: 1000 }, (_, i) => ({
      recordId: `r${i}`,
      fields: { 名称: `n${i}` },
    }));
    const reply = s.formatReply(
      { ...intentBase, intent: 'QUERY', fields: {} },
      { success: true, records },
    );
    expect(reply).toContain('已达查询上限');
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
