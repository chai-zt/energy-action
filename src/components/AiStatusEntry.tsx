// ============================================================
// AiStatusEntry — 全局 AI 状态入口（布局右上角）
//
// 显示：AI 未配置 / AI 待验证 / MiMo · model / AI 已锁定
// 点击打开轻量配置 Dialog（复用 AiModelConfigForm）。
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, X } from 'lucide-react'
import { getAiStatus, type AiStatus } from '@/services/aiConfigApi'
import { AiModelConfigForm } from './AiModelConfigForm'
import { cn } from '@/lib/utils'

function statusLabel(status: AiStatus | null): string {
  if (!status) return 'AI'
  if (status.fuseStatus === 'LOCKED') return 'AI 已锁定'
  if (status.available) {
    const name = status.providerType === 'mimo' ? 'MiMo' : (status.providerName || 'AI')
    return `${name} · ${status.model || ''}`
  }
  if (status.configured) return 'AI 待验证'
  return 'AI 未配置'
}

export function AiStatusEntry() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try { setStatus(await getAiStatus()) } catch { /* 后端未启动时保持未知 */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const colorCls = status?.fuseStatus === 'LOCKED'
    ? 'text-red-500 border-red-200 bg-red-50'
    : status?.available
      ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
      : status?.configured
        ? 'text-amber-600 border-amber-200 bg-amber-50'
        : 'text-slate-500 border-slate-200 bg-slate-50'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-opacity hover:opacity-75',
          colorCls,
        )}
        title="AI 模型配置"
      >
        <Sparkles size={12} />
        {statusLabel(status)}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">AI 模型配置</h3>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <AiModelConfigForm onChanged={refresh} compact />
          </div>
        </div>
      )}
    </>
  )
}
