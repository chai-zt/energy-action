import { describe, expect, it } from 'vitest'
import type { CompletionRecord, Task } from '@/domain/models'
import { getTodayExecutionSections, isTaskCompletedOnDate } from '@/modules/dashboard/DashboardPage'

const date = '2026-08-16'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    projectId: null,
    goalId: null,
    keyResultId: null,
    columnId: null,
    parentTaskId: null,
    taskKind: 'small',
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
    order: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function completion(taskId: string): CompletionRecord {
  return {
    id: `completion-${taskId}`,
    taskId,
    completedDate: date,
    completedAt: `${date}T08:00:00.000Z`,
    status: 'completed',
    energyCostSnapshot: 5,
    rewardPoints: 1,
    taskTitleSnapshot: taskId,
    projectIdSnapshot: null,
    createdAt: `${date}T08:00:00.000Z`,
  }
}

describe('dashboard today execution sections', () => {
  it('持续展示已经开始但未完成的大任务，并只展示当天应执行的习惯', () => {
    const tasks = [
      task('today-large', { taskKind: 'large', plannedDate: date }),
      task('ongoing-large', { taskKind: 'large', plannedDate: '2026-08-15' }),
      task('future-large', { taskKind: 'large', plannedDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' }),
      task('today-small', { taskKind: 'small', plannedDate: date }),
      task('daily-habit', { isHabit: true, recurrenceRule: 'FREQ=DAILY' }),
    ]

    const sections = getTodayExecutionSections(tasks, [], date)

    expect(sections.largeTasks.map(item => item.id)).toEqual(['today-large', 'ongoing-large'])
    expect(sections.habitTasks.map(item => item.id)).toEqual(['daily-habit'])
  })

  it('今天完成的项目继续显示，并排在未完成项之后', () => {
    const tasks = [
      task('done-large', { taskKind: 'large', status: 'done', completedAt: `${date}T09:00:00.000Z` }),
      task('open-large', { taskKind: 'large', plannedDate: date }),
      task('daily-habit', { isHabit: true, recurrenceRule: 'FREQ=DAILY' }),
    ]
    const records = [completion('daily-habit')]

    const sections = getTodayExecutionSections(tasks, records, date)

    expect(sections.largeTasks.map(item => item.id)).toEqual(['open-large', 'done-large'])
    expect(isTaskCompletedOnDate(sections.habitTasks[0], records, date)).toBe(true)
  })

  it('以前完成的大任务不再显示', () => {
    const sections = getTodayExecutionSections([
      task('done-before', { taskKind: 'large', status: 'done', completedAt: '2026-08-15T09:00:00.000Z' }),
    ], [], date)

    expect(sections.largeTasks).toEqual([])
  })
})
