// ============================================================
// PriorityLegend — 统一 P0-P3 等级解释条
// ============================================================

import { cn } from '@/lib/utils'

export function PriorityLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-50 rounded-lg px-2 py-1">
      <span className="font-medium text-slate-600">P0-P3说明：</span>
      <span className="flex items-center gap-1">
        <span className="badge badge-p0 text-[9px]">P0</span>
        <span>紧急必须处理(60-100)</span>
      </span>
      <span className="text-slate-300">|</span>
      <span className="flex items-center gap-1">
        <span className="badge badge-p1 text-[9px]">P1</span>
        <span>重要优先推进(40-59)</span>
      </span>
      <span className="text-slate-300">|</span>
      <span className="flex items-center gap-1">
        <span className="badge badge-p2 text-[9px]">P2</span>
        <span>正常按计划(20-39)</span>
      </span>
      <span className="text-slate-300">|</span>
      <span className="flex items-center gap-1">
        <span className="badge badge-p3 text-[9px]">P3</span>
        <span>可延后处理(0-19)</span>
      </span>
    </div>
  )
}
