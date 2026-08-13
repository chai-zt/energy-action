// ============================================================
// 本地规则优先级排序器 V0.1
// ============================================================

import type {
  PrioritizeTasksInput, PrioritizeTasksOutput,
  AIPriorityResult, PriorityLevel, Confidence, UUID,
} from '@/domain/models'
import { generateId, today, now } from '@/lib/utils'

/**
 * PriorityProvider 接口
 * V0.1: LocalRulePriorityProvider
 * 后续: RemoteAIPriorityProvider
 */
export interface PriorityProvider {
  prioritize(input: PrioritizeTasksInput): Promise<PrioritizeTasksOutput>
}

/**
 * 本地规则排序器
 *
 * 排序因子（按权重）：
 * 1. 是否逾期（+40）
 * 2. 截止日期紧迫度（+30）
 * 3. 用户显式优先级（+20）
 * 4. 是否为习惯且今日未完成（+15）
 * 5. 认知负荷匹配当前精力（+10）
 * 6. 预计时长适合当前可用时间（+5）
 * 7. 创建时间（越早越优先，+5）
 *
 * 降级策略：无网络时自动使用此 Provider
 */
export class LocalRulePriorityProvider implements PriorityProvider {
  async prioritize(input: PrioritizeTasksInput): Promise<PrioritizeTasksOutput> {
    const { tasks, goals, projects, dailyState, completionRecords } = input
    const todayStr = today()
    const nowStr = now()
    const results: AIPriorityResult[] = []

    // 只排序未完成、未取消的任务
    const activeTasks = tasks.filter(
      t => t.status !== 'done' && t.status !== 'cancelled' && !t.deletedAt
    )

    for (const task of activeTasks) {
      let score = 0
      const reasons: string[] = []

      // 1. 逾期检测 (+40)
      if (task.dueDate && task.dueDate < todayStr) {
        const daysOverdue = Math.floor(
          (new Date(todayStr).getTime() - new Date(task.dueDate).getTime()) / 86400000
        )
        score += 40
        reasons.push(`已逾期 ${daysOverdue} 天`)
      }

      // 2. 截止日期紧迫度 (+30 max)
      if (task.dueDate) {
        const daysUntilDue = Math.floor(
          (new Date(task.dueDate).getTime() - new Date(todayStr).getTime()) / 86400000
        )
        if (daysUntilDue <= 0) {
          score += 30 // 今天到期或已过期
          reasons.push('今天截止')
        } else if (daysUntilDue <= 1) {
          score += 25
          reasons.push('明天截止')
        } else if (daysUntilDue <= 3) {
          score += 15
          reasons.push(`${daysUntilDue} 天后截止`)
        } else if (daysUntilDue <= 7) {
          score += 8
          reasons.push(`本周截止`)
        }
      }

      // 3. 用户显式优先级 (+20 max)
      if (task.userPriority) {
        // userPriority 越低越紧急（1=最高）
        const priorityScore = Math.max(0, 20 - (task.userPriority - 1) * 7)
        score += priorityScore
        if (task.userPriority === 1) reasons.push('用户标记为最高优先级')
        else if (task.userPriority === 2) reasons.push('用户标记为高优先级')
      }

      // 4. 关联目标和项目 (+10)
      if (task.goalId || task.projectId) {
        const project = task.projectId ? projects.find(p => p.id === task.projectId) : null
        const goal = task.goalId ? goals.find(g => g.id === task.goalId) : null
        if (project && project.status === 'blocked') {
          score += 10
          reasons.push('关联项目被阻塞')
        } else if (project && project.status === 'active') {
          score += 8
          reasons.push('关联活跃项目')
        } else if (goal && goal.status === 'active') {
          score += 5
          reasons.push('关联活跃目标')
        }
      }

      // 5. 习惯任务未完成 (+15)
      if (task.isHabit) {
        const todayRecords = completionRecords.filter(r =>
          r.taskId === task.id && r.completedDate === todayStr
        )
        if (todayRecords.length === 0) {
          // 计算连续天数
          const allRecords = completionRecords
            .filter(r => r.taskId === task.id)
            .sort((a, b) => b.completedDate.localeCompare(a.completedDate))

          let streak = 0
          const dates = allRecords.map(r => r.completedDate)
          // 检查从昨天开始的连续
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          const yesterdayStr = yesterday.toISOString().split('T')[0]

          if (dates.includes(yesterdayStr)) {
            streak = 2
            reasons.push(`习惯已连续 ${streak} 天，建议保持`)
            score += 15
          } else {
            score += 8
            reasons.push('今日习惯尚未完成')
          }
        }
      }

      // 6. 认知负荷与精力匹配 (+10 max)
      if (dailyState) {
        const energy = dailyState.energyScore
        if (task.cognitiveLoad === 'high' && energy >= 7) {
          score += 10
          reasons.push('精力充沛，适合高认知任务')
        } else if (task.cognitiveLoad === 'high' && energy < 4) {
          score -= 5
          reasons.push('精力较低，高认知任务建议延后')
        } else if (task.cognitiveLoad === 'low' && energy < 5) {
          score += 5
          reasons.push('当前精力适合低认知任务')
        }
      }

      // 7. 预计时长合理 (+5)
      if (task.estimatedMinutes > 0 && dailyState?.availableMinutes) {
        if (task.estimatedMinutes <= dailyState.availableMinutes) {
          score += 5
        } else {
          score -= 3
          reasons.push('预计时长超过可用时间')
        }
      }

      // 8. 创建时间（越早的 +2，有一定基础分）
      score += 2

      // 确定优先级等级
      const level = this.scoreToLevel(score)

      // 置信度：本地规则始终为 medium
      const confidence: Confidence = 'medium'

      results.push({
        id: generateId(),
        taskId: task.id,
        score: Math.min(100, Math.max(0, score)),
        level,
        reason: reasons.length > 0 ? reasons.join('；') : '无特殊优先级信息',
        confidence,
        generatedAt: nowStr,
      })
    }

    // 按分数降序排列
    results.sort((a, b) => b.score - a.score)

    return { results }
  }

  private scoreToLevel(score: number): PriorityLevel {
    if (score >= 60) return 'P0'
    if (score >= 40) return 'P1'
    if (score >= 20) return 'P2'
    return 'P3'
  }
}

// 单例
export const priorityProvider: PriorityProvider = new LocalRulePriorityProvider()
