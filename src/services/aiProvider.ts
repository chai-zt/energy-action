// ============================================================
// AI Provider 接口 — V0.1 Mock + LocalRule 实现
// 后续可在不变更业务代码的前提下替换为 RemoteAIProvider
// ============================================================

import { priorityProvider } from './priorityProvider'
import { today } from '@/lib/utils'
import { DexieTaskRepository } from '@/storage/repositories'
import type { Task, DailyState, DailyReview } from '@/domain/models'

export interface AIContext {
  page: string
  data?: {
    tasks?: Task[]
    selectedDate?: string
    state?: DailyState | null
    review?: DailyReview | null
    [key: string]: any
  }
}

export interface AIQuickAction {
  id: string
  label: string
  description: string
  icon?: string
  requiresConfirmation?: boolean
  handler?: (ctx: AIContext) => Promise<string> | string
}

export interface AIProvider {
  readonly name: string
  readonly isConfigured: boolean
  readonly quickActions: AIQuickAction[]
  chat(message: string, ctx: AIContext): Promise<string>
  summarizeDay(date: string): Promise<string>
  generateReviewDraft(date: string): Promise<string | null>
  generateDailyPlan(): Promise<string>
}

/**
 * Mock AI Provider — 调用本地数据 + 排序引擎
 * 不伪造对聊，只返回真实数据统计
 */
export class MockAIProvider implements AIProvider {
  readonly name = '本地规则 (Mock)'
  readonly isConfigured = true

  readonly quickActions: AIQuickAction[] = [
    {
      id: 'create-task',
      label: '新建任务',
      description: '在当前页面快速创建任务',
    },
    {
      id: 'plan-today',
      label: '帮我安排今天',
      description: '根据未排期任务和今日精力生成今日建议',
    },
    {
      id: 'top-3',
      label: '今天应该先做什么',
      description: '基于排序引擎推荐今日三个重点',
    },
    {
      id: 'analyze-tasks',
      label: '分析当前任务',
      description: '统计当前页面任务的状态分布',
    },
    {
      id: 'goal-progress',
      label: '查看目标推进',
      description: '查看活跃目标的进度',
    },
    {
      id: 'start-review',
      label: '开始每日复盘',
      description: '跳转到复盘页面',
    },
    {
      id: 'summarize-today',
      label: '总结今天完成情况',
      description: '生成今日工作总结',
    },
    {
      id: 'view-today',
      label: '查看当前日期安排',
      description: '展示今天已排期的任务',
    },
  ]

  async chat(message: string, ctx: AIContext): Promise<string> {
    // 简单关键字匹配
    const m = message.toLowerCase()
    if (m.includes('今天') || m.includes('安排')) {
      return this.generateDailyPlan()
    }
    if (m.includes('复盘') || m.includes('总结')) {
      return '请前往复盘页面（左侧菜单或底部导航）查看或创建今日复盘。'
    }
    if (m.includes('任务') || m.includes('做什么')) {
      return this.summarizeToday(ctx)
    }
    return '我目前是基于本地规则的小助手，未配置远程 AI。\n\n可以尝试：\n- "今天应该先做什么"\n- "帮我安排今天"\n- "查看当前日期安排"\n- "总结今天完成情况"'
  }

  async summarizeDay(date: string): Promise<string> {
    const { db } = await import('@/storage/db')
    const tasks = (await new DexieTaskRepository().getByPlannedDate(date))
      .filter(task => !task.deletedAt)
    const done = tasks.filter(t => t.status === 'done').length
    const total = tasks.length
    if (total === 0) return `${date} 暂无排期任务。`
    return `${date} 共 ${total} 个任务，已完成 ${done}（${Math.round(done / total * 100)}%）。`
  }

  async generateReviewDraft(date: string): Promise<string | null> {
    const { db } = await import('@/storage/db')
    const tasks = (await new DexieTaskRepository().getByPlannedDate(date))
      .filter(task => !task.deletedAt)
    const done = tasks.filter(t => t.status === 'done')
    const undone = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
    if (tasks.length === 0) return null

    let draft = `【${date} 复盘草稿】\n\n## 今天完成\n${done.map(t => `- ${t.title}`).join('\n') || '（无）'}\n\n## 未完成\n${undone.map(t => `- ${t.title}`).join('\n') || '（无）'}\n\n## 自动生成 - 请根据实际情况补充`
    return draft
  }

  async generateDailyPlan(): Promise<string> {
    const { db } = await import('@/storage/db')
    const todayStr = today()
    const allTasks = (await new DexieTaskRepository().getAll())
      .filter(task => !task.deletedAt && task.status !== 'done' && task.status !== 'cancelled')
    const state = await db.dailyStates.where('date').equals(todayStr).first()
    const completions = await db.completionRecords.where('completedDate').equals(todayStr).toArray()

    const result = await priorityProvider.prioritize({
      tasks: allTasks,
      goals: [],
      projects: [],
      dailyState: state || null,
      completionRecords: completions,
    })

    const top = result.results.slice(0, 5)
    if (top.length === 0) return '今日无待办任务，建议先休息或规划明天的任务。'

    return `今日建议（基于本地优先级）：\n\n${top.map((r, i) => `${i + 1}. ${r.score}分 · ${r.level} · ${r.reason}`).join('\n')}\n\n前往首页或任务页查看详情。`
  }

  private async summarizeToday(ctx: AIContext): Promise<string> {
    const tasks = ctx.data?.tasks || []
    const todayTasks = tasks.filter(t => {
      if (t.deletedAt) return false
      const todayStr = today()
      return t.plannedDate === todayStr || t.dueDate === todayStr || t.isHabit
    })
    const done = todayTasks.filter(t => t.status === 'done').length
    return `当前页面任务：${tasks.length}，今日相关：${todayTasks.length}，已完成：${done}`
  }
}

/**
 * 主要使用的 Provider
 * 可在后续版本切换为 RemoteAIProvider
 */
export const aiProvider: AIProvider = new MockAIProvider()
