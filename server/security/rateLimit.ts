// ============================================================
// Rate Limiter — 简单内存固定窗口 limiter（不引入 Redis）
//
//   - model connection test：5 / min
//   - AI decompose：10 / min
//   - 安全违规：独立计数（由 fuse 驱动，不在这里限流）
// ============================================================

export interface Bucket {
  count: number
  windowStart: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs = 60_000) {
    this.limit = limit
    this.windowMs = windowMs
  }

  /** 是否允许本次请求；允许则计数并返回 true。 */
  allow(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key)
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now })
      return true
    }
    if (bucket.count >= this.limit) return false
    bucket.count += 1
    return true
  }

  reset(): void {
    this.buckets.clear()
  }
}

export const configTestLimiter = new RateLimiter(5)
export const decomposeLimiter = new RateLimiter(10)
