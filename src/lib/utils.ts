import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function now(): string {
  return new Date().toISOString()
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a)
  const db = new Date(b)
  return Math.floor((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24))
}

/** 获取指定年月的所有日期格子（6行 x 7列），从周一开始 */
export function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  const dayOfWeek = firstDay.getDay() // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const startDate = new Date(year, month, 1 + mondayOffset)
  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    days.push(d)
  }
  return days
}

/** 判断两个日期是否同一天 */
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = typeof a === 'string' ? new Date(a) : a
  const db = typeof b === 'string' ? new Date(b) : b
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
}

/** 日期加减天数 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** 月份加减 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/** 格式化中文长日期：8月6日 星期四 */
export function formatLongDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`
}

/** 格式化月份标题：2026年8月 */
export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}
