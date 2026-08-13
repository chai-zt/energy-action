// ============================================================
// recurrenceEngine — 重复规则引擎
// 判断固定任务在某日期是否应执行
// ============================================================

import type { Task } from '@/domain/models'
import { today } from '@/lib/utils'

/** 解析 RRULE 字符串，判断日期是否应执行 */
export function shouldExecuteOnDate(task: Task, targetDate: string): boolean {
  // 只对固定任务生效
  if (!task.isHabit) return false
  // 暂停了不执行
  if ((task as any).status === 'paused') return false
  if (task.deletedAt) return false

  const rule = task.recurrenceRule
  if (!rule) {
    // 无重复规则，视为每天
    return true
  }

  // 检查开始日期
  const taskDate = task.createdAt?.slice(0, 10) || '2026-01-01'
  if (targetDate < taskDate) return false

  // 解析规则
  const parts = rule.split(';').map(p => p.trim())

  // FREQ
  const freq = parts.find(p => p.startsWith('FREQ='))?.split('=')[1]
  const byDay = parts.find(p => p.startsWith('BYDAY='))?.split('=')[1]?.split(',')
  const countTarget = parseInt(parts.find(p => p.startsWith('COUNT_TARGET='))?.split('=')[1] || '0')
  const interval = parseInt(parts.find(p => p.startsWith('INTERVAL=') || p.startsWith('DAYS='))?.split('=')[1] || '0')
  const byMonthDay = parts.find(p => p.startsWith('BYMONTHDAY='))?.split('=')[1]

  const targetD = new Date(targetDate)
  const targetDayOfWeek = targetD.getDay() === 0 ? 7 : targetD.getDay() // 周一=1, 周日=7
  const targetDayOfMonth = targetD.getDate()

  switch (freq) {
    case 'DAILY':
      return true

    case 'WEEKLY': {
      if (countTarget > 0) {
        // 每周N次：总是允许执行，由上层根据 CompletionRecord 统计判断
        return true
      }
      if (byDay && byDay.length > 0) {
        const dayMap: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
        return byDay.some(d => dayMap[d] === targetDayOfWeek)
      }
      return targetDayOfWeek === 1 // 默认周一
    }

    case 'MONTHLY': {
      if (byMonthDay) {
        const targetDay = parseInt(byMonthDay)
        return targetDayOfMonth === targetDay
      }
      return targetDayOfMonth === 1 // 默认每月1号
    }

    case 'INTERVAL': {
      if (interval > 0) {
        const start = new Date(taskDate).getTime()
        const target = targetD.getTime()
        const daysSinceStart = Math.floor((target - start) / 86400000)
        return daysSinceStart >= 0 && daysSinceStart % interval === 0
      }
      return false
    }

    default:
      // 未知规则，视为每天
      return true
  }
}

/** 获取指定周内已完成的次数（用于 COUNT_TARGET 规则） */
export function getWeeklyCompletions(taskId: string, date: string, allRecords: Array<{ taskId: string; completedDate: string; status: string }>): number {
  const d = new Date(date)
  const dayOfWeek = d.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(d)
  monday.setDate(monday.getDate() + mondayOffset)
  const mondayStr = monday.toISOString().split('T')[0]

  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const sundayStr = sunday.toISOString().split('T')[0]

  return allRecords.filter(r =>
    r.taskId === taskId &&
    r.status === 'completed' &&
    r.completedDate >= mondayStr &&
    r.completedDate <= sundayStr
  ).length
}

/** 计算固定任务的连续天数/周数统计 */
export function calcStreak(taskId: string, date: string, allRecords: Array<{ taskId: string; completedDate: string; status: string }>, freq: string): number {
  const targetDate = new Date(date)
  let streak = 0

  if (freq?.includes('COUNT_TARGET')) {
    // 周统计：按周计算
    let currentMonday = new Date(targetDate)
    const dayOfWeek = currentMonday.getDay()
    const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    currentMonday.setDate(currentMonday.getDate() + offset)

    while (true) {
      const mondayStr = currentMonday.toISOString().split('T')[0]
      const sunday = new Date(currentMonday)
      sunday.setDate(sunday.getDate() + 6)
      const sundayStr = sunday.toISOString().split('T')[0]

      const weekCompletions = allRecords.filter(r =>
        r.taskId === taskId &&
        r.status === 'completed' &&
        r.completedDate >= mondayStr &&
        r.completedDate <= sundayStr
      ).length

      if (weekCompletions > 0) {
        streak++
        currentMonday.setDate(currentMonday.getDate() - 7)
      } else {
        break
      }
    }
  } else {
    // 日统计
    let current = new Date(targetDate)
    while (true) {
      const dateStr = current.toISOString().split('T')[0]
      const hasRecord = allRecords.some(r =>
        r.taskId === taskId &&
        r.status === 'completed' &&
        r.completedDate === dateStr
      )
      if (hasRecord) {
        streak++
        current.setDate(current.getDate() - 1)
      } else {
        break
      }
    }
  }

  return streak
}
