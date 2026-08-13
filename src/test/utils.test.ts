import { describe, it, expect } from 'vitest'
import { generateId, today, now, formatDate, daysBetween, cn } from '@/lib/utils'

describe('utils', () => {
  describe('generateId', () => {
    it('should return a non-empty string', () => {
      const id = generateId()
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
    })

    it('should return unique values', () => {
      const id1 = generateId()
      const id2 = generateId()
      expect(id1).not.toBe(id2)
    })

    it('should be UUID format', () => {
      const id = generateId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })

  describe('today', () => {
    it('should return YYYY-MM-DD format', () => {
      const d = today()
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should match current date', () => {
      const d = today()
      const now = new Date()
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      expect(d).toBe(expected)
    })
  })

  describe('now', () => {
    it('should return ISO 8601 format', () => {
      const n = now()
      expect(n).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('formatDate', () => {
    it('should format date in Chinese locale', () => {
      const result = formatDate('2026-08-06')
      expect(result).toContain('2026')
      expect(result).toContain('08')
    })
  })

  describe('daysBetween', () => {
    it('should return positive number when second date is later', () => {
      const diff = daysBetween('2026-01-01', '2026-01-05')
      expect(diff).toBe(4)
    })

    it('should return negative number when second date is earlier', () => {
      const diff = daysBetween('2026-01-05', '2026-01-01')
      expect(diff).toBe(-4)
    })

    it('should return 0 for same date', () => {
      expect(daysBetween('2026-08-06', '2026-08-06')).toBe(0)
    })
  })

  describe('cn', () => {
    it('should merge class names', () => {
      const result = cn('text-sm', 'font-bold')
      expect(result).toBe('text-sm font-bold')
    })

    it('should handle conditional classes', () => {
      const result = cn('base', false && 'hidden', 'visible')
      expect(result).toContain('base')
      expect(result).toContain('visible')
      expect(result).not.toContain('hidden')
    })
  })
})
