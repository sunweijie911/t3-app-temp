export class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    // Clean up expired records every 60 seconds
    setInterval(() => this.cleanup(), 60_000);
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

// 1 minute window, 3 requests — for report generation
export const reportGenerateLimiter = new RateLimiter(3, 60_000);

// 1 minute window, 5 requests — for question generation
export const questionGenerateLimiter = new RateLimiter(5, 60_000);
