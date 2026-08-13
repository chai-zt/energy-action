import { describe, it, expect } from 'vitest'
import {
  getMonthGrid, isSameDay, addDays, addMonths,
  formatLongDate, formatMonthTitle, daysBetween,
} from '@/lib/utils'

describe('getMonthGrid', () => {
  it('should return 42 days (6 rows x 7 cols)', () => {
    const grid = getMonthGrid(2026, 7) // August 2026
    expect(grid).toHaveLength(42)
  })

  it('should start on Monday', () => {
    // 2026年8月1日是星期六
    // 紧邻的周一是7月27日
    const grid = getMonthGrid(2026, 7)
    const first = grid[0]
    expect(first.getDay()).toBe(1) // Monday
    expect(first.getDate()).toBe(27)
    expect(first.getMonth()).toBe(6) // July
  })

  it('should include entire target month', () => {
    const grid = getMonthGrid(2026, 7)
    const allAugDays = grid.filter(d => d.getMonth() === 7 && d.getFullYear() === 2026)
    expect(allAugDays).toHaveLength(31)
  })
})

describe('isSameDay', () => {
  it('should return true for same day', () => {
    expect(isSameDay('2026-08-06', '2026-08-06')).toBe(true)
  })

  it('should return false for different days', () => {
    expect(isSameDay('2026-08-06', '2026-08-07')).toBe(false)
  })

  it('should return true for Date objects', () => {
    const a = new Date(2026, 7, 6, 10, 30)
    const b = new Date(2026, 7, 6, 23, 59)
    expect(isSameDay(a, b)).toBe(true)
  })
})

describe('addDays', () => {
  it('should add days correctly', () => {
    const result = addDays('2026-08-06', 3)
    expect(result.toISOString().split('T')[0]).toBe('2026-08-09')
  })

  it('should handle month boundary', () => {
    const result = addDays('2026-08-30', 5)
    expect(result.getMonth()).toBe(8) // September (0-indexed)
  })

  it('should handle negative', () => {
    const result = addDays('2026-08-06', -3)
    expect(result.toISOString().split('T')[0]).toBe('2026-08-03')
  })
})

describe('addMonths', () => {
  it('should add months correctly', () => {
    const d = new Date(2026, 7, 6)
    const result = addMonths(d, 2)
    expect(result.getMonth()).toBe(9) // October
  })

  it('should handle year boundary', () => {
    const d = new Date(2026, 11, 15)
    const result = addMonths(d, 3)
    expect(result.getFullYear()).toBe(2027)
    expect(result.getMonth()).toBe(2) // March
  })
})

describe('formatLongDate', () => {
  it('should format as Chinese long date', () => {
    // 2026-08-06 是星期四
    const result = formatLongDate('2026-08-06')
    expect(result).toBe('8月6日 星期四')
  })

  it('should handle week start correctly', () => {
    // 2026-08-01 是星期六
    const result = formatLongDate('2026-08-01')
    expect(result).toBe('8月1日 星期六')
  })
})

describe('formatMonthTitle', () => {
  it('should format as Chinese year-month', () => {
    const d = new Date(2026, 7, 6)
    expect(formatMonthTitle(d)).toBe('2026年8月')
  })
})

describe('daysBetween', () => {
  it('should count days correctly', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7)
  })
})
