// ============================================================
// UndoneTasksSelector — 复盘未完成任务多选器
// ============================================================

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { Task } from '@/domain/models'
import { shouldExecuteOnDate } from '@/services/recurrenceEngine'

interface UndoneTasksSelectorProps {
  tasks: Task[]
  date: string
  completions: Array<{ taskId: string; completedDate: string; status: string }>
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function UndoneTasksSelector({
  tasks, date, completions, selectedIds, onChange,
}: UndoneTasksSelectorProps) {
  // 候选任务：与当前日期相关、未完成、未跳过、未取消
  const candidates = useMemo(() => {
    return tasks.filter(t => {
      if (t.deletedAt) return false
      if (t.status === 'done' || t.status === 'cancelled') return false

      // 已有完成或跳过记录的不参与
      const hasRecord = completions.some(
        r => r.taskId === t.id && r.completedDate === date
      )
      if (hasRecord) return false

      // 日期关联
      const dateRelated =
        t.plannedDate === date ||
        t.dueDate === date ||
        (t.isHabit && shouldExecuteOnDate(t, date))

      if (!dateRelated) return false

      // Inbox 必须有关联日期
      if (t.status === 'inbox' && !t.plannedDate && !t.dueDate) return false

      return true
    })
  }, [tasks, date, completions])

  const toggle = (taskId: string) => {
    if (selectedIds.includes(taskId)) {
      onChange(selectedIds.filter(id => id !== taskId))
    } else {
      onChange([...selectedIds, taskId])
    }
  }

  const toggleAll = () => {
    if (selectedIds.length === candidates.length) {
      onChange([])
    } else {
      onChange(candidates.map(c => c.id))
    }
  }

  if (candidates.length === 0) {
    return (
      <div className="text-xs text-slate-400 py-2">
        当天没有未完成的任务
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400">
          共 {candidates.length} 个候选任务
        </span>
        <button onClick={toggleAll} className="text-[10px] text-blue-500 hover:text-blue-700">
          {selectedIds.length === candidates.length ? '全部取消' : '全部勾选'}
        </button>
      </div>
      {candidates.map(task => (
        <label
          key={task.id}
          className={cn(
            'flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-50',
            selectedIds.includes(task.id) && 'bg-blue-50'
          )}
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(task.id)}
            onChange={() => toggle(task.id)}
            className="rounded w-3.5 h-3.5"
          />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-slate-700 truncate block">
              {task.title}
            </span>
            <span className="text-[10px] text-slate-400">
              {task.isHabit ? '固定任务' : ''}
              {task.plannedDate && ` · ${task.plannedDate}`}
              {task.energyDemand && ` · ${task.energyDemand}级`}
            </span>
          </div>
        </label>
      ))}
    </div>
  )
}
