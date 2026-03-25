/**
 * 登录方式配置 — 通过 NEXT_PUBLIC_AUTH_METHOD 环境变量控制。
 *
 * 仅可选择一种: email-password | phone-otp | email-otp
 *
 * 示例: NEXT_PUBLIC_AUTH_METHOD=email-otp
 */

export type AuthMethod = 'email-password' | 'phone-otp' | 'email-otp';

const VALID_METHODS = new Set<AuthMethod>([
  'email-password',
  'phone-otp',
  'email-otp',
]);

export function parseAuthMethod(raw: string | undefined): AuthMethod {
  const trimmed = raw?.trim() as AuthMethod | undefined;
  if (trimmed && VALID_METHODS.has(trimmed)) return trimmed;
  return 'email-otp';
}

export const authMethod: AuthMethod = parseAuthMethod(
  process.env.NEXT_PUBLIC_AUTH_METHOD,
);

export const isEmailPasswordEnabled = authMethod === 'email-password';
export const isPhoneOtpEnabled = authMethod === 'phone-otp';
export const isEmailOtpEnabled = authMethod === 'email-otp';
