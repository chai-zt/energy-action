// ============================================================
// CurrentEnergySelector — 全局"当前精力"三档选择器
//
// S1-D：用户能看见当前精力、修改当前精力。
// 只做最小三档（低/中/高），不重新设计 Dashboard。
// 切换精力不自动触发 AI（只有用户主动点"重新生成"才调用）。
// ============================================================

import { BatteryLow, BatteryMedium, BatteryFull } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ENERGY_LEVELS, ENERGY_LABELS, useCurrentEnergy } from '@/services/currentEnergy'
import type { EnergyLevel } from '@/domain/models'

const ICONS: Record<EnergyLevel, typeof BatteryLow> = {
  low: BatteryLow,
  medium: BatteryMedium,
  high: BatteryFull,
}

const COLOR: Record<EnergyLevel, string> = {
  low: 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
  medium: 'text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100',
  high: 'text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100',
}

export function CurrentEnergySelector() {
  const [level, setLevel] = useCurrentEnergy()

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium bg-white"
      title="当前精力（决定 AI 最小行动）"
    >
      <BatteryMedium size={12} className="text-slate-400" />
      {ENERGY_LEVELS.map((option) => {
        const Icon = ICONS[option]
        const active = level === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLevel(option)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-full border transition-colors',
              active ? COLOR[option] : 'border-transparent text-slate-400 hover:bg-slate-100',
            )}
          >
            <Icon size={12} />
            {ENERGY_LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
