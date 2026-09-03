import crypto from 'node:crypto';

/**
 * 钉钉机器人 HTTP 回调的验签。
 *
 * 与企微/飞书都不同的三点，也是最容易写错的地方：
 * 1. 用 HmacSHA256 而非 sha1，且**密钥就是 botSecret 本身**
 * 2. 被签名的内容是 `${timestamp}\n${secret}` —— secret 既当密钥又在明文里
 * 3. 结果编码是 **base64**，不是 hex
 */

/** 签名有效期。钉钉官方要求 timestamp 与当前时间差不超过 1 小时 */
export const SIGN_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * 计算回调签名。
 * @param timestamp 请求头里的 timestamp（毫秒字符串）
 * @param secret 机器人的 botSecret（加签密钥）
 */
export function robotSignature(timestamp: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64');
}

/** 定时安全的签名比对 */
export function verifyRobotSignature(
  expected: string,
  actual: string,
): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 校验 timestamp 是否在容忍窗口内。
 * 钉钉回调没有 eventId 幂等，这是重放防护的第一道。
 */
export function isTimestampFresh(
  timestamp: string,
  now: number = Date.now(),
  toleranceMs: number = SIGN_TOLERANCE_MS,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Math.abs(now - ts) <= toleranceMs;
}
