// ============================================================
// projectDailyLogService - 项目每日进展：手动/自动记录、补齐、完成停止
// ============================================================

import type { Project, Task, ProjectDailyLog, CompletionRecord, TimeRecord } from '@/domain/models'
import { generateId } from '@/lib/utils'

/** 为当天生成自动日志（幂等：同一 projectId+date 最多一条） */
export function generateAutoLog(
  project: Project,
  date: string,
  tasks: Task[],
  completions: CompletionRecord[],
  timeRecords: TimeRecord[],
): ProjectDailyLog {
  const projectTasks = tasks.filter(t => t.projectId === project.id && !t.deletedAt)
  const tasksCompleted = completions.filter(
    c => c.completedDate === date && c.status === 'completed' && projectTasks.some(pt => pt.id === c.taskId)
  ).length
  const tasksCreated = projectTasks.filter(
    t => t.createdAt?.startsWith(date)
  ).length
  const focusMinutes = timeRecords
    .filter(r => r.projectId === project.id && r.startAt?.startsWith(date) && !r.deletedAt)
    .reduce((sum, r) => sum + (r.durationMinutes || 0), 0)

  let summary = ''
  const parts: string[] = []
  if (tasksCompleted > 0) parts.push(`完成${tasksCompleted}个关联任务`)
  if (tasksCreated > 0) parts.push(`新增${tasksCreated}个任务`)
  if (focusMinutes > 0) parts.push(`专注${focusMinutes}分钟`)

  if (parts.length > 0) {
    summary = '今日' + parts.join(' · ')
  } else {
    summary = '今日暂无新的项目进展。'
  }

  return {
    id: generateId(),
    projectId: project.id,
    date,
    source: 'auto',
    summary,
    tasksCompleted,
    tasksCreated,
    focusMinutes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 检查启动时需要补齐的缺失日期（从 startDate 到昨天） */
export function getMissingDates(
  project: Project,
  existingDates: Set<string>,
  todayStr: string,
): string[] {
  if (!project.startDate) return []
  const missing: string[] = []
  const start = new Date(project.startDate)
  const yesterday = new Date(todayStr)
  yesterday.setDate(yesterday.getDate() - 1)

  const current = new Date(start)
  current.setHours(0, 0, 0, 0)
  while (current <= yesterday) {
    const dateStr = current.toISOString().split('T')[0]
    if (!existingDates.has(dateStr)) {
      missing.push(dateStr)
    }
    current.setDate(current.getDate() + 1)
  }
  return missing
}
