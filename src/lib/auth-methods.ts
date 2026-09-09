/**
 * 登录方式配置 — 通过 NEXT_PUBLIC_AUTH_METHOD 环境变量控制。
 *
 * 仅可选择一种: email-password | phone-otp | email-otp | dingtalk
 *
 * 示例: NEXT_PUBLIC_AUTH_METHOD=email-otp
 */

export type AuthMethod =
  | 'email-password'
  | 'phone-otp'
  | 'email-otp'
  | 'dingtalk';

const VALID_METHODS = new Set<AuthMethod>([
  'email-password',
  'phone-otp',
  'email-otp',
  'dingtalk',
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
export const isDingtalkEnabled = authMethod === 'dingtalk';

/**
 * 当前登录方式下「用户标识」的种类。
 * phone-otp / dingtalk 都以手机号作为用户唯一标识（user.phoneNumber），
 * 其余方式以邮箱为标识。业务侧统一读此值，避免逐个枚举 authMethod。
 */
export const identifierKind: 'phone' | 'email' =
  authMethod === 'phone-otp' || authMethod === 'dingtalk' ? 'phone' : 'email';
