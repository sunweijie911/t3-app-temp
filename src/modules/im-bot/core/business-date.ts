/**
 * 业务日期原语。
 *
 * 业务时区固定 CST(+08:00)：表里的日期字段、后台统计的"今天"、注入 prompt
 * 的 `${today}` 必须是同一个自然日的概念。容器一般跑 UTC，任何
 * `new Date().toISOString().slice(0,10)` 或 `setHours(0,0,0,0)` 取到的都是
 * **UTC 日**——北京时间每天 08:00 之前，两者差一天。
 *
 * 后果不是"少算一天数据"这么轻：`${today}` 被注入到场景 systemPrompt 里，
 * LLM 拿它当"今天"去填日期字段。凌晨录入的记录会被写成前一天，且没有任何
 * 报错——第二天按日期查就少一条。
 */

/** CST 相对 UTC 的偏移。飞书日期字段、field-types.ts 的换算都按它来 */
export const BUSINESS_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 业务时区（CST）下的今天，YYYY-MM-DD。
 *
 * 实现上先把时刻平移 +8h 再取 UTC 日期，而不是用 `toLocaleDateString`
 * ——后者的输出格式随 Node 的 ICU 数据变化（zh-CN 会给 "2026/09/04"），
 * 而这里要的是可直接进 filter 的 ISO 日期串。
 */
export function todayInBusinessTz(now: Date = new Date()): string {
  return new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * 返回「业务时区今天 00:00」对应的 UTC 时刻。
 * 直接用 `new Date().setHours(0,0,0,0)` 取的是**服务器本地时区**，
 * 容器一般跑 UTC，会把凌晨 0~8 点的数据算进前一天。
 */
export function startOfBusinessDay(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - BUSINESS_TZ_OFFSET_MS);
}
