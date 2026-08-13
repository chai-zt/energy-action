// ============================================================
// energyService — 精力预算系统 V2
// 修复：固定任务预占、去重、完整字段
// ============================================================

import type { Task, CompletionRecord } from '@/domain/models'
import { shouldExecuteOnDate } from './recurrenceEngine'

/** 精力映射表 */
export const ENERGY_MAP: Record<number, number> = {
  1: 3,
  2: 5,
  3: 10,
  4: 20,
  5: 30,
}

export const ENERGY_BUDGET = 100

/** 从 energyDemand 获取精力点数 */
export function getEnergyCost(task: Pick<Task, 'energyDemand'>): number {
  return ENERGY_MAP[task.energyDemand] || 10
}

/** 固定任务预占精力：今天应执行的固定任务能量总和 */
export function calcFixedTaskPlannedEnergy(tasks: Task[], completions: Array<{ taskId: string; completedDate: string; status: string }>, targetDate: string): number {
  const seen = new Set<string>()
  return tasks
    .filter(t => t.isHabit && !t.deletedAt && shouldExecuteOnDate(t, targetDate))
    .filter(t => {
      // 去重
      if (seen.has(t.id)) return false
      seen.add(t.id)
      // 已完成或已跳过的固定任务不计入预占
      const hasRecord = completions.some(
        r => r.taskId === t.id && r.completedDate === targetDate && (r.status === 'completed' || r.status === 'skipped')
      )
      return !hasRecord
    })
    .reduce((sum, t) => sum + getEnergyCost(t), 0)
}

/** 普通任务计划精力 */
export function calcOrdinaryTaskPlannedEnergy(tasks: Task[], targetDate: string): number {
  const seen = new Set<string>()
  return tasks
    .filter(t => !t.isHabit && !t.deletedAt && t.plannedDate === targetDate && t.status !== 'done' && t.status !== 'cancelled')
    .filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    .reduce((sum, t) => sum + getEnergyCost(t), 0)
}

/** 当天已计划精力 = 固定任务预占 + 普通任务计划（去重） */
export function calcPlannedEnergy(tasks: Task[], targetDate: string): number {
  return calcFixedTaskPlannedEnergy(tasks, [], targetDate) + calcOrdinaryTaskPlannedEnergy(tasks, targetDate)
}

/** 当天已消耗精力（仅 completed，去重） */
export function calcConsumedEnergy(records: Array<{ completedDate: string; energyCostSnapshot: number; status: string; taskId: string }>, targetDate: string): number {
  const seen = new Set<string>()
  let sum = 0
  for (const r of records) {
    if (r.completedDate !== targetDate) continue
    if (r.status !== 'completed') continue
    if (seen.has(r.taskId)) continue
    seen.add(r.taskId)
    sum += r.energyCostSnapshot || 0
  }
  return Math.min(sum, sum) // sum as-is
}

export function calcRemainingEnergy(
  tasks: Task[],
  records: Array<{ taskId: string; completedDate: string; status: string; energyCostSnapshot: number }>,
  targetDate: string,
): {
  budget: number
  fixedPlanned: number
  ordinaryPlanned: number
  planned: number
  consumed: number
  remaining: number
  available: number
} {
  const fixedPlanned = calcFixedTaskPlannedEnergy(tasks, records, targetDate)
  const ordinaryPlanned = calcOrdinaryTaskPlannedEnergy(tasks, targetDate)
  const planned = fixedPlanned + ordinaryPlanned
  const consumed = calcConsumedEnergy(records, targetDate)

  return {
    budget: ENERGY_BUDGET,
    fixedPlanned,
    ordinaryPlanned,
    planned,
    consumed,
    remaining: Math.max(0, ENERGY_BUDGET - consumed),
    available: Math.max(0, ENERGY_BUDGET - planned),
  }
}

export function wouldExceedBudget(tasks: Task[], targetDate: string, newTaskCost: number): boolean {
  const planned = calcPlannedEnergy(tasks, targetDate)
  return planned + newTaskCost > ENERGY_BUDGET
}
