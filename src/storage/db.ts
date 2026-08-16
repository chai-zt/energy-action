// ============================================================
// Dexie 数据库配置 — Energy Action
// ============================================================

import Dexie, { type Table } from 'dexie'
import type {
  Goal, KeyResult, Project, ProjectColumn, Task, Tag, TaskTag,
  TaskSchedule, CompletionRecord, TimeRecord, PomodoroSession,
  DailyState, DailyReview, WeeklyReview, MonthlyReview,
  LifeDomainScore, AIPriorityResult, ApprovalRequest,
  Notification, AppSettings, ProjectDailyLog, GoalProgressLog,
  ExecutionStep, MinimumAction,
} from '@/domain/models'

const V1_STORES = {
  goals: 'id, level, parentGoalId, status, domain, dueDate, deletedAt',
  keyResults: 'id, goalId, status, dueDate, deletedAt',
  projects: 'id, goalId, keyResultId, status, deletedAt',
  projectColumns: 'id, projectId',
  tasks: 'id, projectId, goalId, status, dueDate, plannedDate, isHabit, deletedAt, parentTaskId, [projectId+status]',
  tags: 'id',
  taskTags: '[taskId+tagId], taskId, tagId',
  taskSchedules: 'id, taskId, plannedDate',
  completionRecords: 'id, taskId, completedDate',
  timeRecords: 'id, taskId, projectId, startAt, deletedAt',
  pomodoroSessions: 'id, taskId, startAt',
  dailyStates: 'id, date',
  dailyReviews: 'id, date',
  weeklyReviews: 'id, weekStart',
  monthlyReviews: 'id, [year+month]',
  lifeDomainScores: 'id, date, domain',
  aiPriorityResults: 'id, taskId',
  approvalRequests: 'id, status',
  notifications: 'id, type, isRead, createdAt',
  appSettings: 'id',
  projectDailyLogs: 'id, projectId, date, [projectId+date]',
  goalProgressLogs: 'id, goalId, date',
}

export class PersonalAIOSDB extends Dexie {
  goals!: Table<Goal, string>
  keyResults!: Table<KeyResult, string>
  projects!: Table<Project, string>
  projectColumns!: Table<ProjectColumn, string>
  tasks!: Table<Task, string>
  tags!: Table<Tag, string>
  taskTags!: Table<TaskTag, string>
  taskSchedules!: Table<TaskSchedule, string>
  completionRecords!: Table<CompletionRecord, string>
  timeRecords!: Table<TimeRecord, string>
  pomodoroSessions!: Table<PomodoroSession, string>
  dailyStates!: Table<DailyState, string>
  dailyReviews!: Table<DailyReview, string>
  weeklyReviews!: Table<WeeklyReview, string>
  monthlyReviews!: Table<MonthlyReview, string>
  lifeDomainScores!: Table<LifeDomainScore, string>
  aiPriorityResults!: Table<AIPriorityResult, string>
  approvalRequests!: Table<ApprovalRequest, string>
  notifications!: Table<Notification, string>
  appSettings!: Table<AppSettings, string>
  projectDailyLogs!: Table<ProjectDailyLog, string>
  goalProgressLogs!: Table<GoalProgressLog, string>
  executionSteps!: Table<ExecutionStep, string>
  minimumActions!: Table<MinimumAction, string>

  constructor() {
    super('PersonalAIOS')

    // v1 — 原始完整 schema
    this.version(1).stores(V1_STORES)

    // v2, v3 — 被误写为 null 的损坏版本（仅声明占位，保持版本连续性）
    this.version(2).stores({})
    this.version(3).stores({})

    // v4 — 修复：重建所有表（v2/v3 的 null 删除了它们）
    this.version(4).stores({
      // 列出所有表，确保 v4 拥有完整 schema
      goals: V1_STORES.goals,
      keyResults: V1_STORES.keyResults,
      projects: V1_STORES.projects,
      projectColumns: V1_STORES.projectColumns,
      tasks: V1_STORES.tasks,
      tags: V1_STORES.tags,
      taskTags: V1_STORES.taskTags,
      taskSchedules: V1_STORES.taskSchedules,
      completionRecords: V1_STORES.completionRecords,
      timeRecords: V1_STORES.timeRecords,
      pomodoroSessions: V1_STORES.pomodoroSessions,
      dailyStates: V1_STORES.dailyStates,
      dailyReviews: V1_STORES.dailyReviews,
      weeklyReviews: V1_STORES.weeklyReviews,
      monthlyReviews: V1_STORES.monthlyReviews,
      lifeDomainScores: V1_STORES.lifeDomainScores,
      aiPriorityResults: V1_STORES.aiPriorityResults,
      approvalRequests: V1_STORES.approvalRequests,
      notifications: V1_STORES.notifications,
      appSettings: V1_STORES.appSettings,
      projectDailyLogs: V1_STORES.projectDailyLogs,
      goalProgressLogs: V1_STORES.goalProgressLogs,
      executionSteps: 'id, taskId',
      minimumActions: 'id, taskId',
    })
  }
}

export const db = new PersonalAIOSDB()
