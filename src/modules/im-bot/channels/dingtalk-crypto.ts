import crypto from 'node:crypto';
import { DEDUP_TTL_MS } from '../constants';

/**
 * 钉钉机器人 HTTP 回调的验签。
 *
 * 与企微/飞书都不同的三点，也是最容易写错的地方：
 * 1. 用 HmacSHA256 而非 sha1，且**密钥就是 botSecret 本身**
 * 2. 被签名的内容是 `${timestamp}\n${secret}` —— secret 既当密钥又在明文里
 * 3. 结果编码是 **base64**，不是 hex
 */

/**
 * 签名有效期。
 *
 * 钉钉官方允许 1 小时，这里刻意收紧到与幂等 TTL 一致。
 * 钉钉回调没有独立 eventId，msgId 兼作幂等键，而幂等记录只保留
 * DEDUP_TTL_MS（5 分钟）。两个窗口不一致就会开出一段
 * 「验签仍通过、幂等已过期」的区间：抓到的合法回调在 5~60 分钟之间重放
 * 会被再次完整处理，一条 CREATE 就多写一条记录。
 * 重放防护的两道闸门必须同时有效才有意义，所以取两者中更短的那个。
 *
 * 代价是对时钟漂移的容忍度下降到 5 分钟 —— 服务器与钉钉侧都用 NTP，
 * 这个量级是安全的；真的漂移超过 5 分钟，验签失败比静默重复写更好排查。
 */
export const SIGN_TOLERANCE_MS = DEDUP_TTL_MS;

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
