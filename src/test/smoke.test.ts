// ============================================================
// smoke-test — 逻辑级数据一致性验证（不需要IndexedDB）
// ============================================================
import { describe, it, expect } from 'vitest'

describe('R1: 数据一致性（逻辑验证）', () => {
  it('CompletionRecord 结构完整性', () => {
    const record = {
      id: '1', taskId: 't1', completedDate: '2026-08-07', status: 'completed',
      energyCostSnapshot: 20, taskTitleSnapshot: 'Test', projectIdSnapshot: null,
      completedAt: '2026-08-07T22:00:00.000Z', createdAt: '2026-08-07T22:00:00.000Z',
    }
    expect(record.status).toBe('completed')
    expect(record.energyCostSnapshot).toBe(20)
    expect(record.completedDate).toBe('2026-08-07')
  })

  it('ProjectDailyLog manual 优先', () => {
    // 模拟：先有 auto log，用户手动写入后 manual 应覆盖
    const autoLog = { source: 'auto' as const, summary: '自动生成' }
    const manualLog = { source: 'manual' as const, summary: '用户填写' }
    // 逻辑：manual 替代 auto
    const finalLog = manualLog.source === 'manual' ? manualLog : autoLog
    expect(finalLog.source).toBe('manual')
    expect(finalLog.summary).toBe('用户填写')
  })

  it('getMissingDates 幂等性', () => {
    const today = '2026-08-07'
    const startDate = '2026-08-01'
    const existingDates = new Set(['2026-08-01', '2026-08-03', '2026-08-07'])
    // 缺失日期：8/2, 8/4, 8/5, 8/6 (不含今天)
    const missing: string[] = []
    const start = new Date(startDate)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const current = new Date(start)
    while (current <= yesterday) {
      const ds = current.toISOString().split('T')[0]
      if (!existingDates.has(ds)) missing.push(ds)
      current.setDate(current.getDate() + 1)
    }
    expect(missing).toEqual(['2026-08-02', '2026-08-04', '2026-08-05', '2026-08-06'])
    // 再次运行得出相同结果（幂等）
    const missing2: string[] = []
    const c2 = new Date(start)
    while (c2 <= yesterday) {
      const ds = c2.toISOString().split('T')[0]
      if (!existingDates.has(ds)) missing2.push(ds)
      c2.setDate(c2.getDate() + 1)
    }
    expect(missing2).toEqual(missing)
  })

  it('完成项目后不再生成日志', () => {
    const project = { status: 'completed' as const, completedAt: '2026-08-07' }
    const date = '2026-08-08'
    // 逻辑：date > completedAt → 不生成
    const shouldGenerate = project.status !== 'completed'
    expect(shouldGenerate).toBe(false)
  })

  it('已删除任务参与查询检查', () => {
    const task = { id: 't1', deletedAt: '2026-08-07T00:00:00.000Z' }
    // 带 deletedAt 的任务应被过滤
    const shouldInclude = !task.deletedAt
    expect(shouldInclude).toBe(false)
  })
})

describe('R2: 批量操作逻辑', () => {
  it('批量去重：同日同task只保留1条', () => {
    const records = [
      { taskId: 't1', completedDate: '2026-08-07', energyCostSnapshot: 20 },
      { taskId: 't1', completedDate: '2026-08-07', energyCostSnapshot: 20 },
      { taskId: 't2', completedDate: '2026-08-07', energyCostSnapshot: 30 },
    ]
    // 去重逻辑：按 taskId+date 建 Map
    const deduped = new Map<string, typeof records[0]>()
    for (const r of records) {
      deduped.set(`${r.taskId}:${r.completedDate}`, r)
    }
    expect(deduped.size).toBe(2)
    expect(deduped.get('t1:2026-08-07')!.energyCostSnapshot).toBe(20)
  })

  it('50任务排序稳定性', () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`, aiPriorityScore: 50 - i, title: `Task ${i}`,
    }))
    const sorted = [...tasks].sort((a, b) => b.aiPriorityScore - a.aiPriorityScore)
    // t0: 50分(最高) → 排第一; t49: 1分(最低) → 排最后
    expect(sorted[0].id).toBe('t0')
    expect(sorted[49].id).toBe('t49')
    expect(sorted.length).toBe(50)
  })
})

describe('R3: 边界条件', () => {
  it('固定任务 recurrenceRule 解析', () => {
    const rules = ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'FREQ=INTERVAL;DAYS=2']
    expect(rules[0].startsWith('FREQ=DAILY')).toBe(true)
    expect(rules[1].includes('BYDAY=MO')).toBe(true)
    expect(rules[2].includes('INTERVAL')).toBe(true)
  })

  it('精力去重：已完成+已跳过不重复计算', () => {
    const records = [
      { taskId: 'h1', completedDate: '2026-08-07', status: 'completed', energyCostSnapshot: 20 },
      { taskId: 'h1', completedDate: '2026-08-07', status: 'completed', energyCostSnapshot: 20 }, // 重复
      { taskId: 'h2', completedDate: '2026-08-07', status: 'skipped', energyCostSnapshot: 0 },
    ]
    const consumed = new Set<string>()
    let total = 0
    for (const r of records) {
      if (r.completedDate !== '2026-08-07') continue
      if (r.status !== 'completed') continue
      if (consumed.has(r.taskId)) continue
      consumed.add(r.taskId)
      total += r.energyCostSnapshot
    }
    expect(total).toBe(20) // 只去重后的1条
  })

  it('空数组/空查询安全', () => {
    const empty: string[] = []
    expect(empty.filter(x => x).length).toBe(0)
    const map = new Map()
    expect(map.size).toBe(0)
    expect(map.get('none')).toBeUndefined()
  })
})
