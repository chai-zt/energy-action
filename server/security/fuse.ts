// ============================================================
// Security Fuse v1 — Community 最小安全熔断
//
// 状态：NORMAL / LOCKED
// 保护：AI Config、Provider Egress
// 触发：连续错误 Session / 连续非法 Origin / 连续 SSRF target / 明显异常 Config Test
// LOCKED 后禁止：保存 Secret / 测试 Provider / AI 外发
// 但普通 Task CRUD 仍正常（不锁整个产品）。
// Reset：Local Node 重启 → NORMAL。
// ============================================================

export type FuseState = 'NORMAL' | 'LOCKED'

export interface FuseStatus {
  state: FuseState
  reason: string
}

const THRESHOLDS = {
  badSession: 5,
  badOrigin: 5,
  ssrfTarget: 3,
  configTestAnomaly: 3,
} as const

class SecurityFuse {
  private state: FuseState = 'NORMAL'
  private reason = ''
  private badSession = 0
  private badOrigin = 0
  private ssrfTarget = 0
  private configTestAnomaly = 0

  getStatus(): FuseStatus {
    return { state: this.state, reason: this.reason }
  }

  isLocked(): boolean {
    return this.state === 'LOCKED'
  }

  private lock(reason: string): void {
    if (this.state === 'LOCKED') return
    this.state = 'LOCKED'
    this.reason = reason
  }

  recordBadSession(): void {
    this.badSession += 1
    if (this.badSession >= THRESHOLDS.badSession) {
      this.lock('too many bad session tokens')
    }
  }

  recordBadOrigin(): void {
    this.badOrigin += 1
    if (this.badOrigin >= THRESHOLDS.badOrigin) {
      this.lock('too many invalid origins')
    }
  }

  recordSsrfTarget(): void {
    this.ssrfTarget += 1
    if (this.ssrfTarget >= THRESHOLDS.ssrfTarget) {
      this.lock('too many SSRF targets')
    }
  }

  recordConfigTestAnomaly(): void {
    this.configTestAnomaly += 1
    if (this.configTestAnomaly >= THRESHOLDS.configTestAnomaly) {
      this.lock('too many config test anomalies')
    }
  }
}

export const securityFuse = new SecurityFuse()

// 测试接缝
export function resetSecurityFuse(): void {
  ;(securityFuse as unknown as { state: FuseState }).state = 'NORMAL'
  ;(securityFuse as unknown as { reason: string }).reason = ''
  ;(securityFuse as unknown as { badSession: number }).badSession = 0
  ;(securityFuse as unknown as { badOrigin: number }).badOrigin = 0
  ;(securityFuse as unknown as { ssrfTarget: number }).ssrfTarget = 0
  ;(securityFuse as unknown as { configTestAnomaly: number }).configTestAnomaly = 0
}
