import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptFeishuEvent,
  encryptFeishuEvent,
  eventSignature,
  verifyEventSignature,
} from '@/modules/im-bot/channels/feishu-crypto';

const KEY = 'test-encrypt-key';

describe('飞书事件加解密', () => {
  it('往返：加密再解密拿回原文', () => {
    const payload = JSON.stringify({
      header: { event_id: 'ev-1' },
      中文: '值',
    });
    expect(decryptFeishuEvent(encryptFeishuEvent(payload, KEY), KEY)).toBe(
      payload,
    );
  });

  it('iv 不同则密文不同（同一明文不会给出固定密文）', () => {
    const a = encryptFeishuEvent('x', KEY);
    const b = encryptFeishuEvent('x', KEY);
    expect(a).not.toBe(b);
    expect(decryptFeishuEvent(a, KEY)).toBe('x');
    expect(decryptFeishuEvent(b, KEY)).toBe('x');
  });

  it('★ key 是 sha256(encryptKey) —— 不是 base64 解码（与企微那套不同）', () => {
    // 写错这一步只表现为"解出乱码"，很难定位
    const iv = Buffer.alloc(16, 7);
    const keyHash = crypto.createHash('sha256').update(KEY).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
    const body = Buffer.concat([
      cipher.update(Buffer.from('hello', 'utf8')),
      cipher.final(),
    ]);
    const manual = Buffer.concat([iv, body]).toString('base64');
    expect(manual).toBe(encryptFeishuEvent('hello', KEY, iv));
    expect(decryptFeishuEvent(manual, KEY)).toBe('hello');
  });

  it('key 不对时抛错，不会静默给出乱码', () => {
    const encrypted = encryptFeishuEvent('hello', KEY);
    expect(() => decryptFeishuEvent(encrypted, 'wrong-key')).toThrow();
  });

  it('iv 必须 16 字节', () => {
    expect(() => encryptFeishuEvent('x', KEY, Buffer.alloc(8))).toThrow(/16/);
  });
});

describe('eventSignature', () => {
  it('sha256(timestamp + nonce + encryptKey + body) 的 hex，无分隔符、不排序', () => {
    // 与企微的「四元素排序后 sha1」是两套东西，别互相抄
    const expected = crypto
      .createHash('sha256')
      .update(`17800000001nonce${KEY}{"a":1}`)
      .digest('hex');
    expect(eventSignature('17800000001', 'nonce', KEY, '{"a":1}')).toBe(
      expected,
    );
  });

  it('★ body 差一个字节，签名就完全不同', () => {
    const a = eventSignature('1', 'n', KEY, '{"op":"新增"}');
    const b = eventSignature('1', 'n', KEY, '{"op":"删除"}');
    expect(a).not.toBe(b);
  });

  it('timestamp / nonce 参与签名', () => {
    const base = eventSignature('1', 'n', KEY, '{}');
    expect(eventSignature('2', 'n', KEY, '{}')).not.toBe(base);
    expect(eventSignature('1', 'm', KEY, '{}')).not.toBe(base);
  });
});

describe('verifyEventSignature', () => {
  it('相等为 true，不等为 false', () => {
    const sig = eventSignature('1', 'n', KEY, '{}');
    expect(verifyEventSignature(sig, sig)).toBe(true);
    expect(verifyEventSignature(sig, `${sig.slice(0, -1)}0`)).toBe(false);
  });

  it('长度不同直接 false（timingSafeEqual 会对不等长抛错）', () => {
    expect(verifyEventSignature('abc', 'abcd')).toBe(false);
    expect(verifyEventSignature('', 'x')).toBe(false);
  });
});
