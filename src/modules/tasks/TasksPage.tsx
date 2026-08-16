import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DndContext, pointerWithin, PointerSensor, useSensor, useSensors,
  type DragEndEvent, useDraggable, useDroppable,
  DragOverlay,
} from '@dnd-kit/core'
import {
  Plus, CheckSquare, Inbox, CalendarDays, List, Search, Tag as TagIcon,
  X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock,
  CheckCircle2, ListTree, Trash2, RotateCcw, RefreshCw, Zap, Timer, BookOpen, Edit2, Activity, Loader2,
} from 'lucide-react'
import {
  DexieTaskRepository, DexieTagRepository,
  DexieDailyStateRepository, DexieDailyReviewRepository,
  DexieTimeRecordRepository, DexieCompletionRepository,
  DexiePomodoroRepository,
} from '@/storage/repositories'
import {
  cn, generateId, now, today, getMonthGrid, isSameDay,
  addDays, addMonths, formatLongDate, formatMonthTitle,
} from '@/lib/utils'
import { shouldExecuteOnDate } from '@/services/recurrenceEngine'
import { getEnergyCost, calcPlannedEnergy } from '@/services/energyService'
import { getActionCoins } from '@/services/rewardService'
import { createTask as apiCreateTask, decomposeTask as apiDecomposeTask, getChildTasks as apiGetChildTasks, getMinimumAction as apiGetMinimumAction, getRecycledTasks as apiGetRecycledTasks, moveTask as apiMoveTask, restoreTask as apiRestoreTask, softDeleteTask as apiSoftDeleteTask, updateMinAction as apiUpdateMinAction, regenerateMinimumAction as apiRegenerateMinimumAction, type RecycledTask } from '@/services/apiClient'
import { DexieExecutionStepRepository, DexieMinimumActionRepository } from '@/storage/repositories'
import { getAiStatus } from '@/services/aiConfigApi'
import { getCurrentEnergy } from '@/services/currentEnergy'
import { AiModelConfigForm } from '@/components/AiModelConfigForm'
import type {
  Task, Tag, CognitiveLoad, DailyState, DailyReview,
  TimeRecord, PomodoroSession, CompletionRecord, TaskStatus, EnergyDemand,
  ExecutionStep, MinimumAction,
} from '@/domain/models'

type TaskView = 'unscheduled' | 'today' | 'all' | 'habits'

const SELECTED_DATE_KEY = 'tasks_page_selected_date'

const taskCopy = {
  createFailed: '任务创建失败，请确认后端服务正在运行后重试。',
  creating: '创建中…',
  loadFailed: '任务数据加载失败，请确认后端服务正在运行后重试。',
  retry: '重新加载',
} as const

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<TaskView>('all')
  const [search, setSearch] = useState('')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([])
  const [legacyStepsByTask, setLegacyStepsByTask] = useState<Record<string, ExecutionStep[]>>({})
  const [decompState, setDecompState] = useState<Record<string, 'generating' | 'completed' | 'failed'>>({})
  const [childTasks, setChildTasks] = useState<Record<string, Task[]>>({})
  const [minimumActions, setMinimumActions] = useState<Record<string, MinimumAction | null>>({})
  const [editingMA, setEditingMA] = useState<{ taskId: string; value: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ task: Task; descendantCount: number } | null>(null)
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const [recycledTasks, setRecycledTasks] = useState<RecycledTask[]>([])
  const [showTagManager, setShowTagManager] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [undoInfo, setUndoInfo] = useState<{ taskId: string; oldDate: string | null } | null>(null)
  const [toast, setToast] = useState('')
  const [aiAvailable, setAiAvailable] = useState<boolean>(false)
  const [configPromptOpen, setConfigPromptOpen] = useState(false)

  // 右侧日历状态 — 每次进入页面初始化为今天
  const [selectedDate, setSelectedDate] = useState<string>(today())
  const [dragTargetDate, setDragTargetDate] = useState<string | null>(null)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const [viewYearVal, viewMonVal] = viewMonth.split('-').map(Number)
  const monthStart = `${viewMonth}-01`
  const monthEnd = `${viewMonth}-${new Date(viewYearVal, viewMonVal, 0).getDate()}`
  const inMonthRange = (t: Task) => !!(t.plannedDate && t.plannedDate >= monthStart && t.plannedDate <= monthEnd)

  const goToMonth = (dir: number) => {
    const d = new Date(viewYearVal, viewMonVal - 1 + dir, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    return new Date(selectedDate)
  })
  const [dayTasks, setDayTasks] = useState<Task[]>([])
  const [dayState, setDayState] = useState<DailyState | null>(null)
  const [dayReview, setDayReview] = useState<DailyReview | null>(null)
  const [dayTimeRecords, setDayTimeRecords] = useState<TimeRecord[]>([])
  const [dayPomodoros, setDayPomodoros] = useState<PomodoroSession[]>([])
  const [dayCompletions, setDayCompletions] = useState<CompletionRecord[]>([])
  const [allCompletions, setAllCompletions] = useState<CompletionRecord[]>([])
  const [showDone, setShowDone] = useState(false)
  const [showStatePanel, setShowStatePanel] = useState(false)
  const [mobileTab, setMobileTab] = useState<'tasks' | 'calendar'>('tasks')

  const taskRepo = new DexieTaskRepository()
  const tagRepo = new DexieTagRepository()
  const completionRepo = new DexieCompletionRepository()
  const hasChildren = useCallback(
    (taskId: string) => tasks.some(task => task.parentTaskId === taskId && !task.deletedAt),
    [tasks],
  )
  const isLargeTask = useCallback((task: Task) => task.taskKind === 'large' || (!task.taskKind && hasChildren(task.id)), [hasChildren])
  const getDescendantCount = useCallback((taskId: string) => {
    const ids = new Set([taskId])
    let changed = true
    while (changed) {
      changed = false
      tasks.forEach(task => {
        if (!task.deletedAt && task.parentTaskId && ids.has(task.parentTaskId) && !ids.has(task.id)) {
          ids.add(task.id)
          changed = true
        }
      })
    }
    return ids.size - 1
  }, [tasks])

  // 展开/收起任务拆解
  const loadTaskNode = async (taskId: string) => {
    const stepRepo = new DexieExecutionStepRepository()
    const maRepo = new DexieMinimumActionRepository()
    const [steps, legacyMinAction, children, serverMinAction] = await Promise.all([
      stepRepo.getByTaskId(taskId),
      maRepo.getByTaskId(taskId),
      apiGetChildTasks(taskId),
      apiGetMinimumAction(taskId),
    ])
    setChildTasks(previous => ({ ...previous, [taskId]: children }))
    setLegacyStepsByTask(previous => ({ ...previous, [taskId]: steps }))
    setMinimumActions(previous => ({ ...previous, [taskId]: serverMinAction || legacyMinAction || null }))
  }

  const toggleExpand = async (taskId: string) => {
    if (expandedTaskIds.includes(taskId)) {
      setExpandedTaskIds(previous => previous.filter(id => id !== taskId))
      return
    }
    setExpandedTaskIds(previous => [...previous, taskId])
    await loadTaskNode(taskId)
  }

  const refreshAiStatus = useCallback(async () => {
    try {
      const status = await getAiStatus()
      setAiAvailable(status.available)
    } catch {
      setAiAvailable(false) // 后端不可用 → fail-closed
    }
  }, [])

  useEffect(() => { void refreshAiStatus() }, [refreshAiStatus])

  const ensureAiAvailable = async (): Promise<boolean> => {
    try {
      const status = await getAiStatus()
      setAiAvailable(status.available)
      return status.available
    } catch {
      setAiAvailable(false)
      return false
    }
  }

  const startDecomposition = async (taskId: string) => {
    // 以点击时的后端状态为准，避免页面挂载时的旧状态误判。
    if (!(await ensureAiAvailable())) {
      setConfigPromptOpen(true)
      return
    }
    setDecompState(previous => ({ ...previous, [taskId]: 'generating' }))
    try {
      // 传入用户当前真实精力（不再固定 medium）
      await apiDecomposeTask(taskId, getCurrentEnergy())
      await Promise.all([loadTaskNode(taskId), loadAll()])
      setDecompState(previous => ({ ...previous, [taskId]: 'completed' }))
      setExpandedTaskIds(previous => previous.includes(taskId) ? previous : [...previous, taskId])
    } catch (error) {
      console.error('Decompose failed:', error)
      setDecompState(previous => ({ ...previous, [taskId]: 'failed' }))
      const detail = error instanceof Error ? error.message : '未知错误'
      showToast(`AI 拆解失败：${detail}；大任务已保留。`)
    }
  }

  const regenerateMinimumAction = async (taskId: string) => {
    // 以点击时的后端状态为准，避免页面挂载时的旧状态误判。
    if (!(await ensureAiAvailable())) {
      setConfigPromptOpen(true)
      return
    }
    setDecompState(previous => ({ ...previous, [taskId]: 'generating' }))
    try {
      // 只重新生成最小行动（不重新拆解），传入当前真实精力
      await apiRegenerateMinimumAction(taskId, getCurrentEnergy())
      await loadTaskNode(taskId)
      setDecompState(previous => ({ ...previous, [taskId]: 'completed' }))
    } catch (error) {
      console.error('Regenerate minimum action failed:', error)
      setDecompState(previous => ({ ...previous, [taskId]: 'failed' }))
      showToast('最小行动生成失败，请稍后重试。')
    }
  }

  const handleMinActionSave = async () => {
    if (!editingMA) return
    const desc = editingMA.value.trim()
    try {
      await apiUpdateMinAction(editingMA.taskId, desc)
      const saved = await apiGetMinimumAction(editingMA.taskId)
      setMinimumActions(previous => ({ ...previous, [editingMA.taskId]: saved }))
      setEditingMA(null)
    } catch (e) { console.error('Failed to save min action:', e) }
  }

  const moveTask = async (task: Task, direction: 'up' | 'down') => {
    if (!task.parentTaskId) return
    await apiMoveTask(task.id, direction)
    await Promise.all([loadTaskNode(task.parentTaskId), loadAll()])
  }

  const requestDelete = (task: Task) => {
    setPendingDelete({ task, descendantCount: getDescendantCount(task.id) })
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await apiSoftDeleteTask(pendingDelete.task.id)
      setExpandedTaskIds(previous => previous.filter(id => id !== pendingDelete.task.id))
      setPendingDelete(null)
      await Promise.all([loadAll(), loadDayDetails(selectedDate)])
      showToast('任务已移入回收站，可在 7 天内恢复')
    } catch (error) {
      console.error('Failed to recycle task:', error)
      showToast('任务删除失败，请重试')
    }
  }

  const openRecycleBin = async () => {
    try {
      setRecycledTasks(await apiGetRecycledTasks())
      setShowRecycleBin(true)
    } catch (error) {
      console.error('Failed to load recycle bin:', error)
      showToast('回收站加载失败，请重试')
    }
  }

  const restoreFromRecycleBin = async (taskId: string) => {
    try {
      await apiRestoreTask(taskId)
      setRecycledTasks(await apiGetRecycledTasks())
      await Promise.all([loadAll(), loadDayDetails(selectedDate)])
      showToast('任务已恢复')
    } catch (error) {
      console.error('Failed to restore task:', error)
      showToast('任务恢复失败，请重试')
    }
  }

  // 切换步骤完成状态
  const toggleStep = async (step: ExecutionStep) => {
    const repo = new DexieExecutionStepRepository()
    const newStatus = step.status === 'done' ? 'pending' : 'done'
    await repo.update(step.id, { status: newStatus, completedAt: newStatus === 'done' ? now() : null })
    // 刷新展开数据
    const stepRepo = new DexieExecutionStepRepository()
    const steps = await stepRepo.getByTaskId(step.taskId)
    setLegacyStepsByTask(previous => ({ ...previous, [step.taskId]: steps }))
  }

  const loadAll = useCallback(async () => {
    try {
      setLoadError(null)
      const allTasks = await taskRepo.getAll()
      const [allTags, allCompletionRecords] = await Promise.all([
        tagRepo.getAll().catch(error => {
          console.warn('标签数据暂时不可用:', error)
          return []
        }),
        completionRepo.getAll().catch(error => {
          console.warn('完成记录暂时不可用:', error)
          return []
        }),
      ])
      setTasks(allTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setTags(allTags)
      setAllCompletions(allCompletionRecords)
    } catch (error) {
      console.error('加载任务失败:', error)
      setLoadError(taskCopy.loadFailed)
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

    const dateTasks = await taskRepo.getByPlannedDate(date)
    const [state, review, timeRecs, pomos, comps] = await Promise.all([
      stateRepo.getByDate(date).catch(() => undefined),
      reviewRepo.getByDate(date).catch(() => undefined),
      timeRepo.getByDate(date).catch(() => []),
      pomoRepo.getByDate(date).catch(() => []),
      compRepo.getByDate(date).catch(() => []),
    ])

    setDayTasks(dateTasks)
    setDayState(state || null)
    setDayReview(review || null)
    setDayTimeRecords(timeRecs)
    setDayPomodoros(pomos)
    setDayCompletions(comps)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadDayDetails(selectedDate) }, [selectedDate, loadDayDetails])

  // 拖拽相关
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null)
    setDragTargetDate(null)
    const { active, over } = event
    if (!over) return

    const taskId = active.id as string
    const overId = over.id as string

    if (!overId.startsWith('date-')) return
    const targetDate = overId.replace('date-', '')

    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    if (task.plannedDate === targetDate) return

    // 保存原日期用于撤销
    setUndoInfo({ taskId, oldDate: task.plannedDate })

    // 精力过载检查
    const taskCost = getEnergyCost({ energyDemand: task.energyDemand })
    const planned = calcPlannedEnergy(tasks.filter(t => t.id !== taskId), targetDate)
    if (planned + taskCost > 100) {
      showToast(`⚠️ "${targetDate}" 已计划 ${planned} 点精力，此任务 ${taskCost} 点可能过载`)
    }

    await taskRepo.update(taskId, { plannedDate: targetDate })
    showToast(`已将"${task.title}"安排到${formatLongDate(targetDate)}`)
    await loadAll()
    await loadDayDetails(targetDate)
  }

  const handleDragCancel = () => {
    setActiveTaskId(null)
    setDragTargetDate(null)
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleUndo = async () => {
    if (!undoInfo) return
    await taskRepo.update(undoInfo.taskId, { plannedDate: undoInfo.oldDate })
    setUndoInfo(null)
    showToast('已撤销排期')
    loadAll()
    loadDayDetails(selectedDate)
  }

  // 任务操作
  const handleToggleStatus = async (task: Task, completionDate = today()) => {
    const records = await completionRepo.getByTaskId(task.id)
    if (task.isHabit) {
      // 固定任务：按完成日期检查是否已有记录
      const existing = records.find(record => record.completedDate === completionDate && record.status === 'completed')
      if (existing) {
        // 取消完成
        await completionRepo.delete(existing.id)
        showToast(`已取消“${task.title}”，行动币 -${existing.rewardPoints ?? 1}`)
      } else {
        // 完成
        await completionRepo.create({
          id: generateId(),
          taskId: task.id,
          completedDate: completionDate,
          completedAt: now(),
          status: 'completed' as const,
          energyCostSnapshot: getEnergyCost({ energyDemand: task.energyDemand }),
          rewardPoints: 1,
          taskTitleSnapshot: task.title,
          projectIdSnapshot: task.projectId,
          createdAt: now(),
        })
        showToast(`完成习惯“${task.title}”，行动币 +1`)
      }
    } else {
      const newStatus = task.status === 'done' ? 'todo' : 'done'
      if (newStatus === 'done') {
        // 完成普通任务：创建 CompletionRecord 并扣除精力
        await completionRepo.create({
          id: generateId(),
          taskId: task.id,
          completedDate: completionDate,
          completedAt: now(),
          status: 'completed' as const,
          energyCostSnapshot: getEnergyCost({ energyDemand: task.energyDemand }),
          rewardPoints: 1,
          taskTitleSnapshot: task.title,
          projectIdSnapshot: task.projectId,
          createdAt: now(),
        })
        showToast(`完成任务“${task.title}”，行动币 +1`)
      } else {
        // 取消完成：删除 CompletionRecord 返还精力
        const existing = records.find(record => record.completedDate === completionDate && record.status === 'completed')
        if (existing) {
          await completionRepo.delete(existing.id)
          showToast(`已取消“${task.title}”，行动币 -${existing.rewardPoints ?? 1}`)
        }
      }
      await taskRepo.update(task.id, {
        status: newStatus,
        completedAt: newStatus === 'done' ? now() : null,
      })
    }
    await Promise.all([loadAll(), loadDayDetails(selectedDate)])
  }

  const handleToggleTreeTaskStatus = async (task: Task) => {
    await handleToggleStatus(task)
    if (task.parentTaskId) await loadTaskNode(task.parentTaskId)
  }

  const handleCancelSchedule = async (task: Task) => {
    await taskRepo.update(task.id, { plannedDate: null })
    showToast('已取消当天排期')
    loadAll()
    loadDayDetails(selectedDate)
  }

  // 左侧任务过滤
  const leftTasks = useMemo(() => {
    const todayStr = today()
    let result = tasks
    if (view === 'unscheduled') {
      // 待安排：没有plannedDate的普通根任务（不含子任务、固定任务和已完成）
      result = result.filter(t =>
        !t.deletedAt && !t.isHabit && !t.plannedDate && !t.parentTaskId &&
        t.status !== 'done' && t.status !== 'cancelled'
      )
    } else if (view === 'today') {
      result = result.filter(t =>
        !t.deletedAt && !t.parentTaskId &&
        t.status !== 'done' &&
        t.status !== 'cancelled' &&
        (t.plannedDate === todayStr || t.dueDate === todayStr || t.isHabit)
      )
    } else if (view === 'habits') {
      result = result.filter(t => t.isHabit && !t.deletedAt && !t.parentTaskId)
    } else {
      // 按月查看：逾期未完成 + 当月普通任务 + 固定任务 + 当月已完成
      const monthSet = new Set<string>()
      const priorityOrder: Record<string, number> = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 }

      // 逾期未完成（仅在当前月份显示）
      // 当月普通未完成任务
      const monthIncomplete = result.filter(t =>
        !t.deletedAt && !t.isHabit && !t.parentTaskId && t.status !== 'done' && t.status !== 'cancelled'
        && inMonthRange(t)
      ).sort((a, b) => {
        const pa = priorityOrder[a.aiPriorityLevel as string] ?? 4
        const pb = priorityOrder[b.aiPriorityLevel as string] ?? 4
        if (pa !== pb) return pa - pb
        const da = a.dueDate || '9999'; const db = b.dueDate || '9999'
        if (da !== db) return da.localeCompare(db)
        return 0
      })
      monthIncomplete.forEach(t => monthSet.add(t.id))

      // 固定任务
      const habits = result.filter(t => t.isHabit && !t.deletedAt && !monthSet.has(t.id))
      habits.forEach(t => monthSet.add(t.id))

      // 当月已完成
      const monthDone = result.filter(t =>
        !t.deletedAt && !t.parentTaskId && t.status === 'done' && inMonthRange(t) && !monthSet.has(t.id)
      )
      monthDone.forEach(t => monthSet.add(t.id))

      result = [...monthIncomplete, ...habits, ...monthDone]
      if (search) result = result.filter(t => t.title.toLowerCase().includes(search.toLowerCase()))
      return result
    }
    if (search) {
      result = result.filter(t => t.title.toLowerCase().includes(search.toLowerCase()))
    }
    return result
  }, [tasks, view, search, viewMonth])

  const largeTasks = useMemo(() => leftTasks.filter(isLargeTask).sort((left, right) => {
    const priority = { P0: 0, P1: 1, P2: 2, P3: 3 }
    return (priority[left.aiPriorityLevel as keyof typeof priority] ?? 4) - (priority[right.aiPriorityLevel as keyof typeof priority] ?? 4)
  }), [leftTasks, isLargeTask])
  const smallAndHabitTasks = useMemo(() => leftTasks.filter(task => !isLargeTask(task)), [leftTasks, isLargeTask])

  const completedHabitIdsToday = useMemo(() => new Set(
    allCompletions
      .filter(record => record.status === 'completed' && record.completedDate === today())
      .map(record => record.taskId),
  ), [allCompletions])
  const completedHabitIdsSelected = useMemo(() => new Set(
    dayCompletions
      .filter(record => record.status === 'completed')
      .map(record => record.taskId),
  ), [dayCompletions])
  const isTaskCompletedToday = useCallback(
    (task: Task) => task.status === 'done' || (task.isHabit && completedHabitIdsToday.has(task.id)),
    [completedHabitIdsToday],
  )
  const isTaskCompletedSelected = useCallback(
    (task: Task) => task.status === 'done' || (task.isHabit && completedHabitIdsSelected.has(task.id)),
    [completedHabitIdsSelected],
  )

  // 当天任务分组
  const dayTasksByStatus = useMemo(() => {
    const doing = dayTasks.filter(t => !isTaskCompletedSelected(t) && t.status === 'doing')
    const todo = dayTasks.filter(t => !isTaskCompletedSelected(t) && (t.status === 'todo' || t.status === 'inbox'))
    const done = dayTasks.filter(isTaskCompletedSelected)
    return { doing, todo, done }
  }, [dayTasks, isTaskCompletedSelected])

  // 摘要
  const summary = useMemo(() => {
    const total = dayTasks.length
    const done = dayTasksByStatus.done.length
    const undone = total - done
    const plannedMin = dayTasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0)
    const actualMin = dayTimeRecords.reduce((s, r) => s + (r.durationMinutes || 0), 0)
    return { total, done, undone, plannedMin, actualMin }
  }, [dayTasks, dayTasksByStatus, dayTimeRecords])
  const totalActionCoins = useMemo(() => getActionCoins(allCompletions), [allCompletions])
  const todayActionCoins = useMemo(
    () => getActionCoins(allCompletions.filter(record => record.completedDate === today())),
    [allCompletions],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-64 text-center">
        <p role="alert" className="text-sm text-red-600">{loadError}</p>
        <button onClick={() => { setLoading(true); loadAll() }} className="btn-secondary">
          {taskCopy.retry}
        </button>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={e => {
        setActiveTaskId(e.active.id as string)
        setDragTargetDate(null)
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="max-w-full mx-auto flex flex-col gap-3 md:h-[calc(100vh-3rem)]">
        {/* 顶部标题 + 移动端切换 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare size={24} className="text-blue-500" />
            <h1 className="text-xl font-bold text-slate-800">任务管理</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700" title="完成任务获得行动币">
              <Zap size={12} /> 行动币 {totalActionCoins} <span className="text-amber-500">(今日 +{todayActionCoins})</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 移动端 Tab 切换 */}
            <div className="flex md:hidden bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setMobileTab('tasks')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium', mobileTab === 'tasks' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}
              >任务</button>
              <button
                onClick={() => setMobileTab('calendar')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium', mobileTab === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}
              >日历</button>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
              <Plus size={16} /> 新建任务
            </button>
          </div>
        </div>

        {/* 撤销提示 + Toast */}
        {undoInfo && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700 flex items-center justify-between">
            <span>已成功安排</span>
            <button onClick={handleUndo} className="text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1">
              <RotateCcw size={12} /> 撤销
            </button>
          </div>
        )}
        {toast && (
          <div role="status" aria-live="polite" className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 animate-[fadeIn_180ms_ease-out]">
            {toast}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:flex-1 md:min-h-0">
          {/* 左侧：任务管理区 */}
          <div className={cn(
            'md:col-span-7 md:flex md:flex-col md:min-h-0',
            mobileTab === 'calendar' && 'hidden md:block'
          )}>
            <div className="card flex flex-col flex-1 min-h-0">
              {/* 工具栏 */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                  {[
                    { k: 'all' as TaskView, l: '全部', i: List },
                    { k: 'today' as TaskView, l: '今日', i: CalendarDays },
                    { k: 'unscheduled' as TaskView, l: '待安排', i: Inbox },
                    { k: 'habits' as TaskView, l: '固定任务', i: Activity },
                  ].map(v => (
                    <button
                      key={v.k}
                      onClick={() => setView(v.k)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                        view === v.k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                      )}
                    >
                      <v.i size={12} /> {v.l}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={openRecycleBin} className="btn-ghost text-xs px-2" aria-label="打开回收站">回收站</button>
                <div className="flex-1 relative min-w-[120px]">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-7 text-xs py-1.5"
                    placeholder="搜索任务..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => setShowTagManager(!showTagManager)}
                  className={cn('btn-ghost text-xs flex items-center gap-1', showTagManager && 'bg-blue-50 text-blue-700')}
                >
                  <TagIcon size={12} /> 标签 ({tags.length})
                </button>
              </div>

              {/* 标签管理 */}
              {showTagManager && (
                <div className="mb-3 p-2 bg-slate-50 rounded-lg">
                  <input
                    className="input text-xs py-1 mb-2"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && newTagName.trim()) {
                        await tagRepo.create({
                          id: generateId(),
                          name: newTagName.trim(),
                          color: '#3b82f6',
                          createdAt: now(),
                        })
                        setNewTagName('')
                        loadAll()
                      }
                    }}
                    placeholder="新标签名称，回车添加..."
                  />
                  <div className="flex flex-wrap gap-1">
                    {tags.map(tag => (
                      <span key={tag.id} className="badge badge-p2 text-[10px]">{tag.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 月份导航 — 仅全部视图 */}
              {view === 'all' && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs text-slate-500 truncate">全部任务</span>
                  <button type="button" aria-label="上个月任务" onClick={() => goToMonth(-1)} className="p-1 hover:bg-slate-100 rounded text-slate-500 text-xs">&lt;</button>
                  <span className="text-xs font-medium text-slate-600">
                    {viewYearVal}年{viewMonVal}月
                    {viewMonth !== currentMonthStr && (
                      <button onClick={() => setViewMonth(currentMonthStr)} className="ml-1 text-blue-500 hover:underline text-[10px]">本月</button>
                    )}
                  </span>
                  <button type="button" aria-label="下个月任务" onClick={() => goToMonth(1)} className="p-1 hover:bg-slate-100 rounded text-slate-500 text-xs">&gt;</button>
                </div>
              )}

              {/* 任务列表 */}
              {leftTasks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">
                  {search ? '没有匹配的任务' : '没有任务，把第一个任务拖到日历上吧'}
                </p>
              ) : (
                <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
                  <TaskSection title={view === 'all' ? '大任务' : '任务'} tasks={view === 'all' ? largeTasks : leftTasks}>
                      {task => <TaskRow key={task.id} task={task} isCompleted={isTaskCompletedToday(task)} onToggle={() => handleToggleStatus(task)} onDelete={() => requestDelete(task)} onEdit={() => setEditingTask(task)} onExpand={() => toggleExpand(task.id)} isExpanded={expandedTaskIds.includes(task.id)} isLarge={isLargeTask(task)} decompState={decompState[task.id]} childTasks={childTasks} minimumActions={minimumActions} legacySteps={legacyStepsByTask[task.id] || []} expandedTaskIds={expandedTaskIds} allDecompState={decompState} editingMA={editingMA} hasChildren={hasChildren} isLargeTask={isLargeTask} onToggleExpand={toggleExpand} onToggleTaskStatus={handleToggleTreeTaskStatus} onEditMinimumAction={setEditingMA} onSaveMinimumAction={handleMinActionSave} onCancelMinimumAction={() => setEditingMA(null)} onToggleStep={toggleStep} onEditTask={setEditingTask} onRequestDelete={requestDelete} onMoveTask={moveTask} onStartDecomposition={startDecomposition} onRegenerateMinimumAction={regenerateMinimumAction} />}
                  </TaskSection>
                  {view === 'all' && (
                    <TaskSection title="小任务与习惯" tasks={smallAndHabitTasks}>
                      {task => <TaskRow key={task.id} task={task} isCompleted={isTaskCompletedToday(task)} onToggle={() => handleToggleStatus(task)} onDelete={() => requestDelete(task)} onEdit={() => setEditingTask(task)} onExpand={() => toggleExpand(task.id)} isExpanded={expandedTaskIds.includes(task.id)} isLarge={false} decompState={decompState[task.id]} childTasks={childTasks} minimumActions={minimumActions} legacySteps={legacyStepsByTask[task.id] || []} expandedTaskIds={expandedTaskIds} allDecompState={decompState} editingMA={editingMA} hasChildren={hasChildren} isLargeTask={isLargeTask} onToggleExpand={toggleExpand} onToggleTaskStatus={handleToggleTreeTaskStatus} onEditMinimumAction={setEditingMA} onSaveMinimumAction={handleMinActionSave} onCancelMinimumAction={() => setEditingMA(null)} onToggleStep={toggleStep} onEditTask={setEditingTask} onRequestDelete={requestDelete} onMoveTask={moveTask} onStartDecomposition={startDecomposition} onRegenerateMinimumAction={regenerateMinimumAction} />}
                    </TaskSection>
                  )}
                </div>
              )}

            </div>
          </div>

          {/* 右侧：日历与当天安排 */}
          <div className={cn(
            'md:col-span-5 h-full flex flex-col min-h-0',
            mobileTab === 'tasks' && 'hidden md:block'
          )}>
            <div className="card flex flex-col flex-1 min-h-0">
              {/* 当前选中日期头部 */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">
                    {formatLongDate(selectedDate)}
                  </h2>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    农历 · {selectedDate}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const d = addMonths(currentMonth, -1)
                      setCurrentMonth(d)
                      const day = Math.min(new Date(currentMonth).getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
                      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      setSelectedDate(ds)
                    }}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                    title="上个月"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => {
                      const t = today()
                      setSelectedDate(t)
                      setCurrentMonth(new Date())
                    }}
                    className={cn(
                      'px-2 py-1 rounded text-xs font-medium',
                      isSameDay(selectedDate, today()) ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100'
                    )}
                  >
                    今天
                  </button>
                  <button
                    onClick={() => {
                      const d = addMonths(currentMonth, 1)
                      setCurrentMonth(d)
                      const day = Math.min(new Date(currentMonth).getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
                      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      setSelectedDate(ds)
                    }}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                    title="下个月"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* 紧凑型月历 */}
              <CompactMonth
                currentMonth={currentMonth}
                selectedDate={selectedDate}
                tasks={tasks}
                isActiveDrag={!!activeTaskId}
                onPrevMonth={() => setCurrentMonth(addMonths(currentMonth, -1))}
                onNextMonth={() => setCurrentMonth(addMonths(currentMonth, 1))}
                onSelectDate={(date) => {
                  setSelectedDate(date)
                  setCurrentMonth(new Date(date))
                }}
              />

              {/* 当天任务摘要 */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-600 mb-2">当天摘要</h3>
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div className="bg-blue-50 rounded p-1.5">
                    <p className="text-slate-500">任务</p>
                    <p className="font-bold text-blue-600 text-sm">{summary.total}</p>
                  </div>
                  <div className="bg-green-50 rounded p-1.5">
                    <p className="text-slate-500">已完成</p>
                    <p className="font-bold text-green-600 text-sm">{summary.done}</p>
                  </div>
                  <div className="bg-orange-50 rounded p-1.5">
                    <p className="text-slate-500">未完成</p>
                    <p className="font-bold text-orange-600 text-sm">{summary.undone}</p>
                  </div>
                  <div className="bg-slate-50 rounded p-1.5">
                    <p className="text-slate-500">预计</p>
                    <p className="font-bold text-slate-600 text-sm">
                      {summary.plannedMin > 0 ? `${Math.round(summary.plannedMin / 60 * 10) / 10}h` : '0'}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded p-1.5">
                    <p className="text-slate-500">实际专注</p>
                    <p className="font-bold text-slate-600 text-sm">
                      {summary.actualMin > 0 ? `${Math.round(summary.actualMin / 60 * 10) / 10}h` : '暂无'}
                    </p>
                  </div>
                  <div className="bg-purple-50 rounded p-1.5">
                    <p className="text-slate-500">番茄</p>
                    <p className="font-bold text-purple-600 text-sm">{dayPomodoros.length}</p>
                  </div>
                </div>
              </div>

              {/* 当天任务列表 */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex-1 min-h-0 overflow-y-auto">
                <h3 className="text-xs font-semibold text-slate-600 mb-2">当天任务</h3>
                {dayTasks.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-400">
                    <p className="mb-2">这一天还没有安排任务</p>
                    <p>可以从左侧拖动任务到这个日期</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* 进行中 */}
                    {dayTasksByStatus.doing.length > 0 && (
                      <GroupSection title="进行中" color="bg-blue-500">
                        {dayTasksByStatus.doing.map(t => (
                          <DayTaskRow
                            key={t.id} task={t} isCompleted={isTaskCompletedSelected(t)}
                            onToggle={() => handleToggleStatus(t, selectedDate)}
                            onDelete={() => requestDelete(t)}
                            onUnschedule={() => handleCancelSchedule(t)}
                            onClick={() => setEditingTask(t)}
                          />
                        ))}
                      </GroupSection>
                    )}
                    {/* 待完成 */}
                    {dayTasksByStatus.todo.length > 0 && (
                      <GroupSection title="待完成" color="bg-orange-500">
                        {dayTasksByStatus.todo.map(t => (
                          <DayTaskRow
                            key={t.id} task={t} isCompleted={isTaskCompletedSelected(t)}
                            onToggle={() => handleToggleStatus(t, selectedDate)}
                            onDelete={() => requestDelete(t)}
                            onUnschedule={() => handleCancelSchedule(t)}
                            onClick={() => setEditingTask(t)}
                          />
                        ))}
                      </GroupSection>
                    )}
                    {/* 已完成 */}
                    {dayTasksByStatus.done.length > 0 && (
                      <div>
                        <button
                          onClick={() => setShowDone(!showDone)}
                          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-1"
                        >
                          {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          已完成 ({dayTasksByStatus.done.length})
                        </button>
                        {showDone && (
                          <GroupSection title="" color="bg-green-500">
                            {dayTasksByStatus.done.map(t => (
                              <DayTaskRow
                                key={t.id} task={t} isCompleted={isTaskCompletedSelected(t)}
                                onToggle={() => handleToggleStatus(t, selectedDate)}
                                onDelete={() => requestDelete(t)}
                                onUnschedule={() => handleCancelSchedule(t)}
                                onClick={() => setEditingTask(t)}
                              />
                            ))}
                          </GroupSection>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 当天状态 */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setShowStatePanel(!showStatePanel)}
                  className="w-full text-left flex items-center justify-between"
                >
                  <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Zap size={12} className="text-amber-500" /> 当天状态
                  </h3>
                  {showStatePanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showStatePanel && (
                  <div className="mt-2 p-2 bg-slate-50 rounded-lg space-y-2">
                    {dayState ? (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-slate-500">精力</p>
                          <p className="font-bold text-sm text-slate-700">{dayState.energyScore}/10</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">情绪</p>
                          <p className="font-bold text-sm text-slate-700">{dayState.moodScore}/10</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">压力</p>
                          <p className="font-bold text-sm text-slate-700">{dayState.stressScore}/10</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-1">
                        还没有记录当天状态
                      </p>
                    )}
                    <a href="/reviews" className="block text-center text-xs text-blue-500 hover:text-blue-700">
                      {dayState ? '去更新 →' : '去记录 →'}
                    </a>
                  </div>
                )}
              </div>

              {/* 番茄钟 & 时间记录 */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Timer size={12} className="text-blue-500" /> 番茄钟与时间
                  </h3>
                  <a href="/timer" className="text-[10px] text-blue-500 hover:text-blue-700">
                    开始 →
                  </a>
                </div>
                {dayPomodoros.length > 0 || dayTimeRecords.length > 0 ? (
                  <div className="text-[10px] text-slate-600 space-y-0.5">
                    <p>完成番茄: <span className="font-bold text-purple-600">{dayPomodoros.length}</span> 个</p>
                    <p>总专注: <span className="font-bold text-blue-600">{summary.actualMin} 分钟</span></p>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">这一天还没有番茄钟记录</p>
                )}
              </div>

              {/* 复盘入口 */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <BookOpen size={12} className="text-green-500" /> 当天复盘
                  </h3>
                  <a href="/reviews" className="text-[10px] text-blue-500 hover:text-blue-700">
                    {dayReview ? '查看 →' : '去记录 →'}
                  </a>
                </div>
                {dayReview ? (
                  <p className="text-[10px] text-slate-500 bg-slate-50 rounded p-1.5 line-clamp-2">
                    {dayReview.biggestGain || dayReview.completed || '已复盘'}
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">这一天还没有复盘</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeTaskId ? (() => {
          const t = tasks.find(tt => tt.id === activeTaskId)
          if (!t) return null
          return (
            <div className="p-2 rounded-lg border border-blue-400 bg-white shadow-xl opacity-90 text-xs flex items-center gap-2 max-w-xs">
              <CheckSquare size={12} className="text-blue-500" />
              <span className="truncate">{t.title}</span>
            </div>
          )
        })() : null}
      </DragOverlay>

      {/* 弹窗 */}
      {showCreate && (
        <CreateTaskModal
          defaultDate={null}
          onClose={() => setShowCreate(false)}
          onCreated={async (newTask: Task, taskKind: 'large' | 'small') => {
            setShowCreate(false)
            await loadAll()
            if (taskKind === 'large') await startDecomposition(newTask.id)
          }}
        />
      )}

      {pendingDelete && (
        <DeleteTaskModal
          task={pendingDelete.task}
          descendantCount={pendingDelete.descendantCount}
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      {showRecycleBin && (
        <RecycleBinModal
          tasks={recycledTasks}
          onClose={() => setShowRecycleBin(false)}
          onRestore={restoreFromRecycleBin}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={() => {
            const taskId = editingTask.parentTaskId || editingTask.id
            setEditingTask(null)
            void Promise.all([loadAll(), loadDayDetails(selectedDate), loadTaskNode(taskId)])
          }}
          onUpdated={() => {
            const taskId = editingTask.parentTaskId || editingTask.id
            setEditingTask(null)
            void Promise.all([loadAll(), loadDayDetails(selectedDate), loadTaskNode(taskId)])
          }}
        />
      )}

      {/* AI 未配置提示（统一复用 AiModelConfigForm） */}
      {configPromptOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setConfigPromptOpen(false)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800">请先配置模型 API</h3>
            <p className="mt-1 text-sm text-slate-500 mb-4">使用 AI 拆解前，需要先配置模型服务。API Key 只保存在本机系统安全凭据库。</p>
            <AiModelConfigForm onChanged={refreshAiStatus} compact />
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setConfigPromptOpen(false)} className="btn-secondary">关闭</button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  )
}

// ============= 子组件 =============

function DeleteTaskModal({
  task, descendantCount, onClose, onConfirm,
}: {
  task: Task
  descendantCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const affectedCount = descendantCount + 1
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-task-title">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <h2 id="delete-task-title" className="font-semibold text-lg text-slate-800">移入回收站？</h2>
        <p className="mt-2 text-sm text-slate-600">“{task.title}”及其 {descendantCount} 个下级任务、关联最小行动将一并移入回收站。</p>
        <p className="mt-2 text-xs text-slate-400">共 {affectedCount} 个任务，保留 7 天后自动清理。</p>
        <div className="flex gap-3 justify-end mt-5">
          <button type="button" onClick={onClose} className="btn-secondary">取消</button>
          <button type="button" onClick={onConfirm} className="px-3 py-2 rounded-md bg-red-500 text-white text-sm hover:bg-red-600">确认删除</button>
        </div>
      </div>
    </div>
  )
}

function RecycleBinModal({
  tasks, onClose, onRestore,
}: {
  tasks: RecycledTask[]
  onClose: () => void
  onRestore: (taskId: string) => void
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="recycle-bin-title">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 id="recycle-bin-title" className="font-semibold text-lg text-slate-800">回收站</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭回收站"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-400 mb-4">任务会保留 7 天，恢复后会连同同批下级任务和最小行动一起回来。</p>
        {tasks.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">回收站为空</p> : (
          <div className="space-y-2">
            {tasks.map(task => (
              <div key={task.id} className="border border-slate-100 rounded-lg p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 truncate">{task.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{task.descendantCount} 个下级任务 · 删除于 {task.deletedAt?.slice(0, 10)}</p>
                </div>
                <button type="button" onClick={() => onRestore(task.id)} className="text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap">恢复</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface TaskRowProps {
  task: Task
  isCompleted: boolean
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
  onExpand: () => void
  isExpanded: boolean
  isLarge: boolean
  decompState?: 'generating' | 'completed' | 'failed'
  childTasks: Record<string, Task[]>
  minimumActions: Record<string, MinimumAction | null>
  legacySteps: ExecutionStep[]
  expandedTaskIds: string[]
  allDecompState: Record<string, 'generating' | 'completed' | 'failed'>
  editingMA: { taskId: string; value: string } | null
  hasChildren: (taskId: string) => boolean
  isLargeTask: (task: Task) => boolean
  onToggleExpand: (taskId: string) => void
  onToggleTaskStatus: (task: Task) => void
  onEditMinimumAction: (editing: { taskId: string; value: string } | null) => void
  onSaveMinimumAction: () => void
  onCancelMinimumAction: () => void
  onToggleStep: (step: ExecutionStep) => void
  onEditTask: (task: Task) => void
  onRequestDelete: (task: Task) => void
  onMoveTask: (task: Task, direction: 'up' | 'down') => void
  onStartDecomposition: (taskId: string) => void
  onRegenerateMinimumAction: (taskId: string) => void
}

function TaskSection({ title, tasks, children }: { title: string; tasks: Task[]; children: (task: Task) => React.ReactNode }) {
  return <section aria-label={title} className="space-y-1">
    <div className="flex items-center gap-2 px-1 pt-1"><h3 className="text-xs font-semibold text-slate-600">{title}</h3><span className="text-[10px] text-slate-400">{tasks.length}</span></div>
    {tasks.length > 0 ? tasks.map(children) : <p className="px-1 py-2 text-[10px] text-slate-400">暂时没有{title}</p>}
  </section>
}

function TaskRow(props: TaskRowProps) {
  const { task, isCompleted, onToggle, onDelete, onEdit, onExpand, isExpanded, isLarge, decompState, childTasks, minimumActions, legacySteps, expandedTaskIds, allDecompState, editingMA, hasChildren, isLargeTask, onToggleExpand, onToggleTaskStatus, onEditMinimumAction, onSaveMinimumAction, onCancelMinimumAction, onToggleStep, onEditTask, onRequestDelete, onMoveTask, onStartDecomposition, onRegenerateMinimumAction } = props
  return <div>
    <DraggableTask task={task} isCompleted={isCompleted} onToggle={onToggle} onDelete={onDelete} onClick={onEdit} onExpand={onExpand} isExpanded={isExpanded} isLarge={isLarge} decompState={decompState} />
    {isExpanded && <TaskTreeDetails task={task} childTasks={childTasks} minimumActions={minimumActions} legacySteps={legacySteps} expandedTaskIds={expandedTaskIds} decompState={allDecompState} editingMA={editingMA} hasChildren={hasChildren} isLargeTask={isLargeTask} onToggleExpand={onToggleExpand} onToggleTaskStatus={onToggleTaskStatus} onEditMinimumAction={onEditMinimumAction} onSaveMinimumAction={onSaveMinimumAction} onCancelMinimumAction={onCancelMinimumAction} onToggleStep={onToggleStep} onEditTask={onEditTask} onRequestDelete={onRequestDelete} onMoveTask={onMoveTask} onStartDecomposition={onStartDecomposition} onRegenerateMinimumAction={onRegenerateMinimumAction} />}
  </div>
}

function DraggableTask({
  task, isCompleted, onToggle, onDelete, onClick, onExpand, isExpanded, isLarge, decompState,
}: {
  task: Task
  isCompleted: boolean
  onToggle: () => void
  onDelete: () => void
  onClick: () => void
  onExpand: () => void
  isExpanded: boolean
  isLarge: boolean
  decompState?: 'generating' | 'completed' | 'failed'
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const todayStr = today()

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDragging) return
    onExpand()
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 group touch-none',
        isDragging && 'opacity-30',
        isCompleted && 'opacity-60'
      )}
    >
      <button
        onClick={e => { e.stopPropagation(); e.preventDefault(); onToggle() }}
        type="button"
        className={cn(
          'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0',
          isCompleted ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'
        )}
      >
        {isCompleted && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      <div
        {...listeners}
        className="flex-1 min-w-0 cursor-grab active:cursor-grabbing"
        onClick={handleClick}
      >
        <p className={cn(
          'text-xs',
          isCompleted ? 'line-through text-slate-400' : 'text-slate-700'
        )}>
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <TaskKindBadge isLarge={isLarge} decompState={decompState} />
          {task.isHabit && <span className="badge badge-success text-[9px]">习惯</span>}
          {task.estimatedMinutes > 0 && (
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
              <Clock size={8} />{task.estimatedMinutes}分
            </span>
          )}
          {task.dueDate && !isCompleted && (
            <span className={cn(
              'text-[10px]',
              task.dueDate < todayStr ? 'text-red-500 font-medium' : 'text-slate-400'
            )}>
              {task.dueDate < todayStr ? '逾期' : ''} {task.dueDate}
            </span>
          )}
          {task.plannedDate && (
            <span className="text-[10px] text-blue-500">
              📅 {task.plannedDate}
            </span>
          )}
          {task.aiPriorityLevel && (
            <span className={cn(
              'badge text-[9px]',
              task.aiPriorityLevel === 'P0' ? 'badge-p0' :
              task.aiPriorityLevel === 'P1' ? 'badge-p1' : 'badge-p2'
            )}>
              {task.aiPriorityLevel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onExpand() }}
          type="button" data-no-drag="true"
          className={cn('p-1 rounded text-slate-300 hover:text-slate-500 transition-transform duration-150',
            isExpanded && 'rotate-90')}
          title={isExpanded ? '收起' : '展开'}>
          <ChevronRight size={11} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onClick() }}
          type="button"
          aria-label={`编辑 ${task.title}`}
          data-no-drag="true"
          className="p-1 rounded hover:bg-blue-50 text-slate-300 hover:text-blue-500"
        >
          <Edit2 size={11} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          type="button"
          aria-label={`删除 ${task.title}`}
          data-no-drag="true"
          className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function TaskKindBadge({
  isLarge,
  decompState,
}: {
  isLarge: boolean
  decompState?: 'generating' | 'completed' | 'failed'
}) {
  if (decompState === 'generating') {
    return <span className="text-[9px] text-blue-500 flex items-center gap-0.5"><Loader2 size={8} className="animate-spin" /> AI 判断中</span>
  }
  return isLarge
    ? <span className="text-[9px] text-violet-600">大任务</span>
    : <span className="text-[9px] text-emerald-600">小任务 · 可直接执行</span>
}

interface TaskTreeDetailsProps {
  task: Task
  childTasks: Record<string, Task[]>
  minimumActions: Record<string, MinimumAction | null>
  legacySteps: ExecutionStep[]
  expandedTaskIds: string[]
  decompState: Record<string, 'generating' | 'completed' | 'failed'>
  editingMA: { taskId: string; value: string } | null
  hasChildren: (taskId: string) => boolean
  isLargeTask: (task: Task) => boolean
  onToggleExpand: (taskId: string) => void
  onToggleTaskStatus: (task: Task) => void
  onEditMinimumAction: (editing: { taskId: string; value: string } | null) => void
  onSaveMinimumAction: () => void
  onCancelMinimumAction: () => void
  onToggleStep: (step: ExecutionStep) => void
  onEditTask: (task: Task) => void
  onRequestDelete: (task: Task) => void
  onMoveTask: (task: Task, direction: 'up' | 'down') => void
  onStartDecomposition: (taskId: string) => void
  onRegenerateMinimumAction: (taskId: string) => void
}

function TaskTreeDetails({
  task, childTasks, minimumActions, legacySteps, expandedTaskIds, decompState, editingMA,
  hasChildren, isLargeTask, onToggleExpand, onToggleTaskStatus, onEditMinimumAction,
  onSaveMinimumAction, onCancelMinimumAction, onToggleStep, onEditTask, onRequestDelete, onMoveTask,
  onStartDecomposition, onRegenerateMinimumAction,
}: TaskTreeDetailsProps) {
  const children = childTasks[task.id] || []
  const minAction = minimumActions[task.id]
  const taskState = decompState[task.id]
  const isLarge = isLargeTask(task)

  const showDecomposeButton = isLarge && !hasChildren(task.id) && taskState !== 'generating'
  const showRegenerateButton = hasChildren(task.id) && taskState !== 'generating'

  return (
    <div className="mt-1 ml-6 p-2.5 bg-gradient-to-br from-blue-50/60 to-white rounded-lg border border-blue-100/50 space-y-2 text-xs">
      {taskState === 'generating' && (
        <p className="text-slate-400 italic flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> AI 正在拆解…</p>
      )}
      {taskState === 'failed' && (
        <div className="text-red-500 space-y-1">
          <p className="text-[10px]">AI 拆解失败，任务已保留，可手动添加小任务。</p>
        </div>
      )}

      {/* AI 拆解入口（大任务无拆解结果时） */}
      {showDecomposeButton && (
        <button
          type="button"
          onClick={() => onStartDecomposition(task.id)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-violet-50 text-violet-600 hover:bg-violet-100 text-[10px] font-medium transition-colors"
        >
          <ListTree size={10} /> AI 拆解
        </button>
      )}

      {!isLarge && minAction && (
        <div>
          <p className="text-[10px] font-medium text-blue-600 mb-1 flex items-center gap-1">
            <Zap size={10} /> 最小行动
            <button type="button" onClick={() => onEditMinimumAction({ taskId: task.id, value: minAction.description })} className="ml-1 text-slate-400 hover:text-blue-600" aria-label="编辑最小行动">
              <Edit2 size={10} />
            </button>
            <button type="button" onClick={() => onRegenerateMinimumAction(task.id)} className="ml-1 text-slate-400 hover:text-violet-600" aria-label="重新生成最小行动" title="按当前精力重新生成">
              <RefreshCw size={10} />
            </button>
          </p>
          {editingMA?.taskId === task.id ? (
            <div className="flex gap-1 items-start">
              <input
                className="flex-1 text-xs border border-blue-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                value={editingMA.value}
                onChange={event => onEditMinimumAction({ ...editingMA, value: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Enter') onSaveMinimumAction()
                  if (event.key === 'Escape') onCancelMinimumAction()
                }}
                autoFocus
              />
              <button type="button" onClick={onSaveMinimumAction} className="text-[10px] px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
              <button type="button" onClick={onCancelMinimumAction} className="text-[10px] px-2 py-1 text-slate-500 rounded hover:bg-slate-100">取消</button>
            </div>
          ) : <p className="text-slate-700">{minAction.description}</p>}
        </div>
      )}

      {children.length > 0 && (
        <div className="border-t border-blue-100/50 pt-2 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-slate-500">阶段与小任务</p>
            {showRegenerateButton && (
              <button
                type="button"
                onClick={() => onRegenerateMinimumAction(task.id)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-violet-600 hover:bg-violet-50 text-[10px] font-medium transition-colors"
                title="按当前精力重新生成所有子任务的最小行动"
              >
                <RefreshCw size={10} /> 重新生成最小行动
              </button>
            )}
          </div>
          {children.map((child, index) => (
            <TaskTreeNode
              key={child.id}
              task={child}
              childTasks={childTasks}
              minimumActions={minimumActions}
              expandedTaskIds={expandedTaskIds}
              decompState={decompState}
              editingMA={editingMA}
              hasChildren={hasChildren}
              isLargeTask={isLargeTask}
              onToggleExpand={onToggleExpand}
              onToggleTaskStatus={onToggleTaskStatus}
              onEditMinimumAction={onEditMinimumAction}
              onSaveMinimumAction={onSaveMinimumAction}
              onCancelMinimumAction={onCancelMinimumAction}
              onEditTask={onEditTask}
              onRequestDelete={onRequestDelete}
              onMoveTask={onMoveTask}
              onStartDecomposition={onStartDecomposition}
              onRegenerateMinimumAction={onRegenerateMinimumAction}
              canMoveUp={index > 0}
              canMoveDown={index < children.length - 1}
            />
          ))}
        </div>
      )}

      {legacySteps.length > 0 && (
        <div className="border-t border-blue-100/50 pt-2">
          <p className="text-[10px] font-medium text-slate-500 mb-1.5">执行步骤</p>
          {legacySteps.map(step => (
            <button key={step.id} type="button" onClick={() => onToggleStep(step)} className={cn('flex items-start gap-2 w-full text-left py-0.5 rounded hover:bg-slate-50/50', step.status === 'done' && 'opacity-50')}>
              <span className={cn('w-3.5 h-3.5 rounded-full border flex-shrink-0 mt-0.5 flex items-center justify-center', step.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300')}>
                {step.status === 'done' && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span className={cn('flex-1', step.status === 'done' && 'line-through text-slate-400')}>{step.content}</span>
            </button>
          ))}
        </div>
      )}

    </div>
  )
}

function TaskTreeNode(props: Omit<TaskTreeDetailsProps, 'legacySteps' | 'onToggleStep'> & { canMoveUp: boolean; canMoveDown: boolean }) {
  const { task, expandedTaskIds, decompState, hasChildren, isLargeTask, onToggleExpand, onToggleTaskStatus, onEditTask, onRequestDelete, onMoveTask, canMoveUp, canMoveDown } = props
  const isExpanded = expandedTaskIds.includes(task.id)
  const isCompleted = task.status === 'done'

  return (
    <div>
      <div className="flex items-center gap-1 rounded hover:bg-white/70 group">
        <button type="button" onClick={() => onToggleExpand(task.id)} aria-label={`${isExpanded ? '收起' : '展开'} ${task.title}`} className="p-1 text-slate-400 hover:text-slate-600">
          <ChevronRight size={11} className={cn('text-slate-400 transition-transform', isExpanded && 'rotate-90')} />
        </button>
        <button
          type="button"
          aria-label={`${isCompleted ? '取消完成' : '完成'} ${task.title}`}
          aria-pressed={isCompleted}
          onClick={() => onToggleTaskStatus(task)}
          className={cn(
            'w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
            isCompleted ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-emerald-400',
          )}
        >
          {isCompleted && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <button type="button" onClick={() => onToggleExpand(task.id)} className="flex-1 flex items-center gap-2 py-1 text-left min-w-0">
          <span className={cn('flex-1 truncate', isCompleted ? 'line-through text-slate-400' : 'text-slate-700')}>{task.title}</span>
          <TaskKindBadge isLarge={isLargeTask(task)} decompState={decompState[task.id]} />
        </button>
        <div className="opacity-0 group-hover:opacity-100 flex items-center text-slate-400">
          <button type="button" aria-label={`上移 ${task.title}`} disabled={!canMoveUp} onClick={() => onMoveTask(task, 'up')} className="p-0.5 hover:text-blue-600 disabled:opacity-30"><ChevronUp size={11} /></button>
          <button type="button" aria-label={`下移 ${task.title}`} disabled={!canMoveDown} onClick={() => onMoveTask(task, 'down')} className="p-0.5 hover:text-blue-600 disabled:opacity-30"><ChevronDown size={11} /></button>
          <button type="button" aria-label={`编辑 ${task.title}`} onClick={() => onEditTask(task)} className="p-0.5 hover:text-blue-600"><Edit2 size={11} /></button>
          <button type="button" aria-label={`删除 ${task.title}`} onClick={() => onRequestDelete(task)} className="p-0.5 hover:text-red-500"><Trash2 size={11} /></button>
        </div>
      </div>
      {isExpanded && (
        <TaskTreeDetails {...props} legacySteps={[]} onToggleStep={() => undefined} />
      )}
    </div>
  )
}

function CompactMonth({
  currentMonth, selectedDate, tasks, isActiveDrag,
  onPrevMonth, onNextMonth, onSelectDate,
}: {
  currentMonth: Date
  selectedDate: string
  tasks: Task[]
  isActiveDrag: boolean
  onPrevMonth: () => void
  onNextMonth: () => void
  onSelectDate: (date: string) => void
}) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const days = getMonthGrid(year, month)
  const todayStr = today()

  // 统计每天任务数 + 完成数
  const taskStatsByDate = useMemo(() => {
    const counts: Record<string, { total: number; done: number }> = {}
    tasks.forEach(t => {
      if (t.plannedDate && !t.deletedAt) {
        if (!counts[t.plannedDate]) counts[t.plannedDate] = { total: 0, done: 0 }
        counts[t.plannedDate].total++
        if (t.status === 'done') counts[t.plannedDate].done++
      }
    })
    return counts
  }, [tasks])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700">{formatMonthTitle(currentMonth)}</h3>
        <div className="flex items-center gap-1">
          <button onClick={onPrevMonth} className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <ChevronLeft size={14} />
          </button>
          <button onClick={onNextMonth} className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400 mb-1">
        {['一', '二', '三', '四', '五', '六', '日'].map(d => (
          <div key={d} className="py-0.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const dateStr = d.toISOString().split('T')[0]
          const isCurrentMonth = d.getMonth() === month
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const stats = taskStatsByDate[dateStr] || { total: 0, done: 0 }
          return (
            <MonthDayCell
              key={i}
              date={d}
              dateStr={dateStr}
              isCurrentMonth={isCurrentMonth}
              isToday={isToday}
              isSelected={isSelected}
              taskCount={stats.total}
              doneCount={stats.done}
              isActive={isActiveDrag}
              onClick={() => onSelectDate(dateStr)}
            />
          )
        })}
      </div>
    </div>
  )
}

function MonthDayCell({
  date, dateStr, isCurrentMonth, isToday, isSelected, taskCount,
  doneCount, isActive, onClick,
}: {
  date: Date
  dateStr: string
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  taskCount: number
  doneCount: number
  isActive: boolean  // 是否有任务正被拖拽
  onClick: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` })

  // 拖拽进行中时不响应点击（避免拖拽松手后误触发日期选择）
  const handleClick = () => {
    if (isActive) return
    onClick()
  }

  const displayCount = taskCount > 9 ? '9+' : String(taskCount)
  const allDone = taskCount > 0 && doneCount === taskCount

  return (
    <button
      ref={setNodeRef}
      onClick={handleClick}
      type="button"
      data-date={dateStr}
      className={cn(
        'aspect-square flex flex-col items-center justify-center rounded transition-all text-[10px] relative',
        isSelected ? 'bg-blue-500 text-white font-bold' :
        isToday ? 'bg-blue-100 text-blue-700 font-semibold' :
        isCurrentMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50',
        isOver && !isSelected && 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50'
      )}
    >
      <span className="leading-none text-[11px]">{date.getDate()}</span>
      {taskCount > 0 && isCurrentMonth && (
        <span className={cn(
          'flex items-center gap-0.5 text-[10px] mt-0.5 leading-none',
          isSelected ? 'text-white' : isToday ? 'text-blue-600' : 'text-slate-500'
        )}>
          {allDone ? (
            <CheckSquare size={7} />
          ) : (
            <ListTree size={7} />
          )}
          <span className="font-medium">{displayCount}</span>
        </span>
      )}
    </button>
  )
}

function GroupSection({
  title, color, children,
}: {
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div>
      {title && (
        <div className="flex items-center gap-1.5 mb-1">
          <div className={cn('w-1.5 h-1.5 rounded-full', color)} />
          <span className="text-[10px] text-slate-500 font-medium">{title}</span>
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function DayTaskRow({
  task, isCompleted, onToggle, onDelete, onUnschedule, onClick,
}: {
  task: Task
  isCompleted: boolean
  onToggle: () => void
  onDelete: () => void
  onUnschedule: () => void
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 group',
        isCompleted && 'opacity-60'
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center',
          isCompleted ? 'bg-green-500 border-green-500' : 'border-slate-300'
        )}
      >
        {isCompleted && (
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <p className={cn(
          'text-xs truncate',
          isCompleted ? 'line-through text-slate-400' : 'text-slate-700'
        )}>
          {task.title}
        </p>
        {task.estimatedMinutes > 0 && (
          <p className="text-[10px] text-slate-400">{task.estimatedMinutes}分</p>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          onClick={onUnschedule}
          className="p-1 rounded hover:bg-amber-50 text-slate-300 hover:text-amber-500"
          title="取消当天排期"
        >
          <X size={10} />
        </button>
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"
          title="删除任务"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  )
}

// ============================================================
// 精力等级配置
// ============================================================
const ENERGY_LEVELS = [
  { level: 1, label: '提醒', points: 3, defaultMin: 5, desc: '顺手完成，几乎不需要思考' },
  { level: 2, label: '轻量', points: 5, defaultMin: 15, desc: '需要一点行动，基本没有心理负担' },
  { level: 3, label: '一般', points: 10, defaultMin: 30, desc: '需要正常投入一段注意力' },
  { level: 4, label: '专注', points: 20, defaultMin: 60, desc: '需要一段完整、不被打断的注意力' },
  { level: 5, label: '重度', points: 30, defaultMin: 120, desc: '明显消耗认知或体力，需要较高投入' },
] as const
const HABIT_ENERGY = { level: 1, label: '习惯固定', points: 3, defaultMin: 5 }

// ============================================================
// 三层日期解析：格式识别 → 日历有效性 → 时间状态
// ============================================================
type ParseResult = {
  recognized: boolean
  year: number; month: number; day: number
  calendarValid: boolean
  temporalState: 'past' | 'today' | 'future' | ''
  normalized: string       // YYYY-MM-DD
  displayText: string      // 中文展示
  errorReason: string
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate() // m is 1-based, Date uses 0-based month
}

function parseDateInput(raw: string): ParseResult {
  const s = raw.trim()
  const empty: ParseResult = { recognized: false, year: 0, month: 0, day: 0, calendarValid: false, temporalState: '', normalized: '', displayText: '', errorReason: '' }
  if (!s) return empty

  const today = new Date()
  const thisYear = today.getFullYear()
  const thisMonth = today.getMonth() + 1
  const todayStr = today.toISOString().split('T')[0]

  let y = 0, m = 0, d = 0

  // 规则 A: 中文年月日 "2027年8月20日" "2027年8月20" "8月20日" "8月20"
  const zhFull = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/)
  const zhMD = s.match(/^(\d{1,2})月(\d{1,2})日?$/)
  if (zhFull) {
    y = parseInt(zhFull[1]); m = parseInt(zhFull[2]); d = parseInt(zhFull[3])
  } else if (zhMD) {
    y = thisYear; m = parseInt(zhMD[1]); d = parseInt(zhMD[2])
  } else {
    // 规则 A: 完整年月日 "2026/8/8" "2026-8-8" "2026.8.8"
    const full = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/)
    if (full) {
      y = parseInt(full[1]); m = parseInt(full[2]); d = parseInt(full[3])
    } else {
      // 规则 B: 月+日 "8/8" "08/08" "8.8" "8-8"
      const md = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/)
      if (md) {
        y = thisYear; m = parseInt(md[1]); d = parseInt(md[2])
      } else {
        // 规则 C: 单独数字 "8" "15" "31"
        const single = s.match(/^(\d{1,2})$/)
        if (single) {
          y = thisYear; m = thisMonth; d = parseInt(single[1])
        } else {
          return { ...empty, recognized: false, errorReason: '暂时无法识别这个日期，请输入如 8、8/8 或 2026/8/8' }
        }
      }
    }
  }

  // 格式识别成功 — 现在检查日历有效性
  if (m < 1 || m > 12) {
    return { recognized: true, year: y, month: m, day: d, calendarValid: false, temporalState: '', normalized: '', displayText: `${y}年${m}月${d}日`, errorReason: `已识别为 ${y}年${m}月${d}日，但该日期不存在` }
  }
  const dim = daysInMonth(y, m)
  if (d < 1 || d > dim) {
    return { recognized: true, year: y, month: m, day: d, calendarValid: false, temporalState: '', normalized: '', displayText: `${y}年${m}月${d}日`, errorReason: `已识别为 ${y}年${m}月${d}日，但该日期不存在（${m}月只有${dim}天）` }
  }

  // 日历有效 — 判断时间状态
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  let temporal: 'past' | 'today' | 'future' = 'future'
  if (ds < todayStr) temporal = 'past'
  else if (ds === todayStr) temporal = 'today'

  const suffix = temporal === 'past' ? ' · 该日期已过去' : temporal === 'today' ? ' · 今天' : ''
  return { recognized: true, year: y, month: m, day: d, calendarValid: true, temporalState: temporal, normalized: ds, displayText: `${y}年${m}月${d}日`, errorReason: '' }
}

// ============================================================
// SmartDateInput — Enter触发识别，输入不自动格式化
// ============================================================
function SmartDateInput({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (val: string) => void
  placeholder: string
}) {
  const [raw, setRaw] = useState(value || '')
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'warn' | 'err'>('ok')

  // 外部值变化时同步（比如日历选完回写）
  useEffect(() => {
    if (value) setRaw(value)
  }, [value])

  // Enter: 解析日期
  const handleEnter = () => {
    if (!raw.trim()) return
    const result = parseDateInput(raw)
    if (result.recognized && result.calendarValid) {
      setRaw(result.normalized)
      onChange(result.normalized)
      const suffix = result.temporalState === 'past' ? ' · 该日期已过去' : result.temporalState === 'today' ? ' · 今天' : ''
      setFeedback(`已识别为 ${result.displayText}${suffix}`)
      setFeedbackType(result.temporalState === 'past' ? 'warn' : 'ok')
    } else if (result.recognized && !result.calendarValid) {
      setFeedback(result.errorReason)
      setFeedbackType('err')
    } else {
      setFeedback(result.errorReason)
      setFeedbackType('err')
    }
  }

  // 日历选择
  const handleCalendarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value
    onChange(date)
    setRaw(date)
    setFeedback(`已选择日期`)
    setFeedbackType('ok')
  }

  const calId = `cal-${label.replace(/\s/g, '')}`

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-1">
        <input
          className="input flex-1"
          value={raw}
          onChange={e => { setRaw(e.target.value); setFeedback('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEnter() } }}
          placeholder={placeholder}
        />
        <button
          onClick={() => { const el = document.getElementById(calId) as HTMLInputElement; el?.showPicker() }}
          className="p-2 hover:bg-slate-100 rounded text-slate-400" title="选择日期" type="button">
          <CalendarDays size={16} />
        </button>
        <input id={calId} type="date" className="absolute opacity-0 pointer-events-none w-0 h-0" onChange={handleCalendarSelect} />
      </div>
      {feedback && (
        <p className={cn('text-[10px] mt-0.5', feedbackType === 'err' ? 'text-red-500' : feedbackType === 'warn' ? 'text-amber-500' : 'text-blue-500')}>
          {feedback}
        </p>
      )}
    </div>
  )
}

function CreateTaskModal({
  defaultDate, onClose, onCreated,
}: {
  defaultDate: string | null
  onClose: () => void
  onCreated: (task: Task, taskKind: 'large' | 'small') => void
}) {
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [energyLevel, setEnergyLevel] = useState(3) // 默认一般
  const [estimatedMinutes, setEstimatedMinutes] = useState(30) // 默认30分钟
  const [userSetTime, setUserSetTime] = useState(false) // 用户是否手动设过时间
  const [dueDate, setDueDate] = useState('')
  const [plannedDate, setPlannedDate] = useState(defaultDate || today())
  const [isHabit, setIsHabit] = useState(false)
  const [recurrenceRule, setRecurrenceRule] = useState('')
  const [showExplain, setShowExplain] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showDecompositionChoice, setShowDecompositionChoice] = useState(false)

  const openDecompositionChoice = () => {
    if (!title.trim()) return
    const dueParsed = dueDate ? parseDateInput(dueDate) : parseDateInput('')
    const planParsed = plannedDate ? parseDateInput(plannedDate) : parseDateInput('')
    if (dueDate && (!dueParsed.recognized || !dueParsed.calendarValid)) return
    if (plannedDate && (!planParsed.recognized || !planParsed.calendarValid)) return
    setShowDecompositionChoice(true)
  }

  const handleSubmit = async (taskKind: 'large' | 'small') => {
    if (!title.trim()) return
    const dueParsed = dueDate ? parseDateInput(dueDate) : parseDateInput('')
    const planParsed = plannedDate ? parseDateInput(plannedDate) : parseDateInput('')
    const finalDue = dueParsed.normalized || null
    const finalPlanned = planParsed.normalized || plannedDate || null

    // 任务主数据只写服务端；失败时保留表单并让用户重试。
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const apiTask = await apiCreateTask({
        title: title.trim(),
        status,
        dueDate: finalDue,
        plannedDate: finalPlanned,
        estimatedMinutes,
        energyDemand: (isHabit ? 1 : energyLevel),
        isHabit,
        recurrenceRule: isHabit ? (recurrenceRule || 'FREQ=DAILY') : null,
        taskKind: isHabit ? 'small' : taskKind,
      })
      onCreated({ ...apiTask, taskKind: isHabit ? 'small' : taskKind }, isHabit ? 'small' : taskKind)
      onClose()
    } catch (e) {
      console.error('[API] Failed to create task:', (e as Error).message)
      setSubmitError(taskCopy.createFailed)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEnergyChange = (level: number, defaultMin: number) => {
    setEnergyLevel(level)
    if (!userSetTime) setEstimatedMinutes(defaultMin)
  }

  const handleMinChange = (val: number) => {
    setEstimatedMinutes(val)
    setUserSetTime(true)
  }

  const handleHabitToggle = (checked: boolean) => {
    setIsHabit(checked)
    // 勾选习惯：如果用户没设过时间，默认5分钟；如果设过，保留
    if (checked && !userSetTime) {
      setEstimatedMinutes(5)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 仅阻止日期选择器等控件上的 Enter 传播，不再创建任务
    const target = e.target as HTMLElement
    const isDateCal = (target as HTMLInputElement).type === 'date'
    if (e.key === 'Enter' && isDateCal) {
      e.preventDefault()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onKeyDown={handleKeyDown}>
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-lg text-slate-800 mb-4">新建任务</h2>
        <div className="space-y-3">
          <div>
            <label className="label">任务名称</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="输入任务名称" autoFocus />
          </div>
          {/* 精力消耗等级 */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="label mb-0">精力消耗等级</label>
              <button onClick={() => setShowExplain(!showExplain)}
                className="text-[10px] text-slate-300 hover:text-blue-400 w-4 h-4 rounded-full border border-slate-200 flex items-center justify-center">?</button>
            </div>
            {showExplain && (
              <div className="text-[10px] text-slate-500 bg-blue-50 rounded-lg p-2 mb-2 leading-relaxed">
                <p className="font-medium mb-0.5">把重复的小事交给系统</p>
                <p>有些事情本身并不难，但需要我们不断记住和提醒自己。把这些重复行为交给 Energy Action，可以减少不必要的记忆和重复决策。</p>
                <p className="mt-1">精力等级表示这件事需要消耗多少心智或体力，<strong>不代表这件事情的重要程度</strong>。</p>
              </div>
            )}
            {isHabit ? (
              <div className="flex flex-wrap gap-1.5">
                <span className="px-3 py-1.5 rounded-full text-xs bg-blue-500 text-white">
                  {HABIT_ENERGY.label} · {HABIT_ENERGY.points}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ENERGY_LEVELS.map(el => (
                  <button key={el.level} onClick={() => handleEnergyChange(el.level, el.defaultMin)}
                    title={el.desc}
                    className={cn('px-3 py-1.5 rounded-full text-xs transition-colors',
                      energyLevel === el.level
                        ? 'bg-blue-500 text-white'
                        : 'border border-slate-200 text-slate-600 hover:border-blue-300')}>
                    {el.label} · {el.points}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">预计时长(分)</label>
              <input type="number" className="input" value={estimatedMinutes || ''}
                onChange={e => handleMinChange(Number(e.target.value))} min={0} />
            </div>
            <div>
              <label className="label">状态</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as TaskStatus)}>
                <option value="unscheduled">待安排</option>
                <option value="todo">待办</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
              </select>
            </div>
          </div>
          <SmartDateInput
            label="截止日期"
            value={dueDate}
            onChange={setDueDate}
            placeholder="支持直接输入月日，不必输入完整年份"
          />
          <SmartDateInput
            label="计划日期"
            value={plannedDate}
            onChange={setPlannedDate}
            placeholder="支持直接输入月日，不必输入完整年份"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isHabit}
                onChange={e => handleHabitToggle(e.target.checked)} className="rounded" />
              <span className="text-sm text-slate-700">设为习惯</span>
            </label>
            {isHabit && (
              <select className="input flex-1 text-sm" value={recurrenceRule}
                onChange={e => setRecurrenceRule(e.target.value)}>
                <option value="FREQ=DAILY">每天</option>
                <option value="FREQ=WEEKLY;BYDAY=MO,WE,FR">周一三五</option>
                <option value="FREQ=WEEKLY">每周</option>
              </select>
            )}
          </div>
        </div>
        {submitError && <p role="alert" className="mt-4 text-sm text-red-600">{submitError}</p>}
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button onClick={openDecompositionChoice} className="btn-primary" disabled={!title.trim() || isSubmitting}>
            {isSubmitting ? taskCopy.creating : '创建'}
          </button>
        </div>
      </div>
      {showDecompositionChoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="decomposition-choice-title">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full shadow-xl">
            <h3 id="decomposition-choice-title" className="font-semibold text-slate-800">这个任务需要拆解吗？</h3>
            <p className="text-sm text-slate-500 mt-2">需要拆解的任务会归类为大任务；之后你可以自行修改小任务和最小行动。</p>
            {isHabit && <p className="text-xs text-amber-600 mt-2">习惯会作为小任务创建，不需要拆解。</p>}
            <div className="flex flex-col gap-2 mt-4">
              <button type="button" onClick={() => handleSubmit('small')} className="btn-secondary text-left">不拆解，作为小任务</button>
              {!isHabit && <button type="button" onClick={() => handleSubmit('large')} className="btn-primary text-left">归类为大任务（需要拆解）</button>}
              <button type="button" onClick={() => setShowDecompositionChoice(false)} className="text-xs text-slate-500 hover:text-slate-700 py-1">返回修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditTaskModal({
  task, onClose, onUpdated,
}: {
  task: Task
  onClose: () => void
  onUpdated: () => void
}) {
  const energyFromTask = task.isHabit ? 1 : task.energyDemand
  const [title, setTitle] = useState(task.title)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [energyLevel, setEnergyLevel] = useState<EnergyDemand>(energyFromTask as EnergyDemand)
  const [estimatedMinutes, setEstimatedMinutes] = useState(task.estimatedMinutes || 0)
  const [userSetTime, setUserSetTime] = useState(task.estimatedMinutes > 0)
  const [dueDate, setDueDate] = useState(task.dueDate || '')
  const [plannedDate, setPlannedDate] = useState(task.plannedDate || '')
  const [isHabit, setIsHabit] = useState(task.isHabit)
  const [recurrenceRule, setRecurrenceRule] = useState('')
  const [showExplain, setShowExplain] = useState(false)
  const [subtasks, setSubtasks] = useState<Task[]>([])
  const [newSubTitle, setNewSubTitle] = useState('')

  useEffect(() => { (async () => {
    const repo = new DexieTaskRepository()
    const subs = await repo.getSubtasks(task.id)
    setSubtasks(subs.filter((s: Task) => !s.deletedAt))
  })() }, [task.id])

  const handleSave = async () => {
    if (!title.trim()) return
    const dueParsed = dueDate ? parseDateInput(dueDate) : parseDateInput('')
    const planParsed = plannedDate ? parseDateInput(plannedDate) : parseDateInput('')
    if (dueDate && (!dueParsed.recognized || !dueParsed.calendarValid)) return
    if (plannedDate && (!planParsed.recognized || !planParsed.calendarValid)) return
    const repo = new DexieTaskRepository()
    await repo.update(task.id, {
      title: title.trim(), status, estimatedMinutes: estimatedMinutes || 0,
      energyDemand: (isHabit ? 1 : energyLevel) as EnergyDemand,
      dueDate: dueParsed.normalized || null, plannedDate: planParsed.normalized || plannedDate || null,
      isHabit, completedAt: status === 'done' ? (task.completedAt || now()) : task.completedAt,
    })
    onUpdated()
  }

  const handleEnergyChange = (level: number, defaultMin: number) => {
    setEnergyLevel(level as EnergyDemand)
    if (!userSetTime) setEstimatedMinutes(defaultMin)
  }
  const handleMinChange = (val: number) => { setEstimatedMinutes(val); setUserSetTime(true) }
  const handleHabitToggle = (checked: boolean) => { setIsHabit(checked); if (checked && !userSetTime) setEstimatedMinutes(5) }

  const addSubtask = async () => {
    if (!newSubTitle.trim()) return
    const repo = new DexieTaskRepository()
    await repo.create({
      id: generateId(), title: newSubTitle.trim(), description: '', projectId: task.projectId, goalId: task.goalId, keyResultId: task.keyResultId, columnId: null,
      status: 'todo', userPriority: null, aiPriorityScore: 0, aiPriorityLevel: null, aiPriorityReason: '',
      dueDate: null, plannedDate: null, estimatedMinutes: 0, actualMinutes: 0,
      cognitiveLoad: 'medium' as CognitiveLoad, energyDemand: 3 as EnergyDemand, recurrenceRule: null, isHabit: false,
      completedAt: null, parentTaskId: task.id, taskKind: 'small', order: 0, createdAt: now(), updatedAt: now(), deletedAt: null,
    } as any)
    setNewSubTitle('')
    const updated = await repo.getSubtasks(task.id); setSubtasks(updated.filter((s: Task) => !s.deletedAt))
  }
  const toggleSubtask = async (sub: Task) => {
    const repo = new DexieTaskRepository()
    await repo.update(sub.id, { status: sub.status === 'done' ? 'todo' : 'done', completedAt: sub.status !== 'done' ? now() : null })
    const updated = await repo.getSubtasks(task.id); setSubtasks(updated.filter((s: Task) => !s.deletedAt))
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 id="edit-task-title" className="font-semibold text-lg text-slate-800 mb-4">编辑任务</h2>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="edit-task-title-input">任务名称</label>
            <input id="edit-task-title-input" className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="label mb-0">精力消耗等级</label>
              <button onClick={() => setShowExplain(!showExplain)} className="text-[10px] text-slate-300 hover:text-blue-400 w-4 h-4 rounded-full border border-slate-200 flex items-center justify-center">?</button>
            </div>
            {showExplain && (
              <div className="text-[10px] text-slate-500 bg-blue-50 rounded-lg p-2 mb-2 leading-relaxed">
                <p className="font-medium mb-0.5">把重复的小事交给系统</p>
                <p>有些事情本身并不难，但需要我们不断记住和提醒自己。把这些重复行为交给 Energy Action，可以减少不必要的记忆和重复决策。</p>
                <p className="mt-1">精力等级表示这件事需要消耗多少心智或体力，<strong>不代表这件事情的重要程度</strong>。</p>
              </div>
            )}
            {isHabit ? (
              <div className="flex flex-wrap gap-1.5">
                <span className="px-3 py-1.5 rounded-full text-xs bg-blue-500 text-white">{HABIT_ENERGY.label} · {HABIT_ENERGY.points}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ENERGY_LEVELS.map(el => (
                  <button key={el.level} onClick={() => handleEnergyChange(el.level, el.defaultMin)} title={el.desc}
                    className={cn('px-3 py-1.5 rounded-full text-xs transition-colors',
                      energyLevel === el.level ? 'bg-blue-500 text-white' : 'border border-slate-200 text-slate-600 hover:border-blue-300')}>
                    {el.label} · {el.points}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">预计时长(分)</label>
              <input type="number" className="input" value={estimatedMinutes || ''} onChange={e => handleMinChange(Number(e.target.value))} min={0} /></div>
            <div><label className="label">状态</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as TaskStatus)}>
                <option value="unscheduled">待安排</option><option value="todo">待办</option>
                <option value="doing">进行中</option><option value="done">已完成</option>
              </select></div>
          </div>
          <SmartDateInput label="截止日期" value={dueDate} onChange={setDueDate} placeholder="支持直接输入月日，不必输入完整年份" />
          <SmartDateInput label="计划日期" value={plannedDate} onChange={setPlannedDate} placeholder="支持直接输入月日，不必输入完整年份" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isHabit} onChange={e => handleHabitToggle(e.target.checked)} className="rounded" />
              <span className="text-sm text-slate-700">设为习惯</span>
            </label>
            {isHabit && (<select className="input flex-1 text-sm" value={recurrenceRule} onChange={e => setRecurrenceRule(e.target.value)}>
              <option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY;BYDAY=MO,WE,FR">周一三五</option><option value="FREQ=WEEKLY">每周</option></select>)}
          </div>
          {subtasks.length > 0 && (<div className="border-t pt-2">
            <label className="text-xs font-medium text-slate-600">子任务 ({subtasks.length})</label>
            <div className="space-y-1 mt-1 max-h-32 overflow-y-auto">
              {subtasks.map(sub => (<div key={sub.id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-slate-50">
                <button onClick={() => toggleSubtask(sub)}
                  className={cn('w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center', sub.status === 'done' ? 'bg-green-500 border-green-500' : 'border-slate-300')}>
                  {sub.status === 'done' && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                <span className={cn('flex-1 truncate', sub.status === 'done' && 'line-through text-slate-400')}>{sub.title}</span>
              </div>))}
            </div>
          </div>)}
          <div className="flex gap-2"><input className="input text-xs flex-1" value={newSubTitle} onChange={e => setNewSubTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSubtask()} placeholder="添加子任务..." /></div>
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button onClick={handleSave} className="btn-primary" disabled={!title.trim()}>保存</button>
        </div>
      </div>
    </div>
  )
}
