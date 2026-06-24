import { describe, expect, it } from 'vitest';

import { isSensitiveKey, sanitizeInput } from '@/server/api/trpc';

describe('isSensitiveKey', () => {
  it('命中精确敏感字段', () => {
    for (const k of ['password', 'secret', 'token', 'otp', 'code']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('命中驼峰/嵌套凭证字段（B3 修复点）', () => {
    for (const k of [
      'appSecret',
      'botSecret',
      'encryptKey',
      'verificationToken',
      'botToken',
      'encodingAesKey',
      'apiKey',
      'api_key',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('不误伤无害字段', () => {
    for (const k of ['zipCode', 'productCode', 'username', 'title', 'phone']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('sanitizeInput', () => {
  it('脱敏嵌套 credentials 中的驼峰密钥字段', () => {
    const out = sanitizeInput({
      platform: 'feishu',
      credentials: {
        appId: 'cli_xxx',
        appSecret: 'real-secret',
        encryptKey: 'real-key',
        verificationToken: 'real-token',
      },
    }) as Record<string, { credentials: Record<string, unknown> } | unknown>;

    const creds = (out as { credentials: Record<string, unknown> }).credentials;
    expect(creds.appId).toBe('cli_xxx');
    expect(creds.appSecret).toBe('***');
    expect(creds.encryptKey).toBe('***');
    expect(creds.verificationToken).toBe('***');
  });

  it('脱敏数组内对象', () => {
    const out = sanitizeInput([{ token: 'abc' }, { name: 'ok' }]) as Array<
      Record<string, unknown>
    >;
    expect(out[0]?.token).toBe('***');
    expect(out[1]?.name).toBe('ok');
  });

  it('原样返回原始类型', () => {
    expect(sanitizeInput('x')).toBe('x');
    expect(sanitizeInput(42)).toBe(42);
    expect(sanitizeInput(null)).toBeNull();
  });
});
