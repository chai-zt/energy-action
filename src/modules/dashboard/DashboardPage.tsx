import { useState, useEffect } from 'react'
import {
  DexieGoalRepository, DexieTaskRepository, DexieProjectRepository,
  DexieDailyStateRepository, DexieCompletionRepository, DexieScheduleRepository,
} from '@/storage/repositories'
import { priorityProvider } from '@/services/priorityProvider'
import { today, generateId } from '@/lib/utils'
import {
  AlertTriangle, CheckCircle2, Clock, TrendingUp, Zap,
  Brain, ChevronRight, Plus, Flame, CalendarCheck, Activity,
  BookOpen, SkipForward, RotateCcw, Trash2,
} from 'lucide-react'
import { shouldExecuteOnDate } from '@/services/recurrenceEngine'
import { getEnergyCost, calcRemainingEnergy } from '@/services/energyService'
import type { Task, Goal, AIPriorityResult, DailyState, CompletionRecord, TaskSchedule } from '@/domain/models'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { PriorityLegend } from '@/components/PriorityLegend'

/** 计算单个习惯任务的统计 */
function calcHabitStats(habitId: string, allRecords: CompletionRecord[]) {
  const todayStr = today()
  const records = allRecords
    .filter(r => r.taskId === habitId)
    .map(r => r.completedDate)
    .sort((a, b) => b.localeCompare(a)) // 最新的在前面

  if (records.length === 0) {
    return { streak: 0, total: 0, longest: 0, weekRate: 0, monthRate: 0, lastBreak: null as string | null }
  }

  // 当前连续天数
  let streak = 0
  const d = new Date(todayStr)
  for (let i = 0; i < 365; i++) {
    const checkDate = d.toISOString().split('T')[0]
    if (records.includes(checkDate)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }

  // 最长连续
  let longest = 0
  const sorted = records.sort()
  let currentRun = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = (curr.getTime() - prev.getTime()) / 86400000
    if (diff === 1) {
      currentRun++
    } else {
      longest = Math.max(longest, currentRun)
      currentRun = 1
    }
  }
  longest = Math.max(longest, currentRun)

  // 本周完成率（周一至周日）
  const now = new Date(todayStr)
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(monday.getDate() + mondayOffset)
  let weekDays = 0
  let weekCompleted = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    const ds = d.toISOString().split('T')[0]
    if (ds <= todayStr) {
      weekDays++
      if (records.includes(ds)) weekCompleted++
    }
  }
  const weekRate = weekDays > 0 ? Math.round((weekCompleted / weekDays) * 100) : 0

  // 本月完成率
  const monthStart = `${todayStr.slice(0, 7)}-01`
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  let monthDays = 0
  let monthCompleted = 0
  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i + 1)
    const ds = d.toISOString().split('T')[0]
    if (ds <= todayStr) {
      monthDays++
      if (records.includes(ds)) monthCompleted++
    }
  }
  const monthRate = monthDays > 0 ? Math.round((monthCompleted / monthDays) * 100) : 0

  // 最近中断日期（今天未完成且昨天也未完成）
  let lastBreak: string | null = null
  const yesterday = new Date(todayStr)
  yesterday.setDate(yesterday.getDate() - 1)
  if (streak === 0) {
    for (let i = 1; i < 365; i++) {
      const checkD = new Date(todayStr)
      checkD.setDate(checkD.getDate() - i)
      const ds = checkD.toISOString().split('T')[0]
      if (records.includes(ds)) {
        lastBreak = ds
        break
      }
    }
  }

  return { streak, total: records.length, longest, weekRate, monthRate, lastBreak }
}

// Keep the calcHabitStats function exportable for reuse
export { calcHabitStats }

function getRecurrenceLabel(rule: string): string {
  if (rule.startsWith('FREQ=DAILY')) return '每天'
  if (rule.includes('BYDAY=MO,WE,FR')) return '周一三五'
  if (rule.includes('BYDAY=')) return '指定星期'
  if (rule.includes('COUNT_TARGET=')) return `每周${rule.split('COUNT_TARGET=')[1].split(';')[0]}次`
  if (rule.includes('INTERVAL')) return `每${rule.split('DAYS=')[1].split(';')[0]}天`
  if (rule.startsWith('FREQ=WEEKLY')) return '每周'
  if (rule.startsWith('FREQ=MONTHLY')) return '每月'
  return ''
}

export function isTaskCompletedOnDate(task: Task, records: CompletionRecord[], date: string): boolean {
  if (!task.isHabit) return task.status === 'done'
  return records.some(record => record.taskId === task.id && record.completedDate === date && record.status === 'completed')
}

export function getTodayExecutionSections(tasks: Task[], records: CompletionRecord[], date: string) {
  const visibleTasks = tasks.filter(task => !task.deletedAt && task.status !== 'cancelled')
  const parentIds = new Set(visibleTasks.flatMap(task => task.parentTaskId ? [task.parentTaskId] : []))
  const completedToday = (task: Task) => (
    task.completedAt?.startsWith(date)
    || records.some(record => record.taskId === task.id && record.completedDate === date && record.status === 'completed')
  )
  const happenedToday = (task: Task) => (
    task.plannedDate === date
    || task.dueDate === date
    || completedToday(task)
  )
  const isActiveLargeTask = (task: Task) => (
    (task.status !== 'done' && task.createdAt.slice(0, 10) <= date)
    || completedToday(task)
  )
  const byCompletionThenOrder = (left: Task, right: Task) => (
    Number(isTaskCompletedOnDate(left, records, date)) - Number(isTaskCompletedOnDate(right, records, date))
    || (left.order || 0) - (right.order || 0)
    || right.createdAt.localeCompare(left.createdAt)
  )

  return {
    largeTasks: visibleTasks
      .filter(task => !task.parentTaskId && !task.isHabit && (task.taskKind === 'large' || parentIds.has(task.id)) && isActiveLargeTask(task))
      .sort(byCompletionThenOrder),
    habitTasks: visibleTasks
      .filter(task => !task.parentTaskId && task.isHabit && (shouldExecuteOnDate(task, date) || happenedToday(task)))
      .sort(byCompletionThenOrder),
  }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [dailyState, setDailyState] = useState<DailyState | null>(null)
  const [allCompletions, setAllCompletions] = useState<CompletionRecord[]>([])
  const [priorityResults, setPriorityResults] = useState<AIPriorityResult[]>([])
  const [loading, setLoading] = useState(true)

  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const [addingAsHabit, setAddingAsHabit] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [showDeferPicker, setShowDeferPicker] = useState(false)

  const todayStr = today()

  const refreshData = async () => {
    const taskRepo = new DexieTaskRepository()
    const goalRepo = new DexieGoalRepository()
    const projectRepo = new DexieProjectRepository()
    const stateRepo = new DexieDailyStateRepository()
    const compRepo = new DexieCompletionRepository()

    const [allTasks, allGoals, allProjects, state, allCompletionRecords] = await Promise.all([
      taskRepo.getAll(),
      goalRepo.getAll(),
      projectRepo.getAll(),
      stateRepo.getByDate(todayStr),
      compRepo.getAll(),
    ])

    setTasks(allTasks.filter(t => !t.deletedAt))
    setGoals(allGoals.filter(g => g.status === 'active' && !g.deletedAt))
    setDailyState(state || null)
    setAllCompletions(allCompletionRecords)

    const result = await priorityProvider.prioritize({
      tasks: allTasks.filter(t => !t.deletedAt),
      goals: allGoals,
      projects: allProjects,
      dailyState: state || null,
      completionRecords: allCompletionRecords,
    })
    setPriorityResults(result.results)
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        await refreshData()
      } catch (e) {
        console.error('Dashboard load failed:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleQuickAdd = async (asHabit = false) => {
    if (!quickTitle.trim()) return
    const repo = new DexieTaskRepository()
    await repo.create({
      id: crypto.randomUUID(),
      title: quickTitle.trim(),
      description: '',
      projectId: null,
      goalId: null,
      keyResultId: null,
      columnId: null,
      status: 'todo',
      userPriority: null,
      aiPriorityScore: 0,
      aiPriorityLevel: null,
      aiPriorityReason: '',
      dueDate: null,
      plannedDate: asHabit ? null : todayStr,
      estimatedMinutes: 30,
      actualMinutes: 0,
      cognitiveLoad: 'medium',
      energyDemand: 3,
      recurrenceRule: asHabit ? 'FREQ=DAILY' : null,
      isHabit: asHabit,
      completedAt: null,
      parentTaskId: null,
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    setQuickTitle('')
    setShowQuickAdd(false)
    setAddingAsHabit(false)
    await refreshData()
  }

  const handleToggleTodayTask = async (task: Task) => {
    const taskRepo = new DexieTaskRepository()
    const completionRepo = new DexieCompletionRepository()
    const records = await completionRepo.getByTaskId(task.id)
    const existing = records.find(record => record.completedDate === todayStr && record.status === 'completed')

    if (existing) {
      await completionRepo.delete(existing.id)
      if (!task.isHabit) await taskRepo.update(task.id, { status: 'todo', completedAt: null })
    } else {
      const timestamp = new Date().toISOString()
      await completionRepo.create({
        id: generateId(),
        taskId: task.id,
        completedDate: todayStr,
        completedAt: timestamp,
        status: 'completed',
        energyCostSnapshot: getEnergyCost({ energyDemand: task.energyDemand }),
        rewardPoints: 1,
        taskTitleSnapshot: task.title,
        projectIdSnapshot: task.projectId,
        createdAt: timestamp,
      })
      if (!task.isHabit) await taskRepo.update(task.id, { status: 'done', completedAt: timestamp })
    }

    await refreshData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  const activeTasks = tasks.filter(
    t => t.status !== 'done' && t.status !== 'cancelled' && !t.deletedAt
  )
  const overdueTasks = activeTasks.filter(
    t => t.dueDate && t.dueDate < todayStr
  )
  const unscheduledTasks = activeTasks.filter(
    t => !t.plannedDate && t.status !== 'inbox'
  )
  const { largeTasks: todayLargeTasks, habitTasks: todayHabitTasks } = getTodayExecutionSections(tasks, allCompletions, todayStr)
  const todayTasks = [...todayLargeTasks, ...todayHabitTasks]
  const completedToday = todayTasks.filter(task => isTaskCompletedOnDate(task, allCompletions, todayStr))

  // 精力计算
  const energy = calcRemainingEnergy(tasks, allCompletions, todayStr)

  // 问候语
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]

  const renderTodaySection = (id: string, title: string, description: string, sectionTasks: Task[]) => {
    const completedCount = sectionTasks.filter(task => isTaskCompletedOnDate(task, allCompletions, todayStr)).length
    return (
      <section aria-labelledby={id}>
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <h3 id={id} className="text-sm font-semibold text-slate-800">{title}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{description}</p>
          </div>
          <span className="text-[11px] tabular-nums text-slate-400 flex-shrink-0">{completedCount}/{sectionTasks.length} 完成</span>
        </div>
        {sectionTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-400">
            今天没有{title}
          </div>
        ) : (
          <div className="space-y-1">
            {sectionTasks.map(task => {
              const isCompleted = isTaskCompletedOnDate(task, allCompletions, todayStr)
              const priority = priorityResults.find(result => result.taskId === task.id)
              return (
                <div key={task.id} className={cn('group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50', isCompleted && 'opacity-65')}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isCompleted}
                    aria-label={`${isCompleted ? '取消完成' : '完成'} ${task.title}`}
                    onClick={() => void handleToggleTodayTask(task)}
                    className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-green-200',
                      isCompleted ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400',
                    )}
                  >
                    {isCompleted && <CheckCircle2 size={11} className="text-white" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm truncate', isCompleted ? 'line-through text-slate-400' : 'text-slate-700')}>{task.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span className={task.isHabit ? 'text-emerald-600' : 'text-violet-600'}>{task.isHabit ? '习惯' : '大任务'}</span>
                      {task.isHabit && task.recurrenceRule && <span>{getRecurrenceLabel(task.recurrenceRule)}</span>}
                      {task.estimatedMinutes > 0 && <span>{task.estimatedMinutes} 分钟</span>}
                    </div>
                  </div>
                  {!isCompleted && priority && (
                    <span className={cn(
                      'badge text-[10px] flex-shrink-0',
                      priority.level === 'P0' ? 'badge-p0' : priority.level === 'P1' ? 'badge-p1' : priority.level === 'P2' ? 'badge-p2' : 'badge-p3',
                    )}>{priority.level}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 日期问候 + 快捷新增 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            {greeting} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {todayStr} 星期{weekday}
          </p>
        </div>
        <button
          onClick={() => setShowQuickAdd(true)}
          className="btn-primary flex items-center gap-1.5"
        >
          <Plus size={16} /> 快速新增
        </button>
      </div>

      {/* 快捷新增弹窗 */}
      {showQuickAdd && (
        <div className="card border-blue-200">
          {addingAsHabit && <p className="text-[10px] text-blue-600 mb-1">新增固定任务（默认每天）</p>}
          <input
            className="input text-sm"
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleQuickAdd(addingAsHabit)}
            placeholder={addingAsHabit ? "输入固定任务名称..." : "输入任务，按回车添加..."}
            autoFocus
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button onClick={() => { setShowQuickAdd(false); setAddingAsHabit(false); setQuickTitle('') }} className="btn-ghost text-xs">取消</button>
            <button onClick={() => handleQuickAdd(addingAsHabit)} className="btn-primary text-xs" disabled={!quickTitle.trim()}>添加</button>
          </div>
        </div>
      )}

      {/* 状态卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard
          icon={<AlertTriangle size={18} />}
          bgColor="bg-red-50"
          iconColor="text-red-500"
          label="逾期"
          value={overdueTasks.length}
          valueColor="text-red-600"
          onClick={() => navigate('/tasks?filter=overdue')}
        />
        <StatusCard
          icon={<Clock size={18} />}
          bgColor="bg-blue-50"
          iconColor="text-blue-500"
          label="今日任务"
          value={todayTasks.length}
          valueColor="text-blue-600"
          onClick={() => navigate('/tasks?view=today')}
        />
        <StatusCard
          icon={<CheckCircle2 size={18} />}
          bgColor="bg-green-50"
          iconColor="text-green-500"
          label="已完成"
          value={completedToday.length}
          valueColor="text-green-600"
        />
        <StatusCard
          icon={<TrendingUp size={18} />}
          bgColor="bg-purple-50"
          iconColor="text-purple-500"
          label="活跃目标"
          value={goals.length}
          valueColor="text-purple-600"
          onClick={() => navigate('/goals')}
        />
      </div>

      {/* 精力预算概览 */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-600">今日精力</h3>
          <span className={cn(
            'text-xs font-bold',
            energy.remaining < 20 ? 'text-red-500' : energy.remaining < 50 ? 'text-amber-500' : 'text-green-500'
          )}>
            {energy.consumed > energy.budget ? `超额 ${energy.consumed - energy.budget}` : `${energy.remaining} / ${energy.budget}`}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
          <div className={cn(
            'h-2 rounded-full transition-all',
            energy.consumed > energy.budget ? 'bg-red-500' : energy.remaining < 20 ? 'bg-red-500' : energy.remaining < 50 ? 'bg-amber-500' : 'bg-green-500'
          )} style={{ width: `${Math.min(100, (energy.consumed / energy.budget) * 100)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px] mt-2">
          <div>
            <p className="text-slate-400">固定预占</p>
            <p className="font-bold text-slate-600">{energy.fixedPlanned}</p>
          </div>
          <div>
            <p className="text-slate-400">已计划</p>
            <p className="font-bold text-slate-600">{energy.planned}</p>
          </div>
          <div>
            <p className="text-slate-400">已消耗</p>
            <p className="font-bold text-slate-600">{energy.consumed}</p>
          </div>
          <div>
            <p className="text-slate-400">普通计划</p>
            <p className="font-bold text-slate-600">{energy.ordinaryPlanned}</p>
          </div>
          <div>
            <p className="text-slate-400">剩余</p>
            <p className="font-bold text-slate-600">{energy.remaining}</p>
          </div>
          <div>
            <p className="text-slate-400">还可安排</p>
            <p className="font-bold text-slate-600">{energy.available}</p>
          </div>
        </div>
        {energy.planned > 100 && (
          <p className="text-[10px] text-amber-600 mt-1">⚠️ 已计划 {energy.planned} 点，超出每日预算</p>
        )}
      </div>

      {/* 今日精力状态 */}
      {dailyState && (
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <Zap size={18} className="text-amber-500" />
            </div>
            <div className="flex-1 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-500">精力</p>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-slate-700">{dailyState.energyScore}</span>
                  <span className="text-xs text-slate-400">/10</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500">情绪</p>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-slate-700">{dailyState.moodScore}</span>
                  <span className="text-xs text-slate-400">/10</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500">压力</p>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-slate-700">{dailyState.stressScore}</span>
                  <span className="text-xs text-slate-400">/10</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/reviews')}
              className="btn-ghost text-xs flex items-center gap-1"
            >
              更新 <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 今天要处理（逾期） */}
      {overdueTasks.length > 0 && (
        <div className="card border-red-100 bg-red-50/30">
          <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" />
            今天要处理 ({overdueTasks.length})
          </h2>
          <div className="space-y-2">
            {overdueTasks.map(task => {
              const isExpanded = expandedTaskId === task.id
              return (
                <div key={task.id}>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-red-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{task.title}</p>
                      <p className="text-xs text-red-500">逾期至 {task.dueDate}</p>
                    </div>
                    <button
                      className="btn-primary text-xs py-1.5 px-3"
                      onClick={() => {
                        setExpandedTaskId(isExpanded ? null : task.id)
                        setShowDeferPicker(false)
                      }}
                    >
                      {isExpanded ? '收起' : '立即处理'}
                    </button>
                  </div>

                  {/* 展开操作区 */}
                  {isExpanded && (
                    <div className="mt-1 p-3 rounded-lg bg-white border border-slate-200 space-y-3">
                      {/* 任务信息 */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                        <span>优先级: {task.userPriority || '未设置'}</span>
                        <span>精力: {getEnergyCost({ energyDemand: task.energyDemand })}点</span>
                        {task.estimatedMinutes > 0 && <span>预计: {task.estimatedMinutes}分</span>}
                      </div>

                      {/* 操作按钮行 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={async () => {
                            const repo = new DexieTaskRepository()
                            await repo.update(task.id, { status: 'doing' as const })
                            await refreshData()
                            setExpandedTaskId(null)
                          }}
                          disabled={task.status === 'doing'}
                          className={cn(
                            'btn-secondary text-xs py-1 px-2.5',
                            task.status === 'doing' && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {task.status === 'doing' ? '处理中' : '开始处理'}
                        </button>

                        <button
                          onClick={async () => {
                            const { db } = await import('@/storage/db')
                            const todayStr2 = today()
                            // 创建完成记录
                            await db.completionRecords.add({
                              id: generateId(),
                              taskId: task.id,
                              completedDate: todayStr2,
                              completedAt: new Date().toISOString(),
                              status: 'completed',
                              energyCostSnapshot: getEnergyCost({ energyDemand: task.energyDemand }),
                              taskTitleSnapshot: task.title,
                              projectIdSnapshot: task.projectId,
                              createdAt: new Date().toISOString(),
                            })
                            // 更新任务状态
                            const repo = new DexieTaskRepository()
                            await repo.update(task.id, { status: 'done' as const, completedAt: new Date().toISOString() })
                            await refreshData()
                            setExpandedTaskId(null)
                          }}
                          className="btn-success text-xs py-1 px-2.5"
                        >
                          完成
                        </button>

                        <div className="flex items-center gap-1">
                          {!showDeferPicker ? (
                            <button
                              onClick={() => setShowDeferPicker(true)}
                              className="btn-ghost text-xs py-1 px-2.5"
                            >
                              延期
                            </button>
                          ) : (
                            <>
                              <input
                                type="date"
                                className="input text-xs py-1 px-2 w-32"
                                min={todayStr}
                                defaultValue={task.plannedDate || todayStr}
                                id={`defer-${task.id}`}
                              />
                              <button
                                onClick={async () => {
                                  const input = document.getElementById(`defer-${task.id}`) as HTMLInputElement
                                  const newDate = input?.value
                                  if (!newDate) return
                                  const repo = new DexieTaskRepository()
                                  await repo.update(task.id, { plannedDate: newDate, dueDate: undefined as any })
                                  await refreshData()
                                  setExpandedTaskId(null)
                                  setShowDeferPicker(false)
                                }}
                                className="btn-primary text-xs py-1 px-2"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setShowDeferPicker(false)}
                                className="btn-ghost text-xs py-1 px-2"
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 今日执行中心 */}
      <div className="card">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 whitespace-nowrap">
            <Brain size={18} className="text-blue-500" />
            今日执行中心
          </h2>
          <div className="hidden md:block"><PriorityLegend /></div>
        </div>

        <div className="space-y-4">
          {renderTodaySection('today-large-tasks', '大任务', '今天需要推进的重点事项', todayLargeTasks)}
          <div className="border-t border-slate-100" />
          {renderTodaySection('today-habits', '习惯与固定任务', '今天需要完成的重复行动', todayHabitTasks)}
        </div>

      </div>

      {/* 未排期任务 */}
      {unscheduledTasks.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-3">待排期 ({unscheduledTasks.length})</h2>
          <div className="space-y-1">
            {unscheduledTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center gap-2 p-2 text-sm text-slate-600 hover:bg-slate-50 rounded">
                <Clock size={14} className="text-slate-400 flex-shrink-0" />
                <span className="truncate">{task.title}</span>
                {task.estimatedMinutes > 0 && (
                  <span className="text-xs text-slate-400 flex-shrink-0">{task.estimatedMinutes}分</span>
                )}
              </div>
            ))}
            {unscheduledTasks.length > 5 && (
              <button onClick={() => navigate('/calendar')} className="btn-ghost text-xs w-full mt-1">
                查看全部 {unscheduledTasks.length} 个任务
              </button>
            )}
          </div>
        </div>
      )}

      {/* 晚间复盘入口 */}
      <div className="card bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <BookOpen size={18} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">今日复盘</h3>
              <p className="text-xs text-slate-500">记录今天的收获和明天计划</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/reviews')}
            className="btn-primary text-xs py-2 px-4 bg-indigo-500 hover:bg-indigo-600"
          >
            开始复盘
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusCard({
  icon, bgColor, iconColor, label, value, valueColor, onClick,
}: {
  icon: React.ReactNode
  bgColor: string
  iconColor: string
  label: string
  value: number
  valueColor: string
  onClick?: () => void
}) {
  return (
    <div
      className={cn('card flex items-center gap-3', onClick && 'cursor-pointer hover:border-blue-200 transition-colors')}
      onClick={onClick}
    >
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', bgColor)}>
        <div className={iconColor}>{icon}</div>
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className={cn('text-lg font-bold', valueColor)}>{value}</p>
      </div>
    </div>
  )
}
