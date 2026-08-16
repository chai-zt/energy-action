// ============================================================
// UsageGuideDialog — 首次访问 / 手动「使用指南」共用的唯一弹窗
//
// 首次访问自动 open，Header 点击手动 open，两者共用本组件与同一份内容。
// 关闭（X 或「开始使用」）统一由调用方 onClose 处理（写 onboarding 完成态）。
// ============================================================

import { X } from 'lucide-react'

interface GuideSection {
  number: string
  title: string
  body: string
}

const SECTIONS: GuideSection[] = [
  {
    number: '1',
    title: '创建任务',
    body: '先记录你真正想推进的事情。简单任务可以直接创建；复杂任务可以选择“大任务，需要拆解”。',
  },
  {
    number: '2',
    title: 'AI 帮你拆任务',
    body: '配置模型 API 后，Energy Action 可以把复杂任务拆成更容易执行的步骤。不配置 AI：任务创建、编辑、完成等基础功能仍然可以正常使用。',
  },
  {
    number: '3',
    title: '从 Minimum Action 开始',
    body: '系统不会要求你一次完成整个任务。它会根据当前状态，给你一个通常 1–10 分钟可以开始的 Minimum Action。核心目标：不是“完成整件事”，而是“现在开始第一步”。',
  },
  {
    number: '4',
    title: '根据精力调整行动',
    body: 'Energy Action 会逐步根据你的精力状态，调整 Minimum Action 的启动难度。更多个人精力管理能力正在完善中。',
  },
]

export interface UsageGuideDialogProps {
  open: boolean
  onClose: () => void
}

export function UsageGuideDialog({ open, onClose }: UsageGuideDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="使用指南"
      >
        {/* 标题区 */}
        <div className="flex items-start justify-between px-6 pt-5 pb-1">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">欢迎使用 Energy Action</h2>
            <p className="text-sm text-slate-500 mt-1">把“我想做”变成“我现在就能开始”。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1 rounded hover:bg-slate-100 text-slate-400 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-3 space-y-4">
          {SECTIONS.map(section => (
            <div key={section.number} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold flex items-center justify-center">
                {section.number}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{section.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
          >
            开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
