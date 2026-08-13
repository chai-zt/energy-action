import { describe, it, expect } from 'vitest'
import { LocalRulePriorityProvider } from '@/services/priorityProvider'
import type { Task, Goal, Project, DailyState, CompletionRecord } from '@/domain/models'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Test Task',
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
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

describe('LocalRulePriorityProvider', () => {
  const provider = new LocalRulePriorityProvider()

  it('should return empty results for empty tasks', async () => {
    const result = await provider.prioritize({
      tasks: [],
      goals: [],
      projects: [],
      dailyState: null,
      completionRecords: [],
    })
    expect(result.results).toHaveLength(0)
  })

  it('should assign scores to all active tasks', async () => {
    const tasks = [makeTask(), makeTask(), makeTask()]
    const result = await provider.prioritize({
      tasks,
      goals: [],
      projects: [],
      dailyState: null,
      completionRecords: [],
    })
    expect(result.results).toHaveLength(3)
    result.results.forEach(r => {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      expect(['P0', 'P1', 'P2', 'P3']).toContain(r.level)
      expect(r.reason).toBeTruthy()
      expect(r.generatedAt).toBeTruthy()
    })
  })

  it('should rank overdue tasks higher', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const tasks = [
      makeTask({ id: '1', title: 'Overdue', dueDate: yesterdayStr }),
      makeTask({ id: '2', title: 'Future', dueDate: '2026-12-31' }),
    ]
    const result = await provider.prioritize({
      tasks, goals: [], projects: [], dailyState: null, completionRecords: [],
    })
    const overdueResult = result.results.find(r => r.taskId === '1')!
    const futureResult = result.results.find(r => r.taskId === '2')!

    expect(overdueResult.score).toBeGreaterThan(futureResult.score)
    expect(overdueResult.level === 'P0' || overdueResult.level === 'P1').toBe(true)
  })

  it('should prioritize tasks with user priority', async () => {
    const tasks = [
      makeTask({ id: '1', userPriority: 1, title: 'High Priority' }),
      makeTask({ id: '2', userPriority: 5, title: 'Low Priority' }),
    ]
    const result = await provider.prioritize({
      tasks, goals: [], projects: [], dailyState: null, completionRecords: [],
    })
    const highP = result.results.find(r => r.taskId === '1')!
    const lowP = result.results.find(r => r.taskId === '2')!
    expect(highP.score).toBeGreaterThan(lowP.score)
  })

  it('should boost habit tasks that need to be completed today', async () => {
    const tasks = [
      makeTask({ id: '1', isHabit: true, title: 'Morning Routine' }),
    ]
    const result = await provider.prioritize({
      tasks, goals: [], projects: [], dailyState: null, completionRecords: [],
    })
    expect(result.results[0].score).toBeGreaterThan(0)
  })

  it('should produce stable results for same input', async () => {
    const tasks = [
      makeTask({ id: '1', title: 'A', dueDate: '2026-08-10' }),
      makeTask({ id: '2', title: 'B', dueDate: '2026-08-15' }),
    ]
    const r1 = await provider.prioritize({
      tasks, goals: [], projects: [], dailyState: null, completionRecords: [],
    })
    const r2 = await provider.prioritize({
      tasks, goals: [], projects: [], dailyState: null, completionRecords: [],
    })
    expect(r1.results.map(r => r.taskId)).toEqual(r2.results.map(r => r.taskId))
  })

  it('should consider blocked projects higher risk', async () => {
    const projectId = crypto.randomUUID()
    const tasks = [
      makeTask({ id: '1', projectId, title: 'Blocked Project Task' }),
      makeTask({ id: '2', title: 'No Project' }),
    ]
    const projects: Project[] = [{
      id: projectId, name: 'Blocked', description: '', goalId: null, keyResultId: null,
      status: 'blocked', priority: 1, startDate: null, dueDate: null,
      progress: 0, progressMode: 'task', color: '#f00', icon: 'alert', completedAt: null,
      createdAt: '', updatedAt: '', deletedAt: null,
    }]
    const result = await provider.prioritize({
      tasks, goals: [], projects, dailyState: null, completionRecords: [],
    })
    const blockedResult = result.results.find(r => r.taskId === '1')!
    const noProjectResult = result.results.find(r => r.taskId === '2')!
    expect(blockedResult.score).toBeGreaterThan(noProjectResult.score)
  })
})
