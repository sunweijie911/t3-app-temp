import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(method: string) {
  vi.stubEnv('NEXT_PUBLIC_AUTH_METHOD', method);
  vi.resetModules();
  const mod = await import('@/modules/lucky-wheel/constants');
  return mod.IDENTIFIER_CONFIG;
}

describe('IDENTIFIER_CONFIG', () => {
  it('phone-otp 模式使用手机号', async () => {
    const cfg = await loadConfig('phone-otp');
    expect(cfg.kind).toBe('phone');
    expect(cfg.userField).toBe('phoneNumber');
    expect(cfg.label).toBe('手机号');
    expect(cfg.regex.test('13800138000')).toBe(true);
    expect(cfg.regex.test('a@b.com')).toBe(false);
  });

  it('email-otp 模式使用邮箱', async () => {
    const cfg = await loadConfig('email-otp');
    expect(cfg.kind).toBe('email');
    expect(cfg.userField).toBe('email');
    expect(cfg.label).toBe('邮箱');
    expect(cfg.regex.test('a@b.com')).toBe(true);
    expect(cfg.regex.test('13800138000')).toBe(false);
  });

  it('dingtalk 模式与 phone-otp 同构，同样使用手机号', async () => {
    const cfg = await loadConfig('dingtalk');
    expect(cfg.kind).toBe('phone');
    expect(cfg.userField).toBe('phoneNumber');
    expect(cfg.label).toBe('手机号');
  });

  it('email-password 模式使用邮箱', async () => {
    const cfg = await loadConfig('email-password');
    expect(cfg.userField).toBe('email');
    expect(cfg.kind).toBe('email');
  });
});
