import { describe, expect, it } from 'vitest';
import { stripLeadingMention } from '@/modules/im-bot/channels/mention';

describe('stripLeadingMention — 三平台共用的 @机器人 前缀剥离', () => {
  it('剥掉开头的 @昵称 + 空白', () => {
    expect(stripLeadingMention('@小助手 新增项目')).toBe('新增项目');
  });

  it('整条消息只有一个 @ 时剥空 —— 不能让 "@昵称" 残留成业务正文', () => {
    expect(stripLeadingMention('@小助手')).toBe('');
  });

  it('只剥一次，后面的 @ 是业务内容', () => {
    expect(stripLeadingMention('@小助手 @张三的进度')).toBe('@张三的进度');
  });

  it('不以 @ 开头时原样返回（对不加前缀的平台无害）', () => {
    expect(stripLeadingMention('新增项目 督导2.0')).toBe('新增项目 督导2.0');
  });

  it('句中的 @ 不受影响', () => {
    expect(stripLeadingMention('把 @张三 的项目改成完成')).toBe(
      '把 @张三 的项目改成完成',
    );
  });

  it('多个空格也能吃掉', () => {
    expect(stripLeadingMention('@bot    记一笔')).toBe('记一笔');
  });

  it('空串安全', () => {
    expect(stripLeadingMention('')).toBe('');
  });
});
