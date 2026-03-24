/**
 * 基于内存的滑动窗口限流器。
 *
 * **部署限制**：当前实现将计数存储在进程内存中，仅适用于单实例部署。
 * 在多实例或 Serverless 场景下，各实例的计数相互独立，无法实现全局限流。
 * 如需支持多实例部署，应迁移到 Redis（INCR + EXPIRE）等共享存储方案。
 */
export class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    // Clean up expired records every 60 seconds
    // unref() allows the process to exit even if this timer is still active
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const timestamps = this.windows.get(key) ?? [];

    // Filter to only timestamps within the window
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0] ?? now;
      const retryAfterMs = oldest + this.windowMs - now;
      this.windows.set(key, validTimestamps);
      return { allowed: false, retryAfterMs };
    }

    validTimestamps.push(now);
    this.windows.set(key, validTimestamps);
    return { allowed: true, retryAfterMs: 0 };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}

// 报告生成：1 分钟 3 次
export const reportGenerateLimiter = new RateLimiter(3, 60_000);

// AI 题目生成：1 分钟 5 次
export const questionGenerateLimiter = new RateLimiter(5, 60_000);

// 大转盘抽奖：1 分钟 10 次
export const drawLimiter = new RateLimiter(10, 60_000);

// 文件上传：1 分钟 5 次
export const uploadLimiter = new RateLimiter(5, 60_000);

// 信息采集提交：同一手机号 1 分钟 3 次
export const infoCollectSubmitLimiter = new RateLimiter(3, 60_000);

// 全局 IP 限流：单 IP 每分钟 60 次请求
export const globalIpLimiter = new RateLimiter(60, 60_000);

// 登录接口限流：单 IP 每分钟 5 次登录尝试
export const authIpLimiter = new RateLimiter(5, 60_000);
