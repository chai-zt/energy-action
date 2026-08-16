// ============================================================
// onboarding — 首次访问使用指南状态（localStorage，不接后端/不接 AI）
//
// key：energy-action:onboarding-completed
// 首次访问自动弹窗；关闭后写入 'true'，之后不再自动弹出。
// ============================================================

export const ONBOARDING_COMPLETED_KEY = 'energy-action:onboarding-completed'

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  } catch {
    /* localStorage 不可用（隐私模式等）时不阻断 */
  }
}
