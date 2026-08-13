import { describe, it, expect, beforeEach, vi } from 'vitest'
import { calcHabitStats } from '@/modules/dashboard/DashboardPage'
import type { CompletionRecord } from '@/domain/models'
import { today } from '@/lib/utils'

function makeRecord(taskId: string, date: string): CompletionRecord {
  return {
    id: crypto.randomUUID(),
    taskId,
    completedDate: date,
    completedAt: `${date}T22:00:00.000Z`,
    status: 'completed' as const,
    energyCostSnapshot: 20,
    taskTitleSnapshot: 'Test',
    projectIdSnapshot: null,
    createdAt: `${date}T22:00:00.000Z`,
  }
}

function localDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('calcHabitStats', () => {
  it('should return zeros for empty records', () => {
    const stats = calcHabitStats('habit-1', [])
    expect(stats.streak).toBe(0)
    expect(stats.total).toBe(0)
    expect(stats.longest).toBe(0)
    expect(stats.weekRate).toBe(0)
    expect(stats.monthRate).toBe(0)
    expect(stats.lastBreak).toBeNull()
  })

  it('should count total completions', () => {
    const records = [
      makeRecord('habit-1', '2026-08-01'),
      makeRecord('habit-1', '2026-08-03'),
      makeRecord('habit-1', '2026-08-05'),
    ]
    const stats = calcHabitStats('habit-1', records)
    expect(stats.total).toBe(3)
  })

  it('should detect consecutive streak ending today', () => {
    const currentDay = today()
    const yesterday = localDateOffset(-1)
    const d2 = localDateOffset(-2)

    const records = [
      makeRecord('habit-1', d2),
      makeRecord('habit-1', yesterday),
      makeRecord('habit-1', currentDay),
    ]
    const stats = calcHabitStats('habit-1', records)
    expect(stats.streak).toBeGreaterThanOrEqual(2)
  })

  it('should find longest streak', () => {
    const records = [
      makeRecord('habit-1', '2026-07-01'),
      makeRecord('habit-1', '2026-07-02'),
      makeRecord('habit-1', '2026-07-03'),
      // gap
      makeRecord('habit-1', '2026-07-10'),
      makeRecord('habit-1', '2026-07-11'),
    ]
    const stats = calcHabitStats('habit-1', records)
    expect(stats.longest).toBe(3)
  })

  it('should calculate week and month rates', () => {
    const records = [
      makeRecord('habit-1', '2026-08-01'),
      makeRecord('habit-1', '2026-08-02'),
      makeRecord('habit-1', '2026-08-03'),
    ]
    const stats = calcHabitStats('habit-1', records)
    expect(stats.weekRate).toBeGreaterThanOrEqual(0)
    expect(stats.weekRate).toBeLessThanOrEqual(100)
    expect(stats.monthRate).toBeGreaterThanOrEqual(0)
    expect(stats.monthRate).toBeLessThanOrEqual(100)
  })

  it('should find last completion date when streak is broken', () => {
    const d4 = new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0]
    const records = [makeRecord('habit-1', d4)]
    const stats = calcHabitStats('habit-1', records)
    expect(stats.streak).toBe(0)
    expect(stats.lastBreak).toBe(d4)
  })
})
