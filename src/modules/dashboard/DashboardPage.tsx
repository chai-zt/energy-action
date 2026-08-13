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
  FolderKanban, BookOpen, SkipForward, RotateCcw, Trash2,
} from 'lucide-react'
import { shouldExecuteOnDate } from '@/services/recurrenceEngine'
import { getEnergyCost, calcRemainingEnergy } from '@/services/energyService'
import type { Task, Goal, Project, AIPriorityResult, DailyState, CompletionRecord, TaskSchedule } from '@/domain/models'
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

export function DashboardPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [dailyState, setDailyState] = useState<DailyState | null>(null)
  const [completions, setCompletions] = useState<CompletionRecord[]>([])
  const [allCompletions, setAllCompletions] = useState<CompletionRecord[]>([])
  const [priorityResults, setPriorityResults] = useState<AIPriorityResult[]>([])
  const [loading, setLoading] = useState(true)

  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const [addingAsHabit, setAddingAsHabit] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [showDeferPicker, setShowDeferPicker] = useState(false)
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [projectDailyLogs, setProjectDailyLogs] = useState<Record<string, any[]>>({})
  const [projectLogInput, setProjectLogInput] = useState('')
  const [showAllProjects, setShowAllProjects] = useState(false)

  const todayStr = today()

  const refreshData = async () => {
    const taskRepo = new DexieTaskRepository()
    const goalRepo = new DexieGoalRepository()
    const projectRepo = new DexieProjectRepository()
    const stateRepo = new DexieDailyStateRepository()
    const compRepo = new DexieCompletionRepository()

    const [allTasks, allGoals, allProjects, state, todayCompletions] = await Promise.all([
      taskRepo.getAll(),
      goalRepo.getAll(),
      projectRepo.getAll(),
      stateRepo.getByDate(todayStr),
      compRepo.getByDate(todayStr),
    ])

    const { db } = await import('@/storage/db')
    const allCompletionsData = await db.completionRecords.toArray()

    setTasks(allTasks.filter(t => !t.deletedAt))
    setGoals(allGoals.filter(g => g.status === 'active' && !g.deletedAt))
    setProjects(allProjects.filter(p => !p.deletedAt))
    setDailyState(state || null)
    setCompletions(todayCompletions)
    setAllCompletions(allCompletionsData)

    const result = await priorityProvider.prioritize({
      tasks: allTasks.filter(t => !t.deletedAt),
      goals: allGoals,
      projects: allProjects,
      dailyState: state || null,
      completionRecords: allCompletionsData,
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

  // 启动时补齐缺失的 ProjectDailyLog
  useEffect(() => {
    const catchUp = async () => {
      const { db } = await import('@/storage/db')
      const activeProjects = projects.filter(p => !p.deletedAt && p.status !== 'completed' && p.startDate)
      const allLogs = await db.projectDailyLogs.toArray()
      const { generateAutoLog, getMissingDates } = await import('@/services/projectDailyLogService')

      for (const p of activeProjects) {
        const existingDates = new Set(allLogs.filter(l => l.projectId === p.id).map(l => l.date))
        const missing = getMissingDates(p, existingDates, todayStr)
        for (const date of missing) {
          const log = generateAutoLog(p, date, tasks, allCompletions, [])
          await db.projectDailyLogs.put(log)
        }
      }
      // 重新加载日志
      const updated = await db.projectDailyLogs.toArray()
      const grouped: Record<string, any[]> = {}
      for (const log of updated) {
        if (!grouped[log.projectId]) grouped[log.projectId] = []
        grouped[log.projectId].push(log)
      }
      setProjectDailyLogs(grouped)
    }
    if (projects.length > 0) catchUp()
  }, [projects.length])

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
  const todayTasks = activeTasks.filter(
    t => t.plannedDate === todayStr || t.dueDate === todayStr || t.isHabit
  )
  const unscheduledTasks = activeTasks.filter(
    t => !t.plannedDate && t.status !== 'inbox'
  )
  const habitTasks = tasks.filter(t => t.isHabit && !t.deletedAt).sort((a, b) => (a.order || 0) - (b.order || 0))
  const completedToday = tasks.filter(
    t => t.status === 'done' && t.completedAt && t.completedAt.startsWith(todayStr)
  )

  // 今日所有应执行的任务（普通+固定）
  const todayHabitTasks = habitTasks.filter(t => shouldExecuteOnDate(t, todayStr))
  const allTodayTaskIds = new Set([
    ...todayTasks.map(t => t.id),
    ...todayHabitTasks.map(t => t.id),
  ])
  const allTodayTasks = tasks.filter(t => allTodayTaskIds.has(t.id))

  // 今日优先级排序（全部今天任务参与）
  const allTodaySorted = priorityResults
    .filter(r => allTodayTaskIds.has(r.taskId))
    .map(r => tasks.find(t => t.id === r.taskId)!)
    .filter(Boolean)
  const incompleteToday = allTodaySorted.filter(t => t.status !== 'done')
  const completedTodaySorted = allTodaySorted.filter(t => t.status === 'done')

  // 精力计算
  const energy = calcRemainingEnergy(tasks, allCompletions, todayStr)

  // 问候语
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Brain size={18} className="text-blue-500" />
            今日执行中心
          </h2>
          <PriorityLegend />
        </div>

        {/* 固定任务快捷区 */}
        <div className="mb-3 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-slate-500">
              今日固定任务 {
                todayHabitTasks.filter(t =>
                  allCompletions.some(c => c.taskId === t.id && c.completedDate === todayStr && c.status === 'completed')
                ).length
              }/{todayHabitTasks.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setAddingAsHabit(true); setShowQuickAdd(true) }} className="btn-ghost text-[10px] flex items-center gap-0.5">
                <Plus size={11} /> 添加
              </button>
              <button onClick={() => navigate('/tasks?view=habits')} className="btn-ghost text-[10px]">
                管理
              </button>
            </div>
          </div>
          {todayHabitTasks.length === 0 ? (
            <p className="text-[10px] text-slate-400">今天没有固定任务</p>
          ) : (
            <div className="flex items-center flex-wrap gap-1.5">
              {todayHabitTasks.map(ht => {
                const doneRec = allCompletions.find(c => c.taskId === ht.id && c.completedDate === todayStr && c.status === 'completed')
                const isDone = !!doneRec
                return (
                  <button
                    key={ht.id}
                    onClick={async () => {
                      const { db } = await import('@/storage/db')
                      const repo = new DexieTaskRepository()
                      if (isDone) {
                        // 撤回：删除 CompletionRecord + 重置任务状态
                        const rec = await db.completionRecords
                          .where({ taskId: ht.id, completedDate: todayStr, status: 'completed' as const })
                          .first()
                        if (rec) await db.completionRecords.delete(rec.id)
                        await repo.update(ht.id, { status: 'todo' as const, completedAt: null as any })
                      } else {
                        // 完成：创建 CompletionRecord + 更新状态
                        await db.completionRecords.add({
                          id: generateId(),
                          taskId: ht.id, completedDate: todayStr,
                          completedAt: new Date().toISOString(),
                          status: 'completed',
                          energyCostSnapshot: getEnergyCost({ energyDemand: ht.energyDemand }),
                          taskTitleSnapshot: ht.title, projectIdSnapshot: ht.projectId,
                          createdAt: new Date().toISOString(),
                        })
                        await repo.update(ht.id, { status: 'done' as const, completedAt: new Date().toISOString() })
                      }
                      await refreshData()
                    }}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                      isDone ? 'bg-green-100 border-green-300 text-green-700 line-through' : 'border-slate-200 text-slate-600 hover:border-green-300'
                    )}
                  >
                    {isDone ? `✓ ${ht.title}` : `○ ${ht.title}`}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 今日任务统一排序 */}
        {allTodaySorted.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-2">今日暂无任务</p>
        ) : (
          <div>
            {/* 未完成任务 */}
            {incompleteToday.length > 0 && (
              <div className="space-y-1.5">
                {incompleteToday.map((task, i) => {
                  const pr = priorityResults.find(r => r.taskId === task!.id)
                  return (
                    <div key={task!.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 group">
                      <span className={cn(
                        'w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0',
                        i === 0 ? 'bg-red-100 text-red-700' :
                        i === 1 ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      )}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 truncate">
                          {task!.title}
                          {task!.isHabit && <span className="ml-1 text-[10px] text-green-600 font-normal">固定</span>}
                        </p>
                        {pr && <p className="text-xs text-slate-400">{pr.reason}</p>}
                      </div>
                      {pr && (
                        <span className={cn(
                          'badge text-[10px] flex-shrink-0',
                          pr.level === 'P0' ? 'badge-p0' :
                          pr.level === 'P1' ? 'badge-p1' :
                          pr.level === 'P2' ? 'badge-p2' : 'badge-p3'
                        )}>
                          {pr.level} · {pr.score}分
                        </span>
                      )}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={async () => {
                            const { db } = await import('@/storage/db')
                            await db.completionRecords.add({
                              id: generateId(),
                              taskId: task!.id, completedDate: todayStr,
                              completedAt: new Date().toISOString(),
                              status: 'completed',
                              energyCostSnapshot: getEnergyCost({ energyDemand: task!.energyDemand }),
                              taskTitleSnapshot: task!.title, projectIdSnapshot: task!.projectId,
                              createdAt: new Date().toISOString(),
                            })
                            const repo = new DexieTaskRepository()
                            await repo.update(task!.id, { status: 'done' as const, completedAt: new Date().toISOString() })
                            await refreshData()
                          }}
                          className="btn-ghost text-[10px] py-0.5 px-1.5"
                        >
                          完成
                        </button>
                        <button
                          onClick={() => {
                            const d = document.getElementById(`defer2-${task!.id}`) as HTMLInputElement
                            if (d) { d.showPicker(); return }
                            const input = document.createElement('input')
                            input.type = 'date'
                            input.id = `defer2-${task!.id}`
                            input.style.cssText = 'position:absolute;opacity:0;pointer-events:none'
                            document.body.appendChild(input)
                            input.addEventListener('change', async () => {
                              if (!input.value) return
                              const repo = new DexieTaskRepository()
                              await repo.update(task!.id, { plannedDate: input.value, dueDate: undefined as any })
                              await refreshData()
                              document.body.removeChild(input)
                            })
                            input.showPicker()
                          }}
                          className="btn-ghost text-[10px] py-0.5 px-1.5"
                        >
                          延期
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 已完成任务 */}
            {completedTodaySorted.length > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-100">
                <p className="text-[11px] font-medium text-slate-400 mb-1">
                  已完成（{completedTodaySorted.length}）
                </p>
                <div className="space-y-1">
                  {completedTodaySorted.map(task => (
                    <div key={task!.id} className="flex items-center gap-2 p-1.5 rounded text-xs text-slate-400 line-through hover:bg-slate-50">
                      <span className="w-5 text-green-500 flex-shrink-0">✓</span>
                      <span className="flex-1 truncate">{task!.title}</span>
                      <button
                        onClick={async () => {
                          const { db } = await import('@/storage/db')
                          const rec = await db.completionRecords
                            .where({ taskId: task!.id, completedDate: todayStr, status: 'completed' as const })
                            .first()
                          if (rec) await db.completionRecords.delete(rec.id)
                          const repo = new DexieTaskRepository()
                          await repo.update(task!.id, { status: 'todo' as const, completedAt: null as any })
                          await refreshData()
                        }}
                        className="btn-ghost text-[10px] py-0.5 px-1.5 text-slate-400 hover:text-blue-500"
                      >
                        撤回
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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

      {/* 活跃项目（短期目标追踪） */}
      {projects.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <FolderKanban size={18} className="text-blue-500" />
              活跃项目 ({projects.length})
            </h2>
            <button onClick={() => setShowAllProjects(!showAllProjects)} className="btn-ghost text-xs flex items-center gap-1">
              {showAllProjects ? '收起' : '查看全部'} <ChevronRight size={12} className={showAllProjects ? 'rotate-90' : ''} />
            </button>
          </div>
          <div className="space-y-2">
            {(showAllProjects ? projects : projects.slice(0, 3)).map(p => {
              const isExpanded = expandedProjectId === p.id
              const logs = (projectDailyLogs[p.id] || []).sort((a: any, b: any) => b.date.localeCompare(a.date))
              const isCompleted = p.status === 'completed'
              return (
                <div key={p.id}>
                  {/* 项目卡片 */}
                  <div
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedProjectId(isExpanded ? null : p.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className={cn('text-sm truncate', isCompleted ? 'text-slate-400 line-through' : 'text-slate-700')}>
                        {p.name}
                      </span>
                      {p.startDate && <span className="text-[10px] text-slate-400 flex-shrink-0">{p.startDate}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-12 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${p.progress}%`, backgroundColor: p.color }} />
                      </div>
                      <span className="text-[10px] text-slate-400">{p.progress}%</span>
                    </div>
                  </div>

                  {/* 展开的项目详情 */}
                  {isExpanded && (
                    <div className="mt-1 p-3 rounded-lg bg-white border border-slate-200 space-y-3">
                      {/* 状态信息 */}
                      <div className="flex items-center gap-4 text-[10px] text-slate-500">
                        {p.startDate && <span>开始: {p.startDate}</span>}
                        {p.completedAt && <span>完成: {p.completedAt}</span>}
                        <span className={p.status === 'active' ? 'text-blue-500' : 'text-green-500'}>
                          {p.status === 'active' ? '进行中' : '已完成'}
                        </span>
                      </div>

                      {/* 手动记录输入 */}
                      {!isCompleted && (
                        <div className="flex gap-2">
                          <input
                            className="input text-xs flex-1"
                            placeholder="记录今天的进展……"
                            value={projectLogInput}
                            onChange={e => setProjectLogInput(e.target.value)}
                            onKeyDown={async e => {
                              if (e.key === 'Enter' && projectLogInput.trim()) {
                                const { db } = await import('@/storage/db')
                                const genId = crypto.randomUUID(); const ts = new Date().toISOString()
                                await db.projectDailyLogs.put({
                                  id: genId, projectId: p.id, date: todayStr, source: 'manual',
                                  summary: projectLogInput.trim(), tasksCompleted: 0, tasksCreated: 0, focusMinutes: 0,
                                  createdAt: ts, updatedAt: ts,
                                })
                                setProjectLogInput('')
                                const updated = await db.projectDailyLogs.toArray()
                                const grouped = { ...projectDailyLogs }
                                for (const log of updated) {
                                  if (!grouped[log.projectId]) grouped[log.projectId] = []
                                  const idx = grouped[log.projectId].findIndex((l: any) => l.id === log.id)
                                  if (idx >= 0) grouped[log.projectId][idx] = log
                                  else grouped[log.projectId].push(log)
                                }
                                setProjectDailyLogs(grouped)
                              }
                            }}
                          />
                        </div>
                      )}

                      {/* 完成项目按钮 */}
                      {!isCompleted && (
                        <button
                          onClick={async () => {
                            if (!confirm(`确定完成项目"${p.name}"吗？`)) return
                            const repo = new DexieProjectRepository()
                            await repo.update(p.id, { status: 'completed', completedAt: todayStr } as any)
                            await refreshData()
                            setExpandedProjectId(null)
                          }}
                          className="btn-success text-xs py-1 px-2.5"
                        >
                          完成项目
                        </button>
                      )}

                      {/* 时间线 */}
                      {logs.length > 0 && (
                        <div className="border-t border-slate-100 pt-2">
                          <p className="text-[10px] text-slate-400 mb-1">每日进展</p>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {logs.map((log: any) => (
                              <div key={log.id} className="text-[10px]">
                                <span className="text-slate-400">{log.date}</span>
                                <span className={cn(
                                  'ml-1 px-1 rounded text-[9px]',
                                  log.source === 'manual' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                                )}>
                                  {log.source === 'manual' ? '手动' : '自动'}
                                </span>
                                <p className="text-slate-600 mt-0.5 ml-0">{log.summary}</p>
                                {(log.tasksCompleted > 0 || log.focusMinutes > 0) && (
                                  <p className="text-slate-400 mt-0.5">
                                    {log.tasksCompleted > 0 && `完成${log.tasksCompleted}任务 `}
                                    {log.focusMinutes > 0 && `专注${log.focusMinutes}分`}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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
