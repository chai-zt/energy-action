import { useState, useEffect } from 'react'
import { Settings, Download, Upload, Trash2, FileSpreadsheet, Sparkles } from 'lucide-react'
import { DexieExportRepository, DexieTaskRepository } from '@/storage/repositories'
import { AiModelConfigForm } from '@/components/AiModelConfigForm'
import type { ExportData } from '@/domain/models'

export function SettingsPage() {
  const [message, setMessage] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [message])

  const handleExportCSV = async () => {
    try {
      const tasks = await new DexieTaskRepository().getAll()
      const headers = ['标题', '状态', '项目', '预计时长', '实际时长', '截止日期', '认知负荷', '是否习惯']
      const rows = tasks.filter(t => !t.deletedAt).map(t => [
        t.title,
        t.status,
        t.projectId || '',
        t.estimatedMinutes.toString(),
        t.actualMinutes.toString(),
        t.dueDate || '',
        t.cognitiveLoad,
        t.isHabit ? '是' : '否',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

      const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tasks-export-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setMessage('CSV 已导出')
    } catch (e) {
      setMessage('导出失败: ' + String(e))
    }
  }

  const handleExport = async () => {
    try {
      const exportRepo = new DexieExportRepository()
      const data = await exportRepo.exportAll()
      data.tasks = await new DexieTaskRepository().getAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `personal-ai-os-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage('数据已导出')
    } catch (e) {
      setMessage('导出失败: ' + String(e))
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data: ExportData = JSON.parse(text)
        const exportRepo = new DexieExportRepository()
        await exportRepo.importAll(data)
        setMessage('数据已导入，请刷新页面')
        setTimeout(() => window.location.reload(), 1500)
      } catch (e) {
        setMessage('导入失败: ' + String(e))
      }
    }
    input.click()
  }

  const handleClearAll = async () => {
    const exportRepo = new DexieExportRepository()
    await exportRepo.clearAll()
    setShowClearConfirm(false)
    setMessage('所有数据已清空，请刷新页面')
    setTimeout(() => window.location.reload(), 1500)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Settings size={24} className="text-blue-500" />
        <h1 className="text-xl font-bold text-slate-800">设置</h1>
      </div>

      {message && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm">
          {message}
        </div>
      )}

      {/* AI 模型 */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-blue-500" />
          AI 模型
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          配置模型服务后，「大任务」可自动 AI 拆解为可执行小任务并生成最小行动。API Key 只保存在本机系统安全凭据库，不会上传。
        </p>
        <AiModelConfigForm />
      </div>

      {/* 数据管理 */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-3">数据管理</h2>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download size={16} />
            导出 JSON 备份
          </button>
          <button onClick={handleExportCSV} className="btn-secondary flex items-center gap-2">
            <FileSpreadsheet size={16} />
            导出 CSV (任务)
          </button>
          <button onClick={handleImport} className="btn-secondary flex items-center gap-2">
            <Upload size={16} />
            导入恢复
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="btn-danger flex items-center gap-2"
          >
            <Trash2 size={16} />
            清空所有数据
          </button>
        </div>
      </div>

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="font-semibold text-lg text-slate-800 mb-2">确认清空</h3>
            <p className="text-sm text-slate-600 mb-4">
              此操作将删除所有本地数据，且不可恢复。建议先导出备份。
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowClearConfirm(false)} className="btn-secondary">
                取消
              </button>
              <button onClick={handleClearAll} className="btn-danger">
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
