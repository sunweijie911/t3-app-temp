// cspell:ignore wwabcdef wwabc tooshort
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aesKeyFromEncodingAesKey,
  callbackSignature,
  decryptMessage,
  encryptMessage,
  readXmlField,
  verifySignature,
} from '@/modules/im-bot/channels/wecom-crypto';

// 43 位合法 encodingAesKey（32 字节密钥的 base64，去掉末尾 '='）
const AES_KEY = crypto.randomBytes(32).toString('base64').slice(0, 43);
const CORP_ID = 'wwabcdef1234567890';

describe('aesKeyFromEncodingAesKey', () => {
  it('43 位 key 解出 32 字节 AES-256 密钥', () => {
    expect(aesKeyFromEncodingAesKey(AES_KEY)).toHaveLength(32);
  });

  it('长度不是 43 时明确报错（而不是解出一个短密钥后静默失败）', () => {
    expect(() => aesKeyFromEncodingAesKey('tooshort')).toThrow(/长度应为 43/);
  });
});

describe('encryptMessage / decryptMessage 往返', () => {
  it('纯 ASCII 正文往返一致', () => {
    const payload = '{"msgtype":"text","text":{"content":"hello"}}';
    const enc = encryptMessage(payload, AES_KEY, CORP_ID);
    const dec = decryptMessage(enc, AES_KEY);
    expect(dec.payload).toBe(payload);
    expect(dec.receiveId).toBe(CORP_ID);
  });

  it('中文正文往返一致（长度字段必须按字节数而非字符数写）', () => {
    // 这条是 4 字节长度字段最容易写错的地方：写成 .length 会把中文算少
    const payload = '{"text":{"content":"新增项目 督导2.0 联调完成"}}';
    const dec = decryptMessage(
      encryptMessage(payload, AES_KEY, CORP_ID),
      AES_KEY,
    );
    expect(dec.payload).toBe(payload);
  });

  it('emoji 与多字节字符往返一致', () => {
    const payload = '✅ 已录入 🎉 项目';
    const dec = decryptMessage(
      encryptMessage(payload, AES_KEY, CORP_ID),
      AES_KEY,
    );
    expect(dec.payload).toBe(payload);
  });

  it('正文长度恰好落在 32 字节块边界上也正确', () => {
    for (const len of [12, 31, 32, 33, 63, 64, 65]) {
      const payload = 'a'.repeat(len);
      const dec = decryptMessage(
        encryptMessage(payload, AES_KEY, CORP_ID),
        AES_KEY,
      );
      expect(dec.payload, `len=${len}`).toBe(payload);
    }
  });

  it('空正文不炸', () => {
    const dec = decryptMessage(encryptMessage('', AES_KEY, CORP_ID), AES_KEY);
    expect(dec.payload).toBe('');
    expect(dec.receiveId).toBe(CORP_ID);
  });

  it('长正文（超过多个块）往返一致', () => {
    const payload = JSON.stringify({ text: '内容'.repeat(2000) });
    const dec = decryptMessage(
      encryptMessage(payload, AES_KEY, CORP_ID),
      AES_KEY,
    );
    expect(dec.payload).toBe(payload);
  });

  it('固定随机前缀时输出确定 —— 前缀参与加密但不影响解密结果', () => {
    const prefix = Buffer.alloc(16, 7);
    const a = encryptMessage('x', AES_KEY, CORP_ID, prefix);
    const b = encryptMessage('x', AES_KEY, CORP_ID, prefix);
    expect(a).toBe(b);
    expect(decryptMessage(a, AES_KEY).payload).toBe('x');
  });

  it('随机前缀不同时密文不同（同一明文不会产生固定密文）', () => {
    const a = encryptMessage('x', AES_KEY, CORP_ID);
    const b = encryptMessage('x', AES_KEY, CORP_ID);
    expect(a).not.toBe(b);
  });
});

describe('decryptMessage — 异常输入', () => {
  it('用错 encodingAesKey 时报错，而不是返回乱码', () => {
    const other = crypto.randomBytes(32).toString('base64').slice(0, 43);
    const enc = encryptMessage('hello', AES_KEY, CORP_ID);
    expect(() => decryptMessage(enc, other)).toThrow();
  });

  it('密文长度不是 16 倍数时明确报错', () => {
    expect(() =>
      decryptMessage(Buffer.alloc(17).toString('base64'), AES_KEY),
    ).toThrow(/16 字节的整数倍/);
  });

  it('空密文报错', () => {
    expect(() => decryptMessage('', AES_KEY)).toThrow(/长度非法/);
  });

  it('随机数据（能过长度校验但填充非法）报错而不是静默返回', () => {
    const junk = crypto.randomBytes(64).toString('base64');
    expect(() => decryptMessage(junk, AES_KEY)).toThrow();
  });

  it('encryptMessage 的随机前缀必须 16 字节', () => {
    expect(() =>
      encryptMessage('x', AES_KEY, CORP_ID, Buffer.alloc(8)),
    ).toThrow(/16 字节/);
  });
});

describe('callbackSignature', () => {
  it('四元素按字典序排序后拼接再 sha1（不是固定顺序）', () => {
    const sig = callbackSignature('tok', '1700000000', 'nonce1', 'enc');
    const expected = crypto
      .createHash('sha1')
      .update(['tok', '1700000000', 'nonce1', 'enc'].sort().join(''))
      .digest('hex');
    expect(sig).toBe(expected);
  });

  it('参数顺序换了签名不变（因为内部排序）', () => {
    const a = callbackSignature('tok', '111', 'nnn', 'eee');
    const b = callbackSignature('tok', 'nnn', '111', 'eee');
    expect(a).toBe(b);
  });

  it('任一参数变化签名就变', () => {
    const base = callbackSignature('tok', '111', 'nnn', 'eee');
    expect(callbackSignature('tok2', '111', 'nnn', 'eee')).not.toBe(base);
    expect(callbackSignature('tok', '112', 'nnn', 'eee')).not.toBe(base);
    expect(callbackSignature('tok', '111', 'nnn2', 'eee')).not.toBe(base);
    expect(callbackSignature('tok', '111', 'nnn', 'eee2')).not.toBe(base);
  });
});

describe('verifySignature', () => {
  it('相同签名通过', () => {
    expect(verifySignature('abc123', 'abc123')).toBe(true);
  });
  it('不同签名不通过', () => {
    expect(verifySignature('abc123', 'abc124')).toBe(false);
  });
  it('长度不同不通过（timingSafeEqual 对不等长会抛错，必须先挡住）', () => {
    expect(verifySignature('abc', 'abcdef')).toBe(false);
  });
  it('空串不通过非空', () => {
    expect(verifySignature('', 'x')).toBe(false);
  });
});

describe('readXmlField', () => {
  const xml = `<xml>
    <ToUserName><![CDATA[wwabc]]></ToUserName>
    <Encrypt><![CDATA[Zm9vYmFy]]></Encrypt>
    <AgentID>1000002</AgentID>
  </xml>`;

  it('读取 CDATA 包裹的值', () => {
    expect(readXmlField(xml, 'ToUserName')).toBe('wwabc');
    expect(readXmlField(xml, 'Encrypt')).toBe('Zm9vYmFy');
  });

  it('读取未包裹 CDATA 的值', () => {
    expect(readXmlField(xml, 'AgentID')).toBe('1000002');
  });

  it('字段不存在返回 null', () => {
    expect(readXmlField(xml, 'NotThere')).toBeNull();
  });

  it('空值返回 null（避免下游拿到空串当有效值）', () => {
    expect(readXmlField('<xml><A><![CDATA[]]></A></xml>', 'A')).toBeNull();
    expect(readXmlField('<xml><A></A></xml>', 'A')).toBeNull();
  });

  it('值里含换行也能读出', () => {
    expect(readXmlField('<xml><A><![CDATA[a\nb]]></A></xml>', 'A')).toBe(
      'a\nb',
    );
  });
});
