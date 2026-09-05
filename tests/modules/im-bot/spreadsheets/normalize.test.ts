// cspell:ignore wwgroup
import { describe, expect, it } from 'vitest';
import {
  normalizeCell,
  normalizeFields,
  scalarOf,
} from '@/modules/im-bot/spreadsheets/normalize';

describe('normalizeCell — 标量原样', () => {
  it('字符串 / 数字 / 布尔不动', () => {
    expect(normalizeCell('门户')).toBe('门户');
    expect(normalizeCell(123.45)).toBe(123.45);
    expect(normalizeCell(1778472000000)).toBe(1778472000000);
    expect(normalizeCell(true)).toBe(true);
    expect(normalizeCell(false)).toBe(false);
  });

  it('null / undefined → 空串（下游渲染统一按空处理）', () => {
    expect(normalizeCell(null)).toBe('');
    expect(normalizeCell(undefined)).toBe('');
  });

  it('空数组 → 空串', () => {
    expect(normalizeCell([])).toBe('');
  });
});

describe('normalizeCell — 文本段数组', () => {
  it('单段 → 字符串', () => {
    expect(normalizeCell([{ text: '门户', type: 'text' }])).toBe('门户');
  });

  it('多段拼成一句话（正文 + @提及）', () => {
    expect(
      normalizeCell([
        { text: '门户', type: 'text' },
        { text: '@张三', type: 'mention' },
      ]),
    ).toBe('门户 @张三');
  });

  it('{name} / {userName} 同样能取到显示文本', () => {
    expect(normalizeCell([{ name: '张三' }])).toBe('张三');
    expect(normalizeCell([{ userName: '李四' }])).toBe('李四');
  });
});

describe('normalizeCell — 有身份的条目保留数组', () => {
  it('多个 {id,text} 选项 → 字符串数组', () => {
    expect(
      normalizeCell([
        { id: 'opt1', text: '门户' },
        { id: 'opt2', text: '督导' },
      ]),
    ).toEqual(['门户', '督导']);
  });

  it('多个 {id,name} 人员 → 姓名数组', () => {
    expect(
      normalizeCell([
        { id: 'ou_1', name: '张三' },
        { id: 'ou_2', name: '李四' },
      ]),
    ).toEqual(['张三', '李四']);
  });

  it('多个 {userId,userName} → 姓名数组', () => {
    expect(
      normalizeCell([
        { userId: 'a', userName: '张三' },
        { userId: 'b', userName: '李四' },
      ]),
    ).toEqual(['张三', '李四']);
  });

  it('★ 单成员也保持数组 —— 与飞书的 ["门户"] 同形', () => {
    // 以前单个降标量：企微 [{id,text:'门户'}] 归一成 '门户'、飞书同一列的
    // ['门户'] 归一成 ['门户']，于是 {业务域:'门户'} 一个平台命中、
    // 另一个不命中。record-filter 对数组走成员命中，保持数组两边才一致。
    expect(normalizeCell([{ id: 'opt1', text: '门户' }])).toEqual(['门户']);
    expect(normalizeCell([{ userId: 'a', userName: '张三' }])).toEqual([
      '张三',
    ]);
  });

  it('字符串数组（飞书多选）保持数组', () => {
    expect(normalizeCell(['门户', '督导'])).toEqual(['门户', '督导']);
    expect(normalizeCell(['门户'])).toEqual(['门户']);
  });
});

describe('normalizeCell — 企微复合类型不会拍成 [object Object]', () => {
  // 官方 CellValue 契约：image/attachment `[{id,title,imageUrl|fileUrl}]`、
  // reference `[{record_id}]`、wwgroup `[{chat_id}]`。以前这些元素取不到
  // text 就走 String(obj) —— 全部拍成 "[object Object]"，两个不同的附件
  // 被判定相等，筛选和分组静默给错答案。
  const noObjectObject = (v: unknown) =>
    expect(JSON.stringify(v)).not.toContain('[object Object]');

  it('attachment ×2 → title 数组', () => {
    const out = normalizeCell([
      { id: 'f1', title: '合同.pdf', fileUrl: 'https://x/1' },
      { id: 'f2', title: '发票.png', imageUrl: 'https://x/2' },
    ]);
    expect(out).toEqual(['合同.pdf', '发票.png']);
    noObjectObject(out);
  });

  it('attachment ×1 也保持数组（与多个同形）', () => {
    const out = normalizeCell([
      { id: 'f1', title: '合同.pdf', fileUrl: 'https://x/1' },
    ]);
    expect(out).toEqual(['合同.pdf']);
    noObjectObject(out);
  });

  it('reference ×2 → 认不出显示值时退回 JSON，而不是 [object Object]', () => {
    const out = normalizeCell([
      { record_id: 'rec1' },
      { record_id: 'rec2' },
    ]) as string[];
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('rec1');
    noObjectObject(out);
  });

  it('wwgroup ×2 同理', () => {
    const out = normalizeCell([
      { chat_id: 'chat1' },
      { chat_id: 'chat2' },
    ]) as string[];
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('chat2');
    noObjectObject(out);
  });

  it('url ×2 用「、」分隔，比空格更像两个条目', () => {
    expect(
      normalizeCell([
        { text: '官网', link: 'https://a' },
        { text: '文档', link: 'https://b' },
      ]),
    ).toBe('官网、文档');
  });
});

describe('normalizeCell — 企微日期串归一成毫秒（P0：筛选恒 0 条）', () => {
  // 企微写入的是 "YYYY-MM-DD HH:mm:ss"，读回也是同一个串；飞书/钉钉是裸毫秒。
  // 不收口的话 record-filter 的 actualMs 认不出，企微上所有日期筛选恒 0 条。
  const may11 = new Date('2026-05-11T00:00:00+08:00').getTime();

  it('"YYYY-MM-DD HH:mm:ss" → 毫秒（按 CST 解析）', () => {
    expect(normalizeCell('2026-05-11 00:00:00')).toBe(may11);
    expect(normalizeCell('2026-05-11 12:30')).toBe(
      new Date('2026-05-11T12:30:00+08:00').getTime(),
    );
    expect(normalizeCell('2026-05-11T00:00:00')).toBe(may11);
  });

  it('纯 YYYY-MM-DD 不转 —— 归一化层拿不到 displayType，文本列里的期号要原样保留', () => {
    expect(normalizeCell('2026-05-11')).toBe('2026-05-11');
  });

  it('普通文本不受影响', () => {
    expect(normalizeCell('2026/05/11 00:00:00')).toBe('2026/05/11 00:00:00');
    expect(normalizeCell('督导2.0')).toBe('督导2.0');
  });

  it('日期串藏在复合值里也收口', () => {
    expect(normalizeCell([{ text: '2026-05-11 00:00:00' }])).toBe(may11);
  });
});

describe('normalizeCell — 单元素标量数组', () => {
  it('公式列 {type,value:[26.612]} → 数字，toNumeric 才算得到', () => {
    expect(normalizeCell({ type: 2, value: [26.612] })).toBe(26.612);
    expect(normalizeCell({ type: 2, value: [true] })).toBe(true);
  });

  it('单元素字符串数组仍是数组 —— 那是只选了一项的多选，不是公式结果', () => {
    expect(normalizeCell(['门户'])).toEqual(['门户']);
  });
});

describe('normalizeCell — 飞书 link 字段的显示值', () => {
  // 官方 search 示例里只给 link_record_ids，但字段配置不同的表实测会带上
  // text / text_arr。有显示值就用显示值 —— 群里看到「督导2.0」远好过一串 record_id
  it('带 text_arr 时用显示值', () => {
    expect(
      normalizeCell({
        link_record_ids: ['rec1', 'rec2'],
        text_arr: ['督导2.0', '门户'],
      }),
    ).toEqual(['督导2.0', '门户']);
  });

  it('带 text（单值）时用显示值', () => {
    expect(normalizeCell({ link_record_ids: ['rec1'], text: '督导2.0' })).toBe(
      '督导2.0',
    );
  });

  it('不带显示值时退回 record_id 数组（至少 contains 能命中）', () => {
    expect(normalizeCell({ link_record_ids: ['rec1', 'rec2'] })).toEqual([
      'rec1',
      'rec2',
    ]);
  });

  it('text_arr 是空数组时同样退回 record_id', () => {
    expect(normalizeCell({ link_record_ids: ['rec1'], text_arr: [] })).toEqual([
      'rec1',
    ]);
  });
});

describe('scalarOf — record-filter 与 field-render 共用的取值口', () => {
  it('text / name / userName / title 都认', () => {
    expect(scalarOf({ text: 'a' })).toBe('a');
    expect(scalarOf({ name: 'b' })).toBe('b');
    expect(scalarOf({ userName: 'c' })).toBe('c');
    expect(scalarOf({ title: 'd.pdf' })).toBe('d.pdf');
  });

  it('老版类型化单元格的标量键也认', () => {
    expect(scalarOf({ type: 'number', number: 42 })).toBe(42);
    expect(scalarOf({ checkbox: false })).toBe(false);
  });

  it('非普通对象与认不出的对象一律 null，由调用方决定兜底', () => {
    expect(scalarOf('门户')).toBeNull();
    expect(scalarOf(['a'])).toBeNull();
    expect(scalarOf(null)).toBeNull();
    expect(scalarOf({ foo: 1 })).toBeNull();
  });
});

describe('normalizeCell — 复合对象', () => {
  it('{link_record_ids} → record_id 字符串数组', () => {
    // 飞书 search 的关联字段只给 record_id，不给显示值
    expect(normalizeCell({ link_record_ids: ['rec1', 'rec2'] })).toEqual([
      'rec1',
      'rec2',
    ]);
  });

  it('{value:[...]} 递归展开（公式 / lookup）', () => {
    expect(
      normalizeCell({ type: 1, value: [{ text: '108', type: 'text' }] }),
    ).toBe('108');
  });

  it('{text} 对象 → text', () => {
    expect(normalizeCell({ text: '门户' })).toBe('门户');
  });

  it('早期企微类型化单元格的标量键仍能取到', () => {
    expect(normalizeCell([{ type: 'number', number: 42 }])).toBe(42);
    expect(normalizeCell([{ type: 'checkbox', checkbox: false }])).toBe(false);
    expect(normalizeCell([{ type: 'date', date: 1778472000000 }])).toBe(
      1778472000000,
    );
  });

  it('认不出的复合值原样交回，交给 field-render 兜底', () => {
    const weird = { foo: 1, bar: 2 };
    expect(normalizeCell(weird)).toBe(weird);
  });
});

describe('normalizeFields', () => {
  it('整行逐字段归一化', () => {
    expect(
      normalizeFields({
        名称: [{ text: 'A', type: 'text' }],
        标签: ['x', 'y'],
        金额: 100,
        关联: { link_record_ids: ['rec1'] },
      }),
    ).toEqual({ 名称: 'A', 标签: ['x', 'y'], 金额: 100, 关联: ['rec1'] });
  });
});
