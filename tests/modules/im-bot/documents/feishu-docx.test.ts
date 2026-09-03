import { describe, expect, it } from 'vitest';
import {
  documentUrl,
  stripLeadingTitle,
  textToBlocks,
} from '@/modules/im-bot/documents/feishu-docx';

describe('textToBlocks — 纯文本转飞书 docx 文本块', () => {
  it('单行文本 → 一个 block_type=2 的文本块', () => {
    const blocks = textToBlocks('今天完成了督导2.0 联调');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block_type).toBe(2);
    expect(blocks[0]?.text.elements[0]?.text_run.content).toBe(
      '今天完成了督导2.0 联调',
    );
  });

  it('多行文本按行拆成多个段落', () => {
    const blocks = textToBlocks('第一条\n第二条\n第三条');
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text.elements[0]?.text_run.content)).toEqual([
      '第一条',
      '第二条',
      '第三条',
    ]);
  });

  it('空行被跳过（飞书空文本块会渲染成多余空段）', () => {
    const blocks = textToBlocks('第一条\n\n\n第二条\n   \n');
    expect(blocks).toHaveLength(2);
  });

  it('每行首尾空白被裁掉', () => {
    const blocks = textToBlocks('  有空格  ');
    expect(blocks[0]?.text.elements[0]?.text_run.content).toBe('有空格');
  });

  it('全空白输入 → 空数组（调用方据此报错，不发空请求）', () => {
    expect(textToBlocks('   \n  \n ')).toEqual([]);
  });

  it('style 字段必须存在（飞书要求该键，缺失会报参数错误）', () => {
    expect(textToBlocks('x')[0]?.text.style).toEqual({});
  });
});

describe('documentUrl', () => {
  it('拼出可点击的飞书文档链接', () => {
    expect(documentUrl('doccnXXXX')).toBe('https://feishu.cn/docx/doccnXXXX');
  });
});

describe('stripLeadingTitle — raw_content 会把标题当正文第一行', () => {
  it('首行等于标题时剥掉', () => {
    expect(stripLeadingTitle('周报\n本周完成联调\n', '周报')).toBe(
      '本周完成联调\n',
    );
  });

  it('标题两侧有空白也能匹配', () => {
    expect(stripLeadingTitle('  周报  \n正文', '周报')).toBe('正文');
  });

  it('首行不等于标题时原样返回（不误删正文）', () => {
    expect(stripLeadingTitle('本周完成联调\n周报', '周报')).toBe(
      '本周完成联调\n周报',
    );
  });

  it('正文里后面出现同名文字不受影响', () => {
    expect(stripLeadingTitle('周报\n这份周报很重要', '周报')).toBe(
      '这份周报很重要',
    );
  });

  it('整篇只有标题一行 → 空正文', () => {
    expect(stripLeadingTitle('周报', '周报')).toBe('');
  });

  it('空标题时不做任何处理', () => {
    expect(stripLeadingTitle('内容', '')).toBe('内容');
  });

  it('空正文不炸', () => {
    expect(stripLeadingTitle('', '周报')).toBe('');
  });
});
