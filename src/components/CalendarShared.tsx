// ============================================================
// 共享日历组件 — 任务页紧凑日历 & 独立日历详细版统一使用
// ============================================================

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  ChevronLeft, ChevronRight, ListTree, CheckSquare,
  Plus, X, Clock, ChevronDown, ChevronUp, Zap, Timer, BookOpen,
  Calendar, Target as CheckCircleIcon,
} from 'lucide-react'
import {
  cn, generateId, now, today, getMonthGrid, isSameDay,
  addDays, addMonths, formatLongDate, formatMonthTitle,
} from '@/lib/utils'
import {
  DexieTaskRepository, DexieDailyStateRepository, DexieDailyReviewRepository,
  DexieTimeRecordRepository, DexieCompletionRepository, DexiePomodoroRepository,
} from '@/storage/repositories'
import type {
  Task, DailyState, DailyReview, TimeRecord, PomodoroSession,
  CompletionRecord, TaskSchedule,
} from '@/domain/models'

// ============ 紧凑月历 ============

export interface CompactMonthProps {
  currentMonth: Date
  selectedDate: string
  tasks: Task[]
  isActiveDrag?: boolean
  onSelectDate: (date: string) => void
  onPrevMonth?: () => void
  onNextMonth?: () => void
}

export function CompactMonth({
  currentMonth, selectedDate, tasks, isActiveDrag = false,
  onSelectDate, onPrevMonth, onNextMonth,
}: CompactMonthProps) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const days = getMonthGrid(year, month)
  const todayStr = today()

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
          <button
            onClick={onPrevMonth || (() => {})}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          ><ChevronLeft size={14} /></button>
          <button
            onClick={onNextMonth || (() => {})}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          ><ChevronRight size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400 mb-1">
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

export function MonthDayCell({
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
  isActive: boolean
  onClick: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` })

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
        isOver && !isSelected && 'ring-2 ring-amber-400 ring-offset-1 bg-amber-50 border-2 border-dashed border-amber-300'
      )}
    >
      <span className="leading-none">{date.getDate()}</span>
      {taskCount > 0 && isCurrentMonth && (
        <span className={cn(
          'flex items-center gap-0.5 text-[8px] mt-0.5 leading-none',
          isSelected ? 'text-white' : isToday ? 'text-blue-600' : 'text-slate-500'
        )}>
          {allDone ? <CheckSquare size={7} /> : <ListTree size={7} />}
          <span className="font-medium">{displayCount}</span>
        </span>
      )}
    </button>
  )
}

// ============ 周视图 ============

export interface WeekViewProps {
  currentDate: Date
  tasks: Task[]
  onSelectDate: (date: string) => void
}

export function WeekView({ currentDate, tasks, onSelectDate }: WeekViewProps) {
  const todayStr = today()
  const startOfWeek = useMemo(() => {
    const d = new Date(currentDate)
    const day = d.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + mondayOffset)
    return d
  }, [currentDate])

  const days = useMemo(() => {
    const result: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek)
      d.setDate(startOfWeek.getDate() + i)
      result.push(d)
    }
    return result
  }, [startOfWeek])

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {}
    tasks.forEach(t => {
      if (t.plannedDate && !t.deletedAt) {
        if (!map[t.plannedDate]) map[t.plannedDate] = []
        map[t.plannedDate].push(t)
      }
    })
    return map
  }, [tasks])

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {days.map((d, i) => (
          <div key={i} className="text-center text-xs text-slate-500 py-1">
            {['一', '二', '三', '四', '五', '六', '日'][i]}
            <div className={cn(
              'text-base font-semibold mt-0.5',
              isSameDay(d.toISOString().split('T')[0], todayStr) ? 'text-blue-600' : 'text-slate-700'
            )}>
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const dateStr = d.toISOString().split('T')[0]
          const dayTasks = tasksByDate[dateStr] || []
          const isToday = dateStr === todayStr
          return (
            <button
              key={i}
              onClick={() => onSelectDate(dateStr)}
              className={cn(
                'min-h-[100px] p-1.5 rounded-lg border text-left transition-colors',
                isToday ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:bg-slate-50'
              )}
            >
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map(t => (
                  <div key={t.id} className={cn(
                    'text-[10px] px-1 py-0.5 rounded truncate',
                    t.status === 'done' ? 'bg-green-100 text-green-700 line-through' : 'bg-blue-100 text-blue-700'
                  )}>
                    {t.title}
                  </div>
                ))}
                {dayTasks.length > 3 && (
                  <div className="text-[10px] text-slate-500">+{dayTasks.length - 3} 更多</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ============ 日视图 ============

export interface DayViewProps {
  date: Date
  tasks: Task[]
  onSelectDate: (date: string) => void
}

export function DayView({ date, tasks, onSelectDate }: DayViewProps) {
  const todayStr = today()
  const dateStr = date.toISOString().split('T')[0]
  const dayTasks = tasks.filter(t => t.plannedDate === dateStr && !t.deletedAt)
  const isToday = dateStr === todayStr

  return (
    <div>
      <div className="text-center mb-4">
        <div className="text-xs text-slate-500">
          {['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()]}
        </div>
        <div className={cn(
          'text-3xl font-bold',
          isToday ? 'text-blue-600' : 'text-slate-700'
        )}>
          {date.getDate()}
        </div>
        <div className="text-xs text-slate-400">
          {formatMonthTitle(date)}
        </div>
      </div>

      <div className="space-y-1.5">
        {dayTasks.length === 0 ? (
          <div className="text-center py-12 text-sm text-slate-400">
            <Calendar size={32} className="mx-auto mb-2 text-slate-300" />
            <p>这一天还没有任务</p>
          </div>
        ) : (
          dayTasks.map((t, i) => (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-2 p-3 rounded-lg border',
                t.status === 'done' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
              )}
            >
              <span className="text-xs text-slate-500 w-8">{i + 1}.</span>
              <div className="flex-1">
                <div className={cn(
                  'text-sm font-medium',
                  t.status === 'done' ? 'text-green-700 line-through' : 'text-slate-700'
                )}>
                  {t.title}
                </div>
                {t.estimatedMinutes > 0 && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    <Clock size={10} className="inline" /> {t.estimatedMinutes} 分钟
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ============ 列表视图 ============

export function ListView({
  tasks, onSelectDate,
}: {
  tasks: Task[]
  onSelectDate: (date: string) => void
}) {
  const grouped = useMemo(() => {
    const groups: Record<string, Task[]> = {}
    tasks.filter(t => t.plannedDate && !t.deletedAt).forEach(t => {
      if (!groups[t.plannedDate!]) groups[t.plannedDate!] = []
      groups[t.plannedDate!].push(t)
    })
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [tasks])

  if (grouped.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-slate-400">
        <p>暂无排期任务</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {grouped.map(([date, dateTasks]) => (
        <div key={date} className="card cursor-pointer hover:border-blue-200" onClick={() => onSelectDate(date)}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-700">{formatLongDate(date)}</h4>
            <span className="badge badge-p2 text-[10px]">{dateTasks.length} 个任务</span>
          </div>
          <div className="space-y-1">
            {dateTasks.map(t => (
              <div key={t.id} className="text-xs p-1.5 flex items-center gap-2">
                <ListTree size={10} className="text-slate-400" />
                <span className={cn(t.status === 'done' && 'line-through text-slate-400')}>
                  {t.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============ 统一拖拽上下文 ============

export interface CalendarDragContextProps {
  tasks: Task[]
  scheduledTasks: Task[]
  onTaskUpdated: () => void
  onToast: (msg: string) => void
  selectedDate: string
  onSelectDate: (date: string) => void
  onUndo: (taskId: string, oldDate: string | null) => void
  children: (ctx: {
    activeTaskId: string | null
    setActiveTaskId: (id: string | null) => void
    sensors: any
    handleDragStart: (e: any) => void
    handleDragEnd: (e: DragEndEvent) => void
    handleDragCancel: () => void
  }) => React.ReactNode
}

export function CalendarDragContext({
  tasks, onTaskUpdated, onToast, selectedDate, onSelectDate, onUndo, children,
}: CalendarDragContextProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragStart = (e: any) => setActiveTaskId(e.active.id as string)

  const handleDragEnd = async (event: DragEndEvent) => {
    const taskId = event.active.id as string
    setActiveTaskId(null)

    const overId = event.over?.id as string | undefined
    if (!overId || !overId.startsWith('date-')) return

    const targetDate = overId.replace('date-', '')
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.plannedDate === targetDate) return

    const oldDate = task.plannedDate
    onUndo(taskId, oldDate)

    await new DexieTaskRepository().update(taskId, { plannedDate: targetDate })
    onToast(`已将"${task.title}"安排到${formatLongDate(targetDate)}`)
    onSelectDate(targetDate)
    onTaskUpdated()
  }

  const handleDragCancel = () => setActiveTaskId(null)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children({ activeTaskId, setActiveTaskId, sensors, handleDragStart, handleDragEnd, handleDragCancel })}
      <DragOverlay>
        {activeTaskId ? (() => {
          const t = tasks.find(tt => tt.id === activeTaskId)
          if (!t) return null
          return (
            <div className="p-2 rounded-lg border border-blue-400 bg-white shadow-xl opacity-90 text-xs flex items-center gap-2 max-w-xs">
              <ListTree size={12} className="text-blue-500" />
              <span className="truncate">{t.title}</span>
            </div>
          )
        })() : null}
      </DragOverlay>
    </DndContext>
  )
}

// ============ 拖拽源：可拖拽任务卡片 ============

export function DraggableTaskItem({
  task, onClick,
}: {
  task: Task
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const todayStr = today()

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDragging) return
    onClick()
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-grab active:cursor-grabbing group touch-none',
        isDragging && 'opacity-30',
        task.status === 'done' && 'opacity-60'
      )}
    >
      <div className="flex-1 min-w-0" onClick={handleClick}>
        <p className={cn(
          'text-xs',
          task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'
        )}>
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {task.isHabit && <span className="badge badge-success text-[9px]">习惯</span>}
          {task.estimatedMinutes > 0 && (
            <span className="text-[10px] text-slate-400">
              <Clock size={8} className="inline" />{task.estimatedMinutes}分
            </span>
          )}
          {task.plannedDate && (
            <span className="text-[10px] text-blue-500">📅 {task.plannedDate}</span>
          )}
        </div>
      </div>
    </div>
  )
}
