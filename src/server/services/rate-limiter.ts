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

/**
 * 解析 "次数/窗口毫秒" 格式的限流配置，如 "10/60000"。
 * 解析失败时使用提供的默认值。
 */
function parseRateLimit(
  value: string,
  defaultMax: number,
  defaultWindowMs: number,
): [number, number] {
  const parts = value.split('/');
  if (parts.length !== 2) return [defaultMax, defaultWindowMs];
  const max = parseInt(parts[0]!, 10);
  const windowMs = parseInt(parts[1]!, 10);
  if (
    Number.isNaN(max) ||
    Number.isNaN(windowMs) ||
    max <= 0 ||
    windowMs <= 0
  ) {
    return [defaultMax, defaultWindowMs];
  }
  return [max, windowMs];
}

function rl(envValue: string, defaultMax: number, defaultWindowMs: number) {
  return new RateLimiter(
    ...parseRateLimit(envValue, defaultMax, defaultWindowMs),
  );
}

// 延迟初始化，首次调用时从 env 读取配置
let _cache: {
  reportGenerate: RateLimiter;
  questionGenerate: RateLimiter;
  draw: RateLimiter;
  upload: RateLimiter;
  dingtalkUserInfo: RateLimiter;
  globalIp: RateLimiter;
  authIp: RateLimiter;
} | null = null;

function limiters() {
  if (_cache) return _cache;
  const { env } = require('@/env') as typeof import('@/env');
  _cache = {
    reportGenerate: rl(env.RATE_LIMIT_REPORT_GENERATE, 3, 60_000),
    questionGenerate: rl(env.RATE_LIMIT_QUESTION_GENERATE, 5, 60_000),
    draw: rl(env.RATE_LIMIT_DRAW, 10, 60_000),
    upload: rl(env.RATE_LIMIT_UPLOAD, 5, 60_000),
    dingtalkUserInfo: rl(env.RATE_LIMIT_DINGTALK_USER_INFO, 30, 60_000),
    globalIp: rl(env.RATE_LIMIT_GLOBAL_IP, 60, 60_000),
    authIp: rl(env.RATE_LIMIT_AUTH_IP, 5, 60_000),
  };
  return _cache;
}

// 报告生成（默认 3次/分钟）
export const reportGenerateLimiter = {
  check: (key: string) => limiters().reportGenerate.check(key),
};

// AI 题目生成（默认 5次/分钟）
export const questionGenerateLimiter = {
  check: (key: string) => limiters().questionGenerate.check(key),
};

// 大转盘抽奖（默认 10次/分钟）
export const drawLimiter = {
  check: (key: string) => limiters().draw.check(key),
};

// 文件上传（默认 5次/分钟）
export const uploadLimiter = {
  check: (key: string) => limiters().upload.check(key),
};

// 钉钉免登接口（默认 30次/分钟）
export const dingtalkUserInfoLimiter = {
  check: (key: string) => limiters().dingtalkUserInfo.check(key),
};

// 全局 IP 限流（默认 60次/分钟）
export const globalIpLimiter = {
  check: (key: string) => limiters().globalIp.check(key),
};

// 登录接口限流（默认 5次/分钟）
export const authIpLimiter = {
  check: (key: string) => limiters().authIp.check(key),
};
