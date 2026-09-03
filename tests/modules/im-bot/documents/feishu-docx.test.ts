import { describe, expect, it } from 'vitest';
import {
  documentUrl,
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
