import { describe, it, expect } from 'vitest'
import { shouldExecuteOnDate, getWeeklyCompletions } from '@/services/recurrenceEngine'
import type { Task } from '@/domain/models'

function makeHabit(recurrenceRule: string, createdAt?: string): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Test Habit',
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
    plannedDate: null,
    estimatedMinutes: 30,
    actualMinutes: 0,
    cognitiveLoad: 'medium',
    energyDemand: 3,
    recurrenceRule,
    isHabit: true,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: createdAt || '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
  }
}

describe('recurrenceEngine - shouldExecuteOnDate', () => {
  it('should return false for non-habit tasks', () => {
    const task = { ...makeHabit('FREQ=DAILY'), isHabit: false }
    expect(shouldExecuteOnDate(task, '2026-08-07')).toBe(false)
  })

  it('should return true for DAILY rule', () => {
    const task = makeHabit('FREQ=DAILY')
    expect(shouldExecuteOnDate(task, '2026-08-07')).toBe(true)
  })

  it('should return true for WEEKLY BYDAY Monday', () => {
    const task = makeHabit('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    // 2026-08-03 is Monday
    expect(shouldExecuteOnDate(task, '2026-08-03')).toBe(true)
    // 2026-08-05 is Wednesday
    expect(shouldExecuteOnDate(task, '2026-08-05')).toBe(true)
  })

  it('should return false for WEEKLY BYDAY on off days', () => {
    const task = makeHabit('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    // 2026-08-04 is Tuesday
    expect(shouldExecuteOnDate(task, '2026-08-04')).toBe(false)
  })

  it('should return true for WEEKLY COUNT_TARGET (always allow)', () => {
    const task = makeHabit('FREQ=WEEKLY;COUNT_TARGET=3')
    expect(shouldExecuteOnDate(task, '2026-08-07')).toBe(true)
  })

  it('should return true for MONTHLY BYMONTHDAY', () => {
    const task = makeHabit('FREQ=MONTHLY;BYMONTHDAY=1')
    expect(shouldExecuteOnDate(task, '2026-08-01')).toBe(true)
    expect(shouldExecuteOnDate(task, '2026-08-15')).toBe(false)
  })

  it('should return true for INTERVAL DAYS=2', () => {
    const task = makeHabit('FREQ=INTERVAL;DAYS=2', '2026-08-01T00:00:00.000Z')
    expect(shouldExecuteOnDate(task, '2026-08-01')).toBe(true)
    expect(shouldExecuteOnDate(task, '2026-08-03')).toBe(true)
    expect(shouldExecuteOnDate(task, '2026-08-05')).toBe(true)
    expect(shouldExecuteOnDate(task, '2026-08-02')).toBe(false)
  })

  it('should return false for date before task creation', () => {
    const task = makeHabit('FREQ=DAILY', '2026-08-05T00:00:00.000Z')
    expect(shouldExecuteOnDate(task, '2026-08-01')).toBe(false)
  })

  it('should return false for deleted tasks', () => {
    const task = { ...makeHabit('FREQ=DAILY'), deletedAt: '2026-08-06' }
    expect(shouldExecuteOnDate(task, '2026-08-07')).toBe(false)
  })
})

describe('getWeeklyCompletions', () => {
  it('should count completions within the week', () => {
    const records = [
      { taskId: 'h1', completedDate: '2026-08-03', status: 'completed' },
      { taskId: 'h1', completedDate: '2026-08-05', status: 'completed' },
      { taskId: 'h1', completedDate: '2026-08-09', status: 'completed' },
    ]
    // 2026-08-03 is Monday, so week is 08-03 to 08-09
    const count = getWeeklyCompletions('h1', '2026-08-06', records)
    expect(count).toBe(3)
  })

  it('should not count skipped records', () => {
    const records = [
      { taskId: 'h1', completedDate: '2026-08-03', status: 'skipped' },
      { taskId: 'h1', completedDate: '2026-08-05', status: 'completed' },
    ]
    const count = getWeeklyCompletions('h1', '2026-08-06', records)
    expect(count).toBe(1)
  })
})
