import { DEDUP_TTL_MS } from '../constants';

/**
 * 回调重放窗口 —— 三家平台共用一个常量。
 *
 * 为什么必须与幂等 TTL 相等：验签/时间戳窗口一旦比幂等 TTL 长，就会开出
 * 一段「验签仍通过、幂等已过期」的区间 —— 抓到的合法回调在这段区间里
 * 重放会被再次完整处理，一条 CREATE 就多写一条记录。重放防护的两道闸门
 * 必须同时有效才有意义，所以取两者中更短的那个。
 *
 * 代价是对时钟漂移的容忍度降到 5 分钟。服务器与平台侧都用 NTP，这个量级
 * 是安全的；真的漂移超过 5 分钟，验签失败比静默重复写更好排查。
 *
 * （这条规则原本只写在钉钉那边。飞书当时既没有时间戳校验也没有验签，
 * 三家里唯一一个把这段区间**完全敞开**的 —— 只靠 5 分钟幂等挡重放。）
 */
export const REPLAY_TOLERANCE_MS = DEDUP_TTL_MS;

/** 小于这个值就认为对方给的是**秒**而不是毫秒（1e11 ms ≈ 1973 年） */
const SECONDS_UPPER_BOUND = 1e11;

/**
 * 把平台给的时间戳统一成毫秒。
 *
 * 三家的单位不一致且都没有在协议里标注：钉钉的 `timestamp` 头是毫秒、
 * 企微的 query `timestamp` 是秒、飞书的 `X-Lark-Request-Timestamp` 是秒
 * 而 `header.create_time` 是毫秒。按数量级判别而不是让每个调用方各自
 * 乘 1000，是因为**猜错单位的表现是「整个平台永久拒收」**，而不是报错。
 *
 * @returns 毫秒值；解析不出返回 null
 */
export function timestampToMs(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < SECONDS_UPPER_BOUND ? n * 1000 : n;
}

/**
 * 时间戳新鲜度的三态判定。
 *
 * 与下面的布尔版分开，是因为两类调用方要的行为**相反**：
 * - 协议**要求**必须带时间戳的地方（钉钉的 `timestamp` 头、飞书的签名头）：
 *   解析不出就是非法请求，应当拒绝
 * - 只是**顺带**能拿到时间戳的地方（飞书 `header.create_time`）：解析不出
 *   应当跳过 —— 不能因为平台改了一个字段的形状就让整个机器人失联
 *
 * 混成一个布尔值的话，第二类调用方只能写 `if (raw && !fresh(raw))`，
 * 而 `'abc'` 这种「有值但解析不出」的情况会落进拒绝分支。
 */
export function timestampFreshness(
  raw: unknown,
  now: number = Date.now(),
  toleranceMs: number = REPLAY_TOLERANCE_MS,
): 'fresh' | 'stale' | 'unknown' {
  const ms = timestampToMs(raw);
  if (ms === null) return 'unknown';
  return Math.abs(now - ms) <= toleranceMs ? 'fresh' : 'stale';
}

/**
 * 校验时间戳是否在容忍窗口内。**解析不出一律判为不新鲜**（拒绝）——
 * 给「协议要求必须带时间戳」的调用方用。
 */
export function isTimestampFresh(
  timestamp: string | number,
  now: number = Date.now(),
  toleranceMs: number = REPLAY_TOLERANCE_MS,
): boolean {
  return timestampFreshness(timestamp, now, toleranceMs) === 'fresh';
}
