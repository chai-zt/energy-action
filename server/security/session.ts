// ============================================================
// Local Session Token — 敏感配置 API 的本地会话守卫
//
// Server 启动时生成随机高熵 token，仅存在内存。
// 敏感请求必须携带 X-Energy-Action-Session。
// 不写 SQLite / localStorage / 源码 / 日志。
// ============================================================

import { randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_HEADER = 'X-Energy-Action-Session'

let sessionToken: string | null = null

export function getSessionHeaderName(): string {
  return SESSION_HEADER
}

/** 首次调用时生成（懒初始化），进程内常量。 */
export function getSessionToken(): string {
  if (!sessionToken) {
    sessionToken = randomBytes(32).toString('hex')
  }
  return sessionToken
}

/** 常量时间比较，防时序侧信道。 */
export function isSessionValid(provided: string | undefined): boolean {
  if (!provided) return false
  const expected = getSessionToken()
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// 测试接缝
export function resetSessionToken(): void {
  sessionToken = null
}
