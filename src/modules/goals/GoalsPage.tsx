import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Target, ChevronRight, Trash2, Save, X,
  CheckCircle2, Circle, Pencil, History,
} from 'lucide-react'
import { DexieGoalRepository } from '@/storage/repositories'
import { cn, generateId, now, today } from '@/lib/utils'
import { DOMAIN_OPTIONS, CYCLE_OPTIONS } from '@/domain/models'
import type { Goal, GoalStatus, KeyResult, GoalProgressLog } from '@/domain/models'

type GoalGroup = 'short' | 'medium' | 'long'

function classifyGoal(goal: Goal): GoalGroup {
  const start = goal.startDate || (goal as any).createdAt?.split('T')[0] || ''
  const end = (goal as any).deadline || goal.dueDate || ''
  if (!start || !end) return 'medium'
  const startDate = new Date(start)
  const endDate = new Date(end)
  let months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth())
  if (endDate.getDate() < startDate.getDate()) months -= 1
  if (months < 3) return 'short'
  if (months < 12) return 'medium'
  return 'long'
}

const groupLabel: Record<GoalGroup, string> = { short: '短期目标', medium: '中期目标', long: '长期目标' }
const statusLabel: Record<string, string> = {
  draft: '草稿', active: '进行中', paused: '已暂停', completed: '已完成', archived: '已归档',
}

function calcDeadline(cycleKey: string, start: string): string {
  const opt = CYCLE_OPTIONS.find(o => o.key === cycleKey)
  if (!opt || !opt.months) return ''
  const d = new Date(start)
  d.setMonth(d.getMonth() + opt.months)
  if (d.getDate() < new Date(start).getDate() && d.getMonth() === new Date(start).getMonth() + opt.months) {
    d.setDate(0)
  }
  return d.toISOString().split('T')[0]
}

export function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)

  const [newName, setNewName] = useState('')
  const [newCycle, setNewCycle] = useState('3m')
  const [newDomain, setNewDomain] = useState('growth')
  const [newDeadline, setNewDeadline] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const [krs, setKrs] = useState<Record<string, KeyResult[]>>({})
  const [newKrTitle, setNewKrTitle] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDomain, setEditDomain] = useState('')
  const [editDeadline, setEditDeadline] = useState('')

  const [progressLogs, setProgressLogs] = useState<Record<string, GoalProgressLog[]>>({})
  const [newProgress, setNewProgress] = useState('')
  const [showProgressInput, setShowProgressInput] = useState<string | null>(null)

  const goalRepo = new DexieGoalRepository()
  const todayStr = today()

  const load = useCallback(async () => {
    const data = await goalRepo.getAll()
    setGoals(data.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadKrs = async (goalId: string) => {
    const { db } = await import('@/storage/db')
    const all = await db.keyResults.toArray()
    setKrs(prev => ({ ...prev, [goalId]: all.filter(k => k.goalId === goalId) }))
  }

  const loadProgressLogs = async (goalId: string) => {
    const { db } = await import('@/storage/db')
    const all = await db.goalProgressLogs.where({ goalId }).toArray()
    setProgressLogs(prev => ({ ...prev, [goalId]: all.sort((a, b) => b.date.localeCompare(a.date)) }))
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const startDate = todayStr
    const deadline = newCycle === 'custom' ? newDeadline : calcDeadline(newCycle, startDate)
    await goalRepo.create({
      id: crypto.randomUUID(),
      title: newName.trim(), description: newDesc.trim(),
      level: 'quarterly', parentGoalId: null,
      startDate, dueDate: deadline || startDate,
      status: 'active', progressMode: 'key_result', manualProgress: 0,
      domain: newDomain as any, sortOrder: goals.length + 1,
      createdAt: now(), updatedAt: now(), deletedAt: null,
      cycleType: newCycle, deadline: deadline || startDate, completedAt: null,
    } as any)
    setNewName(''); setNewDesc(''); setNewDeadline('')
    setShowCreate(false)
    await load()
  }

  const handleCompleteGoal = async (goal: Goal) => {
    const goalKrs = krs[goal.id] || []
    const doneCount = goalKrs.filter(k => k.metricType === 'boolean' && k.currentValue > 0).length
    const total = goalKrs.length
    if (total > 0 && doneCount < total) {
      if (!confirm(`还有 ${total - doneCount} 个 KR 未完成，仍然完成这个目标吗？`)) return
    }
    await goalRepo.update(goal.id, {
      status: 'completed' as GoalStatus, completedAt: todayStr,
    } as any)
    await load()
    setExpandedIds(prev => { const n = new Set(prev); n.delete(goal.id); return n })
  }

  const handleToggleKr = async (goalId: string, kr: KeyResult) => {
    const { db } = await import('@/storage/db')
    const isDone = kr.metricType === 'boolean' && kr.currentValue > 0
    await db.keyResults.update(kr.id, { currentValue: isDone ? 0 : 1, metricType: 'boolean' })
    await loadKrs(goalId)
    await load()
  }

  const handleAddKr = async (goalId: string) => {
    if (!newKrTitle.trim()) return
    const { db } = await import('@/storage/db')
    await db.keyResults.add({
      id: generateId(), goalId, title: newKrTitle.trim(), description: '',
      metricType: 'boolean', startValue: 0, currentValue: 0, targetValue: 1,
      dueDate: '', status: 'active', weight: 0,
      createdAt: now(), updatedAt: now(), deletedAt: null,
    })
    setNewKrTitle('')
    await loadKrs(goalId)
  }

  const handleDeleteKr = async (goalId: string, krId: string) => {
    const { db } = await import('@/storage/db')
    await db.keyResults.delete(krId)
    await loadKrs(goalId)
  }

  const handleDeleteGoal = async (id: string) => {
    if (!confirm('确定删除此目标？')) return
    await goalRepo.softDelete(id)
    await load()
    setExpandedIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const handleStartEdit = (goal: Goal) => {
    setEditingId(goal.id)
    setEditTitle(goal.title)
    setEditDesc(goal.description)
    setEditDomain(goal.domain || 'any')
    setEditDeadline((goal as any).deadline || goal.dueDate)
  }

  const handleSaveEdit = async (goal: Goal) => {
    await goalRepo.update(goal.id, {
      title: editTitle.trim(), description: editDesc.trim(),
      domain: editDomain as any, deadline: editDeadline, dueDate: editDeadline,
    } as any)
    setEditingId(null)
    await load()
  }

  const handleAddProgress = async (goalId: string) => {
    if (!newProgress.trim()) return
    const { db } = await import('@/storage/db')
    await db.goalProgressLogs.add({
      id: generateId(), goalId, content: newProgress.trim(),
      date: todayStr, createdAt: now(), updatedAt: now(),
    })
    setNewProgress('')
    setShowProgressInput(null)
    await loadProgressLogs(goalId)
  }

  const handleUpdateProgress = async (goalId: string, logId: string, content: string) => {
    const { db } = await import('@/storage/db')
    await db.goalProgressLogs.update(logId, { content, updatedAt: now() })
    await loadProgressLogs(goalId)
  }

  const handleDeleteProgress = async (goalId: string, logId: string) => {
    if (!confirm('确定删除这条进展记录？')) return
    const { db } = await import('@/storage/db')
    await db.goalProgressLogs.delete(logId)
    await loadProgressLogs(goalId)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
  }

  const activeGoals = goals.filter(g => !g.deletedAt && g.status !== 'archived')
  const domainLabel = (d: string) => DOMAIN_OPTIONS.find(o => o.key === d)?.label || d
  const cycleLabel = (c: string) => CYCLE_OPTIONS.find(o => o.key === c)?.label || c

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Target size={24} className="text-blue-500" />目标
        </h1>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={16} /> 新建目标
        </button>
      </div>

      {showCreate && (
        <div className="card border-blue-200 space-y-4">
          <div>
            <label className="label">我想做到什么？</label>
            <input className="input" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="例如：完成 Personal AI OS 第一版并开始内测" autoFocus />
          </div>
          <div>
            <label className="label">目标周期</label>
            <div className="flex flex-wrap gap-2">
              {CYCLE_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setNewCycle(opt.key)}
                  className={cn('px-3 py-1.5 rounded-full text-xs border transition-colors',
                    newCycle === opt.key ? 'bg-blue-500 text-white border-blue-500' : 'border-slate-200 text-slate-600 hover:border-blue-300')}>
                  {opt.label}
                </button>
              ))}
            </div>
            {newCycle === 'custom' && (
              <input type="date" className="input mt-2 text-sm" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} min={todayStr} />
            )}
            {newCycle !== 'custom' && newCycle && (
              <p className="text-[10px] text-slate-400 mt-1">截止日期：{calcDeadline(newCycle, todayStr)}</p>
            )}
          </div>
          <div>
            <label className="label">这个目标主要想改变什么？</label>
            <div className="space-y-1">
              {DOMAIN_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setNewDomain(opt.key)}
                  className={cn('w-full text-left p-2.5 rounded-lg border transition-colors',
                    newDomain === opt.key ? 'border-blue-400 bg-blue-50' : 'border-slate-100 hover:border-blue-200')}>
                  <span className="text-sm font-medium text-slate-700">{opt.label}</span>
                  <span className="text-[10px] text-slate-400 ml-2">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">说明（可选）</label>
            <textarea className="input" rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="简单描述一下这个目标……" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary" disabled={!newName.trim()}>创建目标</button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">取消</button>
          </div>
        </div>
      )}

      {activeGoals.length === 0 ? (
        <div className="card text-center py-12">
          <Target size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400">还没有目标，点击上方按钮创建一个</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(['short', 'medium', 'long'] as GoalGroup[]).map(group => {
            const groupGoals = activeGoals.filter(g => classifyGoal(g) === group)
              .sort((a, b) => {
                const da = (a as any).deadline || a.dueDate || ''
                const db = (b as any).deadline || b.dueDate || ''
                return da.localeCompare(db)
              })
            if (groupGoals.length === 0) return null

            return (
              <div key={group}>
                <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full',
                    group === 'short' ? 'bg-green-400' : group === 'medium' ? 'bg-amber-400' : 'bg-purple-400')} />
                  {groupLabel[group]} ({groupGoals.length})
                </h2>
                <div className="space-y-3">
                  {groupGoals.map(goal => {
                    const isExpanded = expandedIds.has(goal.id)
                    const goalKrs = krs[goal.id] || []
                    const krDone = goalKrs.filter(k => k.metricType === 'boolean' && k.currentValue > 0).length
                    const krTotal = goalKrs.length
                    const isCompleted = goal.status === 'completed'
                    const cycle = (goal as any).cycleType || '3m'
                    const domain = goal.domain || 'any'

                    return (
                      <div key={goal.id} className={cn('card', isCompleted && 'opacity-70')}>
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => {
                          if (!isExpanded) { loadKrs(goal.id); loadProgressLogs(goal.id) }
                          setExpandedIds(prev => {
                            const next = new Set(prev)
                            if (isExpanded) next.delete(goal.id); else next.add(goal.id)
                            return next
                          })
                        }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={cn('text-sm font-semibold truncate', isCompleted && 'line-through text-slate-400')}>
                                {goal.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{cycleLabel(cycle)}</span>
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{domainLabel(domain)}</span>
                              {goal.startDate && <span>创建于 {goal.startDate.replace(/-/g, '/')}</span>}
                              {(goal as any).deadline && <span>· 截止 {(goal as any).deadline.replace(/-/g, '/')}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn('badge text-[10px]', isCompleted ? 'badge-success' : 'badge')}>
                              {statusLabel[goal.status] || goal.status}
                            </span>
                            <ChevronRight size={14} className={cn('text-slate-400 transition-transform', isExpanded && 'rotate-90')} />
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                            {editingId === goal.id ? (
                              <div className="space-y-3">
                                <div>
                                  <label className="text-[10px] text-slate-500">目标名称</label>
                                  <input className="input text-sm" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-500">说明</label>
                                  <textarea className="input text-sm" rows={2} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-500">领域</label>
                                  <select className="input text-sm" value={editDomain} onChange={e => setEditDomain(e.target.value)}>
                                    {DOMAIN_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-500">截止日期</label>
                                  <input type="date" className="input text-sm" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} />
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => handleSaveEdit(goal)} className="btn-primary text-xs flex items-center gap-1"><Save size={12} /> 保存</button>
                                  <button onClick={() => setEditingId(null)} className="btn-ghost text-xs flex items-center gap-1"><X size={12} /> 取消</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {goal.description && <p className="text-xs text-slate-500">{goal.description}</p>}
                                <button onClick={() => handleStartEdit(goal)} className="btn-ghost text-xs flex items-center gap-1 text-slate-400">
                                  <Pencil size={12} /> 编辑
                                </button>
                              </>
                            )}

                            {editingId !== goal.id && (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-slate-600">关键结果（KR）</span>
                                  <div className="flex items-center gap-2">
                                    <input className="input text-xs py-1 px-2 w-40" value={newKrTitle} onChange={e => setNewKrTitle(e.target.value)}
                                      onKeyDown={e => e.key === 'Enter' && handleAddKr(goal.id)} placeholder="+ 添加 KR" />
                                  </div>
                                </div>
                                {goalKrs.length === 0 ? (
                                  <p className="text-xs text-slate-400 py-1">还没有 KR，输入上方添加</p>
                                ) : (
                                  <div className="space-y-1">
                                    {goalKrs.sort((a, b) => (a.weight || 0) - (b.weight || 0)).map(kr => {
                                      const isDone = kr.metricType === 'boolean' && kr.currentValue > 0
                                      return (
                                        <div key={kr.id} className="flex items-center gap-2 py-1 group">
                                          <button onClick={() => handleToggleKr(goal.id, kr)} className="flex-shrink-0">
                                            {isDone ? <CheckCircle2 size={16} className="text-green-500" /> : <Circle size={16} className="text-slate-300" />}
                                          </button>
                                          <span className={cn('text-xs flex-1', isDone && 'line-through text-slate-400')}>{kr.title}</span>
                                          <button onClick={() => handleDeleteKr(goal.id, kr.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400">
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      )
                                    })}
                                    <p className="text-[10px] text-slate-400 mt-1">KR {krDone} / {krTotal} 已完成</p>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="pt-2 border-t border-slate-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-600">进展记录</span>
                                <button onClick={() => {
                                  setShowProgressInput(showProgressInput === goal.id ? null : goal.id)
                                  loadProgressLogs(goal.id)
                                }} className="text-xs text-blue-500 flex items-center gap-0.5">
                                  <History size={11} /> 记录一下
                                </button>
                              </div>
                              {showProgressInput === goal.id && (
                                <div className="flex gap-2 mb-2">
                                  <input className="input text-xs flex-1" value={newProgress}
                                    onChange={e => setNewProgress(e.target.value)}
                                    placeholder="今天这个目标有什么进展？"
                                    onKeyDown={e => e.key === 'Enter' && handleAddProgress(goal.id)} autoFocus />
                                  <button onClick={() => handleAddProgress(goal.id)} className="btn-primary text-xs" disabled={!newProgress.trim()}>保存</button>
                                </div>
                              )}
                              {(progressLogs[goal.id] || []).length === 0 ? (
                                <p className="text-[10px] text-slate-400">还没有进展记录</p>
                              ) : (
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                  {(progressLogs[goal.id] || []).map((log: GoalProgressLog) => (
                                    <div key={log.id} className="group">
                                      <p className="text-[10px] text-slate-400">{log.date.replace(/-/g, '/')}</p>
                                      <p className="text-xs text-slate-600 mt-0.5">{log.content}</p>
                                      <div className="flex gap-2 mt-0.5 opacity-0 group-hover:opacity-100">
                                        <button onClick={() => {
                                          const c = prompt('编辑进展', log.content)
                                          if (c && c.trim()) handleUpdateProgress(goal.id, log.id, c.trim())
                                        }} className="text-[9px] text-blue-400">编辑</button>
                                        <button onClick={() => handleDeleteProgress(goal.id, log.id)} className="text-[9px] text-red-400">删除</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                              {!isCompleted ? (
                                <button onClick={() => handleCompleteGoal(goal)} className="btn-success text-xs py-1.5 px-3">完成目标</button>
                              ) : (
                                <span className="text-xs text-green-600">✓ 已完成 {(goal as any).completedAt?.replace?.(/-/g, '/') || ''}</span>
                              )}
                              <div className="flex-1" />
                              <button onClick={() => handleDeleteGoal(goal.id)} className="btn-ghost text-xs text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
