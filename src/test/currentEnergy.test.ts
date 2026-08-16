// ============================================================
// S1-D 测试 — currentEnergy canonical 状态（持久化）
//
// 验证：
//   E. Persistence：set 后写入 localStorage，reload（重载模块）后恢复正确值
//   三档 low/medium/high；非法值被拒绝
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'energy-action:current-energy'

describe('currentEnergy canonical store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('默认 medium', async () => {
    const { getCurrentEnergy, ENERGY_LEVELS, ENERGY_LABELS } = await import('@/services/currentEnergy')
    expect(getCurrentEnergy()).toBe('medium')
    expect(ENERGY_LEVELS).toEqual(['low', 'medium', 'high'])
    expect(ENERGY_LABELS).toEqual({ low: '低精力', medium: '中精力', high: '高精力' })
  })

  it('三档 set/get 往返', async () => {
    const { getCurrentEnergy, setCurrentEnergy } = await import('@/services/currentEnergy')
    for (const level of ['low', 'medium', 'high'] as const) {
      setCurrentEnergy(level)
      expect(getCurrentEnergy()).toBe(level)
    }
  })

  it('E. 持久化：set 写入 localStorage，reload 后恢复', async () => {
    const first = await import('@/services/currentEnergy')
    first.setCurrentEnergy('high')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('high')

    // 模拟 reload：重置模块注册表后重新 import，load() 从 localStorage 恢复
    vi.resetModules()
    const second = await import('@/services/currentEnergy')
    expect(second.getCurrentEnergy()).toBe('high')
  })

  it('非法值被拒绝（不污染状态）', async () => {
    const mod = await import('@/services/currentEnergy')
    mod.setCurrentEnergy('super-high' as never)
    expect(mod.getCurrentEnergy()).toBe('medium')
    mod.setCurrentEnergy(3 as never)
    expect(mod.getCurrentEnergy()).toBe('medium')
  })
})
