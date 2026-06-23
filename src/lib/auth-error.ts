/**
 * 将 better-auth 客户端返回的错误（英文 message / code / HTTP status）
 * 统一翻译成对用户友好的中文文案。
 *
 * 背景：better-auth 内置错误是英文（"Invalid OTP" / "OTP expired" /
 * "Too many attempts"），而被 IP 限流拦截时（src/proxy.ts 返回 429）客户端
 * 解析不出标准字段，过去会回退成误导性的「验证码错误」。本函数集中处理，
 * 让发送 / 验证两个场景都拿到准确、友好的提示。
 */

const CJK_RE = /[一-龥]/;

export interface AuthErrorLike {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

/**
 * @param error    authClient 返回的 result.error
 * @param fallback 无法识别时的兜底文案（按调用场景区分发送/验证）
 */
export function resolveAuthError(
  error: AuthErrorLike | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;

  const code = (error.code ?? '').toUpperCase();
  const msg = (error.message ?? '').toLowerCase();
  const status = error.status ?? undefined;

  // 限流（来自 src/proxy.ts 的 429，message 已是中文）
  if (
    status === 429 ||
    code === 'RATE_LIMITED' ||
    code === 'TOO_MANY_REQUESTS'
  ) {
    return error.message && CJK_RE.test(error.message)
      ? error.message
      : '操作太频繁，请稍后再试';
  }

  if (code.includes('OTP_EXPIRED') || msg.includes('otp expired')) {
    return '验证码已过期，请点击「重新获取」后使用最新验证码';
  }
  if (code.includes('TOO_MANY_ATTEMPTS') || msg.includes('too many attempts')) {
    return '验证码错误次数过多，请重新获取验证码';
  }
  if (code.includes('INVALID_OTP') || msg.includes('invalid otp')) {
    return '验证码不正确，请重新输入（若刚重新发送，请使用最新一条）';
  }
  if (code.includes('OTP_NOT_FOUND') || msg.includes('otp not found')) {
    return '验证码已失效，请重新获取';
  }
  if (msg.includes('invalid email')) return '邮箱格式不正确';
  if (msg.includes('invalid phone')) return '手机号格式不正确';

  // 已是中文（自定义后端错误）直接透传，避免覆盖有用信息
  if (error.message && CJK_RE.test(error.message)) return error.message;

  // 其余英文/未知错误，统一用场景兜底文案，避免向用户暴露英文
  return fallback;
}
