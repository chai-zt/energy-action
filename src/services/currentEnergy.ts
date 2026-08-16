// ============================================================
// currentEnergy — 用户当前精力等级（canonical 单一来源）
//
// S1-D：三档 low / medium / high。
// 这是"用户当前精力"的唯一真相来源，前端所有页面与 AI 请求
// 统一从这里读取，禁止 Dashboard / Tasks / AI 各自维护一套。
//
// 持久化：localStorage（Community 已用的最低复杂度可靠方案）。
// 不引入 Redux/Zustand/MobX——三档状态不值得增加状态框架。
// ============================================================

import { useEffect, useState } from 'react'
import type { EnergyLevel } from '@/domain/models'

export const ENERGY_LEVELS: readonly EnergyLevel[] = ['low', 'medium', 'high'] as const

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low: '低精力',
  medium: '中精力',
  high: '高精力',
}

const STORAGE_KEY = 'energy-action:current-energy'
const DEFAULT_LEVEL: EnergyLevel = 'medium'

function load(): EnergyLevel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  } catch {
    /* localStorage 不可用（隐私模式等）→ 回退默认值 */
  }
  return DEFAULT_LEVEL
}

let current: EnergyLevel = load()
const listeners = new Set<(level: EnergyLevel) => void>()

export function getCurrentEnergy(): EnergyLevel {
  return current
}

export function setCurrentEnergy(level: EnergyLevel): void {
  if (level !== 'low' && level !== 'medium' && level !== 'high') return
  current = level
  try {
    localStorage.setItem(STORAGE_KEY, level)
  } catch {
    /* 写入失败不阻断内存态 */
  }
  for (const listener of listeners) listener(level)
}

export function subscribeCurrentEnergy(listener: (level: EnergyLevel) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React Hook：读取 + 修改当前精力（单一共享状态）。 */
export function useCurrentEnergy(): [EnergyLevel, (level: EnergyLevel) => void] {
  const [level, setLevel] = useState<EnergyLevel>(() => getCurrentEnergy())

  useEffect(() => subscribeCurrentEnergy(setLevel), [])

  return [level, setCurrentEnergy]
}
