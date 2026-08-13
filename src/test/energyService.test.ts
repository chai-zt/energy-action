import { describe, it, expect } from 'vitest'
import { ENERGY_MAP, getEnergyCost, calcPlannedEnergy, calcConsumedEnergy, calcRemainingEnergy, calcFixedTaskPlannedEnergy, calcOrdinaryTaskPlannedEnergy, ENERGY_BUDGET } from '@/services/energyService'
import type { Task, CompletionRecord } from '@/domain/models'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Test',
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
    plannedDate: '2026-08-07',
    estimatedMinutes: 30,
    actualMinutes: 0,
    cognitiveLoad: 'medium',
    energyDemand: 3,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('ENERGY_MAP', () => {
  it('should map correctly', () => {
    expect(ENERGY_MAP[1]).toBe(3)
    expect(ENERGY_MAP[3]).toBe(10)
    expect(ENERGY_MAP[5]).toBe(30)
  })
})

describe('getEnergyCost', () => {
  it('should return correct cost', () => {
    expect(getEnergyCost({ energyDemand: 3 })).toBe(10)
    expect(getEnergyCost({ energyDemand: 99 as any })).toBe(10)
  })
})

describe('calcConsumedEnergy', () => {
  it('should deduplicate by taskId', () => {
    const records = [
      { completedDate: '2026-08-07', energyCostSnapshot: 20, status: 'completed' as const, taskId: 't1' },
      { completedDate: '2026-08-07', energyCostSnapshot: 20, status: 'completed' as const, taskId: 't1' }, // duplicate
      { completedDate: '2026-08-07', energyCostSnapshot: 10, status: 'skipped' as const, taskId: 't2' },
      { completedDate: '2026-08-06', energyCostSnapshot: 30, status: 'completed' as const, taskId: 't3' },
    ]
    expect(calcConsumedEnergy(records, '2026-08-07')).toBe(20) // only t1, deduped; t2 skipped; t3 wrong date
  })

  it('should only count completed records', () => {
    const records = [
      { completedDate: '2026-08-07', energyCostSnapshot: 40, status: 'skipped' as const, taskId: 't1' },
      { completedDate: '2026-08-07', energyCostSnapshot: 40, status: 'completed' as const, taskId: 't2' },
    ]
    expect(calcConsumedEnergy(records, '2026-08-07')).toBe(40)
  })
})

describe('calcFixedTaskPlannedEnergy', () => {
  it('should count habit tasks that should execute today', () => {
    const tasks = [
      makeTask({ id: 'h1', isHabit: true, recurrenceRule: 'FREQ=DAILY', energyDemand: 1 }),     // 3
      makeTask({ id: 'h2', isHabit: true, recurrenceRule: 'FREQ=DAILY', energyDemand: 1 }),     // 3
      makeTask({ id: 'h3', isHabit: true, recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO', energyDemand: 1 }), // 3, but 8/7 is Friday
    ]
    // 2026-08-07 is Friday
    const result = calcFixedTaskPlannedEnergy(tasks, [], '2026-08-07')
    expect(result).toBe(6) // h1(3) + h2(3), h3 excluded (not Monday)
  })

  it('should not count already completed habits', () => {
    const tasks = [
      makeTask({ id: 'h1', isHabit: true, recurrenceRule: 'FREQ=DAILY', energyDemand: 1 }),
    ]
    const completions = [{ taskId: 'h1', completedDate: '2026-08-07', status: 'completed' as const }]
    const result = calcFixedTaskPlannedEnergy(tasks, completions, '2026-08-07')
    expect(result).toBe(0)
  })
})

describe('calcRemainingEnergy', () => {
  it('should return full budget when nothing planned', () => {
    const result = calcRemainingEnergy([], [], '2026-08-07')
    expect(result.budget).toBe(100)
    expect(result.planned).toBe(0)
    expect(result.consumed).toBe(0)
    expect(result.remaining).toBe(100)
    expect(result.available).toBe(100)
  })
})
