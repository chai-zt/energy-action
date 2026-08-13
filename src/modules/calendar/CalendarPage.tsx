// ============================================================
// 日历模块 — Linear/Superlist/Raycast 风格重设计
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Calendar, Clock, Trash2, X, Zap, BookOpen, Timer,
  ChevronLeft, ChevronRight, Plus, Filter, Search,
  CheckCircle2, Circle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DexieTaskRepository } from '@/storage/repositories'
import {
  CompactMonth, WeekView, DayView, ListView,
  CalendarDragContext, DraggableTaskItem,
} from '@/components/CalendarShared'
import { cn, generateId, now, today, isSameDay, addDays, addMonths, formatLongDate, formatMonthTitle } from '@/lib/utils'
import type { Task, DailyState, DailyReview, TimeRecord, PomodoroSession, CompletionRecord } from '@/domain/models'
import { DexieDailyStateRepository, DexieDailyReviewRepository, DexieTimeRecordRepository, DexieCompletionRepository, DexiePomodoroRepository } from '@/storage/repositories'

type CalendarView = 'day' | 'week' | 'month' | 'list'

const VIEW_LABELS: Record<CalendarView, string> = {
  day: '日', week: '周', month: '月', list: '列表',
}

// 为日期生成星期标签
function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

export function CalendarPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [currentDate, setCurrentDate] = useState<string>(today())
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date())
  const [view, setView] = useState<CalendarView>('week')
  const [prevView, setPrevView] = useState<CalendarView>('week')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [undoInfo, setUndoInfo] = useState<{ taskId: string; oldDate: string | null } | null>(null)
  const [dayDetails, setDayDetails] = useState<{
    tasks: Task[]; state: DailyState | null; review: DailyReview | null
    timeRecords: TimeRecord[]; pomodoros: PomodoroSession[]; completions: CompletionRecord[]
  } | null>(null)
  const [transitioning, setTransitioning] = useState(false)

  const taskRepo = new DexieTaskRepository()

  const loadTasks = useCallback(async () => {
    try {
      const allTasks = await taskRepo.getAll()
      setTasks(allTasks.filter(t => !t.deletedAt))
    } catch (e) {
      console.error('Calendar loadTasks failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDayDetails = useCallback(async (date: string) => {
    const stateRepo = new DexieDailyStateRepository()
    const reviewRepo = new DexieDailyReviewRepository()
    const timeRepo = new DexieTimeRecordRepository()
    const pomoRepo = new DexiePomodoroRepository()
    const compRepo = new DexieCompletionRepository()
    const [dateTasks, state, review, timeRecs, pomos, comps] = await Promise.all([
      taskRepo.getByPlannedDate(date), stateRepo.getByDate(date), reviewRepo.getByDate(date),
      timeRepo.getByDate(date), pomoRepo.getByDate(date), compRepo.getByDate(date),
    ])
    setDayDetails({ tasks: dateTasks, state: state || null, review: review || null, timeRecords: timeRecs, pomodoros: pomos, completions: comps })
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadDayDetails(currentDate) }, [currentDate, loadDayDetails])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const handleSelectDate = (date: string) => {
    setTransitioning(true)
    setTimeout(() => { setCurrentDate(date); setCurrentMonth(new Date(date)); setTransitioning(false) }, 160)
  }

  const handleUndo = async () => {
    if (!undoInfo) return
    await taskRepo.update(undoInfo.taskId, { plannedDate: undoInfo.oldDate })
    setUndoInfo(null); loadTasks(); loadDayDetails(currentDate)
  }

  const handleToggleStatus = async (task: Task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    await taskRepo.update(task.id, { status: newStatus, completedAt: newStatus === 'done' ? now() : null })
    loadTasks(); loadDayDetails(currentDate)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此任务？')) return
    await taskRepo.softDelete(id); loadTasks(); loadDayDetails(currentDate)
  }

  const handleSwitchView = (v: CalendarView) => {
    setPrevView(view)
    setView(v)
  }

  const unscheduledTasks = useMemo(() => {
    let result = tasks.filter(t => !t.deletedAt && t.status !== 'done' && t.status !== 'cancelled')
    if (search) result = result.filter(t => t.title.toLowerCase().includes(search.toLowerCase()))
    return result
  }, [tasks, search])

  const currentDateObj = useMemo(() => new Date(currentDate), [currentDate])

  const summary = useMemo(() => {
    if (!dayDetails) return { total: 0, done: 0, plannedMin: 0, actualMin: 0, pomos: 0 }
    const total = dayDetails.tasks.length
    const done = dayDetails.tasks.filter(t => t.status === 'done').length
    const plannedMin = dayDetails.tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0)
    const actualMin = dayDetails.timeRecords.reduce((s, r) => s + (r.durationMinutes || 0), 0)
    return { total, done, plannedMin, actualMin, pomos: dayDetails.pomodoros.length }
  }, [dayDetails])

  // ===== 本周数据计算 =====
  const weekInfo = useMemo(() => {
    const todayDate = new Date()
    const ts = todayDate.toISOString().split('T')[0]
    const dayOfWeek = todayDate.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(todayDate); monday.setDate(todayDate.getDate() + mondayOffset)

    const days: { date: string; dow: number }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i)
      days.push({ date: d.toISOString().split('T')[0], dow: i })
    }
    const weekDateSet = new Set(days.map(d => d.date))

    // 本周所有普通未完成任务（有 plannedDate 且在本周）
    const weekTasks = tasks.filter(t => !t.deletedAt && !t.isHabit && t.plannedDate && weekDateSet.has(t.plannedDate))
    const weekHabits = tasks.filter(t => t.isHabit && !t.deletedAt)

    // 每日节奏：任务数 + 计划精力
    const rhythm = days.map(d => {
      const dTasks = weekTasks.filter(t => t.plannedDate === d.date)
      const count = dTasks.length
      // 使用 ENERGY_MAP 计算精力
      const energyTotal = dTasks.reduce((sum, t) => {
        const energyVal = { 1: 3, 2: 5, 3: 10, 4: 20, 5: 30 }[t.energyDemand] || 10
        return sum + energyVal
      }, 0)
      return { date: d.date, dow: d.dow, count, energy: energyTotal }
    })

    // 本周重点：P0→P3 top 3
    const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
    const highlights = weekTasks
      .filter(t => t.status !== 'done' && t.status !== 'cancelled')
      .sort((a, b) => {
        const pa = priorityOrder[a.aiPriorityLevel as string] ?? 4
        const pb = priorityOrder[b.aiPriorityLevel as string] ?? 4
        if (pa !== pb) return pa - pb
        return (a.plannedDate || '').localeCompare(b.plannedDate || '')
      })
      .slice(0, 3)

    // 本周统计
    const total = weekTasks.length
    const done = weekTasks.filter(t => t.status === 'done').length
    const overdue = weekTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.plannedDate! < ts).length
    const habitTotal = weekHabits.length
    const habitCompletions = tasks.filter(t => t.isHabit && t.status === 'done' && t.plannedDate && weekDateSet.has(t.plannedDate)).length

    return { days, rhythm, highlights, stats: { total, done, overdue, habitTotal, habitCompletions } }
  }, [tasks])

  // 本周专注时间（从每日 timeRecords 汇总）
  const [weekFocusMinutes, setWeekFocusMinutes] = useState(0)
  useEffect(() => {
    (async () => {
      if (weekInfo.days.length === 0) return
      const repo = new DexieTimeRecordRepository()
      let total = 0
      for (const d of weekInfo.days) {
        const recs = await repo.getByDate(d.date)
        total += recs.reduce((s, r) => s + (r.durationMinutes || 0), 0)
      }
      setWeekFocusMinutes(total)
    })()
  }, [weekInfo.days])

  const todayStr = today()

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
  }

  const renderView = (activeDrag: boolean) => {
    const viewProps = {
      month: () => <CompactMonth currentMonth={currentMonth} selectedDate={currentDate} tasks={tasks} isActiveDrag={activeDrag} onSelectDate={handleSelectDate} onPrevMonth={() => setCurrentMonth(addMonths(currentMonth, -1))} onNextMonth={() => setCurrentMonth(addMonths(currentMonth, 1))} />,
      week: () => <WeekView currentDate={currentDateObj} tasks={tasks} onSelectDate={handleSelectDate} />,
      day: () => <DayView date={currentDateObj} tasks={tasks} onSelectDate={handleSelectDate} />,
      list: () => <ListView tasks={tasks} onSelectDate={handleSelectDate} />,
    }
    return viewProps[view]()
  }

  return (
    <CalendarDragContext tasks={tasks} scheduledTasks={tasks.filter(t => t.plannedDate)} onTaskUpdated={() => { loadTasks(); loadDayDetails(currentDate) }} onToast={showToast} selectedDate={currentDate} onSelectDate={handleSelectDate} onUndo={(taskId, oldDate) => setUndoInfo({ taskId, oldDate })}>
      {({ activeTaskId, handleDragEnd, handleDragStart, handleDragCancel }) => (
        <div className="h-[calc(100vh-7rem)] flex flex-col gap-3">
          {/* ===== 顶部导航栏 ===== */}
          <div className="flex items-center justify-between flex-shrink-0 px-0.5">
            <div className="flex items-center gap-3">
              {/* 日期范围 */}
              <h2 className="text-sm font-semibold text-slate-700 tracking-tight">
                {view === 'month' ? formatMonthTitle(currentMonth) : formatLongDate(currentDate)}
              </h2>
              {/* 导航 */}
              <div className="flex items-center gap-0.5">
                <button onClick={() => {
                  if (view === 'month') setCurrentMonth(addMonths(currentMonth, -1))
                  else if (view === 'day') { const d = addDays(currentDate, -1); setCurrentDate(d.toISOString().split('T')[0]); setCurrentMonth(d) }
                  else { const d = addDays(currentDate, -7); setCurrentDate(d.toISOString().split('T')[0]); setCurrentMonth(d) }
                }} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => { const t = todayStr; setCurrentDate(t); setCurrentMonth(new Date()) }}
                  className={cn('px-2 py-1 rounded-md text-xs font-medium transition-colors duration-150',
                    isSameDay(currentDate, todayStr) ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100')}>今天</button>
                <button onClick={() => {
                  if (view === 'month') setCurrentMonth(addMonths(currentMonth, 1))
                  else if (view === 'day') { const d = addDays(currentDate, 1); setCurrentDate(d.toISOString().split('T')[0]); setCurrentMonth(d) }
                  else { const d = addDays(currentDate, 7); setCurrentDate(d.toISOString().split('T')[0]); setCurrentMonth(d) }
                }} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* 视图切换 */}
            <div className="flex bg-slate-100/80 rounded-lg p-0.5 gap-0.5">
              {(Object.keys(VIEW_LABELS) as CalendarView[]).map(v => (
                <button key={v} onClick={() => handleSwitchView(v)}
                  className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-180',
                    view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50')}>
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          {/* ===== Toast ===== */}
          {undoInfo && (
            <div className="bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 text-sm text-amber-700 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
              <span>已成功安排</span>
              <button onClick={handleUndo} className="text-amber-700 hover:text-amber-900 font-medium">撤销</button>
            </div>
          )}
          {toast && (
            <div className="bg-green-50 border border-green-200/60 rounded-lg px-3 py-2 text-sm text-green-700 animate-in fade-in slide-in-from-top-1 duration-200">{toast}</div>
          )}

          {/* ===== 主体区域 ===== */}
          <div className="flex gap-4 flex-1 min-h-0">
            {/* 左侧未排期 */}
            {view !== 'list' && (
              <div className="w-56 flex-shrink-0 hidden lg:flex flex-col rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm overflow-hidden">
                <div className="px-3 py-2.5 border-b border-slate-100">
                  <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Clock size={12} /> 未排期 ({unscheduledTasks.length})
                  </h3>
                </div>
                <div className="px-3 py-2 border-b border-slate-100">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input text-xs py-1.5 pl-7 bg-slate-50 border-0 ring-0" placeholder="搜索..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
                  {unscheduledTasks.map(task => (
                    <DraggableTaskItem key={task.id} task={task} onClick={() => navigate('/tasks')} />
                  ))}
                  {unscheduledTasks.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">所有任务已排期</p>
                  )}
                </div>
              </div>
            )}

            {/* 右侧主区域 */}
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              {/* 日历视图 */}
              <div className={cn('flex-1 rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm overflow-auto transition-opacity duration-200',
                transitioning && 'opacity-60')}>
                {renderView(!!activeTaskId)}
              </div>

              {/* ===== 本周信息区 ===== */}
              {view !== 'list' && (
                <div className="grid grid-cols-2 gap-3 flex-shrink-0">
                  {/* 本周节奏 */}
                  <div className="rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm px-4 py-3">
                    <p className="text-[11px] font-medium text-slate-500 mb-3">本周节奏</p>
                    <div className="flex items-end justify-between gap-1 h-16">
                      {weekInfo.rhythm.map((d, i) => {
                        const maxE = Math.max(...weekInfo.rhythm.map(r => r.energy), 1)
                        const hPct = Math.max(8, (d.energy / maxE) * 100)
                        return (
                          <button key={i}
                            onClick={() => handleSelectDate(d.date)}
                            className="flex-1 flex flex-col items-center gap-1 group">
                            <span className={cn('text-[9px] transition-colors duration-150',
                              d.date === currentDate ? 'text-blue-500 font-medium' :
                              d.date === todayStr ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-500')}>
                              {['一','二','三','四','五','六','日'][d.dow]}
                            </span>
                            <div className="relative w-full flex justify-center">
                              <div
                                className={cn('w-4 rounded-sm transition-all duration-300',
                                  d.date === currentDate
                                    ? 'bg-blue-500'
                                    : d.date === todayStr
                                      ? 'bg-blue-400/80'
                                      : 'bg-slate-200 group-hover:bg-slate-300')}
                                style={{ height: `${hPct}%`, minHeight: '4px', maxHeight: '48px' }} />
                            </div>
                            <span className="text-[9px] text-slate-500 hidden group-hover:block">
                              {d.count > 0 ? `${d.count}个` : '—'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* 本周重点 */}
                  <div className="rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm px-4 py-3">
                    <p className="text-[11px] font-medium text-slate-500 mb-3">本周重点</p>
                    {weekInfo.highlights.length === 0 ? (
                      <p className="text-xs text-slate-400">本周暂无重点任务</p>
                    ) : (
                      <div className="space-y-1.5">
                        {weekInfo.highlights.map((t, i) => (
                          <button key={t.id}
                            onClick={() => { if (t.plannedDate) handleSelectDate(t.plannedDate) }}
                            className="flex items-center gap-2 w-full text-left text-xs text-slate-700 py-0.5 rounded hover:bg-slate-50/50 transition-colors duration-150 group">
                            <span className="text-[10px] font-medium text-slate-400 w-3">{i + 1}</span>
                            <span className="flex-1 truncate group-hover:text-slate-900">{t.title}</span>
                            <span className={cn('text-[9px] rounded px-1',
                              t.aiPriorityLevel === 'P0' ? 'bg-red-50 text-red-500' :
                              t.aiPriorityLevel === 'P1' ? 'bg-amber-50 text-amber-500' :
                              'bg-slate-100 text-slate-500')}>{t.aiPriorityLevel || '—'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== 本周数据带 ===== */}
              {view !== 'list' && (
                <div className="flex items-center gap-4 px-4 py-2 rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm text-xs text-slate-500 flex-shrink-0">
                  <span>本周 <span className="font-medium text-slate-700">{weekInfo.stats.total}</span> 个任务</span>
                  <span className="text-slate-300">·</span>
                  <span>已完成 <span className="font-medium text-emerald-600">{weekInfo.stats.done}</span></span>
                  <span className="text-slate-300">·</span>
                  <span>未完成 <span className="font-medium text-slate-600">{weekInfo.stats.total - weekInfo.stats.done}</span></span>
                  {weekFocusMinutes > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>专注 <span className="font-medium text-slate-700">{Math.round(weekFocusMinutes / 60 * 10) / 10}h</span></span>
                    </>
                  )}
                  {weekInfo.stats.overdue > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>逾期 <span className="font-medium text-red-500">{weekInfo.stats.overdue}</span></span>
                    </>
                  )}
                </div>
              )}

              {/* ===== Day Inspector ===== */}
              {currentDate && (
                <div className="rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm px-4 py-3 transition-all duration-200">
                  {/* 日期标题行 */}
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">{currentDate} · {weekdayLabel(currentDate)}</h3>
                    {currentDate === todayStr && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                  </div>

                  {/* 轻量数据行 */}
                  <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
                    <span>{summary.total} 个任务</span>
                    <span className="text-emerald-600">{summary.done} 已完成</span>
                    <span className="text-slate-400">{summary.total - summary.done} 未完成</span>
                    {summary.plannedMin > 0 && <span>预计 {Math.round(summary.plannedMin / 60 * 10) / 10}h</span>}
                    {summary.actualMin > 0 && <span className="flex items-center gap-1"><Timer size={10} /> {Math.round(summary.actualMin / 60 * 10) / 10}h</span>}
                    {summary.pomos > 0 && <span className="flex items-center gap-1"><Zap size={10} /> {summary.pomos}</span>}
                  </div>

                  {/* 任务列表 */}
                  {dayDetails && dayDetails.tasks.length > 0 ? (
                    <div className="space-y-1">
                      {dayDetails.tasks.map(task => (
                        <div key={task.id}
                          className={cn('flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors duration-150 hover:bg-slate-50 group',
                            task.status === 'done' && 'opacity-60')}>
                          <button onClick={() => handleToggleStatus(task)} className="flex-shrink-0">
                            {task.status === 'done'
                              ? <CheckCircle2 size={14} className="text-emerald-500" />
                              : <Circle size={14} className="text-slate-300" />}
                          </button>
                          <span className={cn('flex-1 truncate', task.status === 'done' && 'line-through text-slate-400')}>{task.title}</span>
                          {task.estimatedMinutes > 0 && (
                            <span className="text-[10px] text-slate-400">{task.estimatedMinutes}分</span>
                          )}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button onClick={() => handleDelete(task.id)} className="text-slate-300 hover:text-red-400"><Trash2 size={12} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-xs text-slate-400">这一天还没有安排</p>
                    </div>
                  )}

                  {/* 快捷操作 */}
                  <div className="flex gap-3 mt-3 pt-2 border-t border-slate-100">
                    <button onClick={() => navigate('/timer')} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors duration-150">
                      <Timer size={12} /> 番茄钟
                    </button>
                    <button onClick={() => navigate('/reviews')} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors duration-150">
                      <BookOpen size={12} /> 复盘
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </CalendarDragContext>
  )
}
