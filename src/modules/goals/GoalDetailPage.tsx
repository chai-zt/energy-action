import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Target, Plus, Trash2, Edit2 } from 'lucide-react'
import { DexieGoalRepository, DexieKeyResultRepository, DexieProjectRepository, DexieTaskRepository } from '@/storage/repositories'
import { cn, generateId, now, formatDate } from '@/lib/utils'
import type { Goal, KeyResult, Project, Task } from '@/domain/models'

const statusLabel: Record<string, string> = {
  draft: '草稿', active: '进行中', paused: '已暂停', completed: '已完成', archived: '已归档'
}

export function GoalDetailPage() {
  const { goalId } = useParams<{ goalId: string }>()
  const navigate = useNavigate()
  const [goal, setGoal] = useState<Goal | null>(null)
  const [krs, setKrs] = useState<KeyResult[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showKrForm, setShowKrForm] = useState(false)

  const goalRepo = new DexieGoalRepository()
  const krRepo = new DexieKeyResultRepository()
  const projectRepo = new DexieProjectRepository()
  const taskRepo = new DexieTaskRepository()

  const load = useCallback(async () => {
    if (!goalId) return
    const g = await goalRepo.getById(goalId)
    if (!g) { navigate('/goals'); return }
    setGoal(g)
    const [krData, projectData, taskData] = await Promise.all([
      krRepo.getByGoalId(goalId),
      projectRepo.getByGoalId(goalId),
      taskRepo.getAll(),
    ])
    setKrs(krData)
    setProjects(projectData)
    setTasks(taskData.filter(t => t.goalId === goalId && !t.deletedAt))
    setLoading(false)
  }, [goalId])

  useEffect(() => { load() }, [load])

  const handleKrDelete = async (id: string) => {
    await krRepo.delete(id)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (!goal) return null

  const krProgress = krs.length > 0
    ? Math.round(krs.reduce((sum, kr) => {
        if (kr.metricType === 'boolean') return sum + (kr.currentValue >= kr.targetValue ? kr.weight * 100 : 0)
        const pct = (kr.currentValue - kr.startValue) / (kr.targetValue - kr.startValue) * 100
        return sum + Math.min(100, Math.max(0, pct)) * kr.weight
      }, 0) / krs.reduce((s, kr) => s + kr.weight, 0))
    : 0

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 返回 */}
      <button onClick={() => navigate('/goals')} className="btn-ghost flex items-center gap-1.5 -ml-3">
        <ArrowLeft size={16} /> 返回目标列表
      </button>

      {/* 目标头 */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Target size={20} className="text-blue-500" />
              <h1 className="text-lg font-bold text-slate-800">{goal.title}</h1>
              <span className={cn(
                'badge',
                goal.status === 'active' ? 'badge-success' :
                goal.status === 'completed' ? 'badge-success' : 'badge-p3'
              )}>{statusLabel[goal.status]}</span>
            </div>
            {goal.description && (
              <p className="text-sm text-slate-600 mt-2">{goal.description}</p>
            )}
            <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
              <span>{formatDate(goal.startDate)} - {formatDate(goal.dueDate)}</span>
              {goal.domain && <span className="badge badge-p2">{goal.domain}</span>}
            </div>
          </div>
          {/* 进度环 */}
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="28" fill="none" stroke="#3b82f6" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${krProgress * 1.76} 176`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-blue-600">{krProgress}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 关键结果 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">关键结果 (KR)</h2>
          <button onClick={() => setShowKrForm(true)} className="btn-secondary text-xs flex items-center gap-1">
            <Plus size={14} /> 添加 KR
          </button>
        </div>
        {krs.length === 0 ? (
          <p className="text-sm text-slate-400">暂无关键结果</p>
        ) : (
          <div className="space-y-3">
            {krs.map(kr => {
              const pct = kr.metricType === 'boolean'
                ? (kr.currentValue >= kr.targetValue ? 100 : 0)
                : Math.min(100, Math.max(0, Math.round(
                    (kr.currentValue - kr.startValue) / (kr.targetValue - kr.startValue) * 100
                  )))
              return (
                <div key={kr.id} className="p-3 rounded-lg bg-slate-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-700">{kr.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {kr.currentValue} / {kr.targetValue}
                      </span>
                      <button onClick={() => handleKrDelete(kr.id)} className="p-1 hover:text-red-500">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className={cn('h-2 rounded-full transition-all', pct >= 100 ? 'bg-green-500' : 'bg-blue-500')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 关联项目 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">关联项目 ({projects.length})</h2>
          <button onClick={() => navigate('/projects')} className="btn-secondary text-xs">查看全部</button>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-400">暂无关联项目</p>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)}>
                <span className="text-sm text-slate-700">{p.name}</span>
                <span className={cn(
                  'badge text-[10px]',
                  p.status === 'active' ? 'badge-success' :
                  p.status === 'blocked' ? 'badge-warning' : 'badge-p3'
                )}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 关联任务 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">直接关联任务 ({tasks.length})</h2>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-400">暂无非项目关联的任务</p>
        ) : (
          <div className="space-y-1">
            {tasks.map(t => (
              <div key={t.id} className="flex items-center gap-2 p-2 text-sm">
                <div className={cn(
                  'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                  t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-slate-300'
                )}>
                  {t.status === 'done' && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span className={cn(t.status === 'done' && 'line-through text-slate-400')}>{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KR 创建弹窗 */}
      {showKrForm && (
        <CreateKrModal
          goalId={goal.id}
          onClose={() => setShowKrForm(false)}
          onCreated={() => { setShowKrForm(false); load() }}
        />
      )}
    </div>
  )
}

function CreateKrModal({
  goalId, onClose, onCreated,
}: {
  goalId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [targetValue, setTargetValue] = useState(100)
  const [dueDate, setDueDate] = useState('')

  const handleSubmit = async () => {
    if (!title.trim()) return
    const repo = new DexieKeyResultRepository()
    const kr: KeyResult = {
      id: generateId(),
      goalId,
      title: title.trim(),
      description: '',
      metricType: 'number',
      startValue: 0,
      currentValue: 0,
      targetValue,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      status: 'active',
      weight: 1,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    }
    await repo.create(kr)
    onCreated()
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <h3 className="font-semibold text-lg text-slate-800 mb-4">添加关键结果</h3>
        <div className="space-y-3">
          <div>
            <label className="label">KR 名称</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：完成 10 次客户访谈" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">目标值</label>
              <input type="number" className="input" value={targetValue} onChange={e => setTargetValue(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">截止日期</label>
              <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button onClick={handleSubmit} className="btn-primary" disabled={!title.trim()}>添加</button>
        </div>
      </div>
    </div>
  )
}
