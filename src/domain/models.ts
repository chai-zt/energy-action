// ============================================================
// 领域模型类型定义
// Personal AI OS — Domain Models
// ============================================================

import type { Task, TaskStatus } from './task'

// --- 基础类型 ---
export type UUID = string
export type ISODate = string       // YYYY-MM-DD
export type ISODateTime = string   // ISO 8601

export type GoalLevel = 'yearly' | 'quarterly'
export type GoalStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived'
export type GoalProgressMode = 'manual' | 'key_result' | 'task'
export type LifeDomain = 'health' | 'work' | 'play' | 'love' | 'growth' | 'finance' | 'relations' | 'any'

export const DOMAIN_OPTIONS = [
  { key: 'work', label: '工作', sub: '找工作 / 升职 / 创业 / 提升工作效率' },
  { key: 'growth', label: '成长', sub: '学习 / 考试 / 阅读 / 掌握新技能' },
  { key: 'health', label: '健康', sub: '运动 / 睡眠 / 饮食 / 身体管理' },
  { key: 'finance', label: '财务', sub: '存钱 / 增加收入 / 副业 / 财务规划' },
  { key: 'relations', label: '爱与关系', sub: '恋爱 / 家庭 / 朋友 / 改善关系' },
  { key: 'play', label: '娱乐', sub: '旅行 / 兴趣 / 游戏 / 体验新事物' },
  { key: 'any', label: '不限', sub: '跨多个领域 / 暂时不想分类' },
] as const

export const CYCLE_OPTIONS = [
  { key: '1m', label: '1个月', months: 1 },
  { key: '3m', label: '3个月', months: 3 },
  { key: '6m', label: '6个月', months: 6 },
  { key: '1y', label: '1年', months: 12 },
  { key: 'custom', label: '自定义', months: 0 },
] as const

export type ProjectStatus = 'backlog' | 'planned' | 'active' | 'blocked' | 'completed' | 'archived'
export type ProjectProgressMode = 'manual' | 'task'

export type CognitiveLoad = 'low' | 'medium' | 'high'
export type EnergyDemand = 1 | 2 | 3 | 4 | 5

export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3'
export type Confidence = 'low' | 'medium' | 'high'

export type ScheduleSource = 'manual_drag' | 'ai_suggestion' | 'quick_add'
export type ScheduleStatus = 'planned' | 'started' | 'completed' | 'skipped'

export type TimeRecordSource = 'timer' | 'pomodoro' | 'manual'

export type PomodoroType = 'work' | 'short_break' | 'long_break'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

// --- Task 核心实体（统一领域模型，定义于 src/domain/task） ---
export type { Task, TaskStatus, ExecutionStep, StepStatus, MinimumAction, DecompositionResult, GoalRelation } from './task'

export interface Goal {
  id: UUID
  title: string
  description: string
  level: GoalLevel
  parentGoalId: UUID | null
  startDate: ISODate
  dueDate: ISODate
  status: GoalStatus
  progressMode: GoalProgressMode
  manualProgress: number
  domain: LifeDomain | null
  sortOrder: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deletedAt: ISODateTime | null
}

export interface KeyResult {
  id: UUID
  goalId: UUID
  title: string
  description: string
  metricType: 'number' | 'percentage' | 'boolean'
  startValue: number
  currentValue: number
  targetValue: number
  dueDate: ISODate
  status: GoalStatus
  weight: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deletedAt: ISODateTime | null
}

export interface Project {
  id: UUID
  name: string
  description: string
  goalId: UUID | null
  keyResultId: UUID | null
  status: ProjectStatus
  priority: number
  startDate: ISODate | null
  dueDate: ISODate | null
  progress: number
  progressMode: ProjectProgressMode
  color: string
  icon: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deletedAt: ISODateTime | null
  completedAt: ISODate | null  // 第六轮新增：项目完成日期
}

// 第六轮新增：项目每日进展记录
export interface ProjectDailyLog {
  id: UUID
  projectId: UUID
  date: ISODate
  source: 'manual' | 'auto'
  summary: string
  tasksCompleted: number         // 当天完成关联任务数
  tasksCreated: number           // 当天新增关联任务数
  focusMinutes: number           // 当天关联专注分钟数
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// 目标进展记录 (第3步新增)
export interface GoalProgressLog {
  id: UUID
  goalId: UUID
  content: string
  date: ISODate
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface ProjectColumn {
  id: UUID
  projectId: UUID
  name: string
  order: number
  color: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface Tag {
  id: UUID
  name: string
  color: string
  createdAt: ISODateTime
}

export interface TaskTag {
  taskId: UUID
  tagId: UUID
}

export interface TaskSchedule {
  id: UUID
  taskId: UUID
  plannedDate: ISODate
  startAt: string  // HH:mm
  endAt: string    // HH:mm
  source: ScheduleSource
  status: ScheduleStatus
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface CompletionRecord {
  id: UUID
  taskId: UUID
  completedDate: ISODate
  completedAt: ISODateTime
  status: 'completed' | 'skipped'   // 第六轮新增
  energyCostSnapshot: number         // 第六轮新增: 完成扣点(5/10/20/30/40), 跳过=0
  taskTitleSnapshot: string          // 第六轮新增: 完成时任务名称快照
  projectIdSnapshot: UUID | null     // 第六轮新增
  createdAt: ISODateTime
}

export interface TimeRecord {
  id: UUID
  taskId: UUID | null
  projectId: UUID | null
  startAt: ISODateTime
  endAt: ISODateTime | null
  durationMinutes: number
  source: TimeRecordSource
  note: string
  focusScore: number | null
  interruptionCount: number
  createdAt: ISODateTime
  deletedAt: ISODateTime | null
}

export interface PomodoroSession {
  id: UUID
  taskId: UUID | null
  startAt: ISODateTime
  endAt: ISODateTime | null
  durationMinutes: number
  type: PomodoroType
  completed: boolean
  createdAt: ISODateTime
}

export interface DailyState {
  id: UUID
  date: ISODate
  energyScore: number
  moodScore: number
  stressScore: number
  sleepHours: number | null
  sleepQuality: number | null
  availableMinutes: number | null
  note: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface DailyReview {
  id: UUID
  date: ISODate
  completed: string      // 今天完成了什么
  uncompleted: string    // 哪些任务没有完成（旧版文本，只读兼容）
  uncompletedReason: string
  biggestGain: string    // 今天最大的收获
  mostDraining: string   // 最消耗精力的事情
  tomorrowTop3: string   // 明天最重要的三件事
  knowledgeToSave: string // 值得沉淀的知识
  isDraft: boolean
  uncompletedTaskIds: UUID[]    // 第六轮新增: 用户勾选的未完成任务
  uncompletedTaskSnapshots: Array<{  // 第六轮新增: 快照数组
    taskId: UUID
    title: string
    status: string
    projectId: UUID | null
    plannedDate: string | null
    dueDate: string | null
    isHabit: boolean
  }>
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface WeeklyReview {
  id: UUID
  weekStart: ISODate
  weekEnd: ISODate
  content: string
  aiSummary: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface MonthlyReview {
  id: UUID
  year: number
  month: number
  content: string
  aiSummary: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface LifeDomainScore {
  id: UUID
  date: ISODate
  domain: LifeDomain
  systemScore: number
  userScore: number | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface AIPriorityResult {
  id: UUID
  taskId: UUID
  score: number
  level: PriorityLevel
  reason: string
  confidence: Confidence
  generatedAt: ISODateTime
}

export interface ApprovalRequest {
  id: UUID
  actionType: string
  targetType: string
  targetIds: UUID[]
  beforeSnapshot: string
  proposedChanges: string
  reason: string
  confidence: Confidence
  status: ApprovalStatus
  createdAt: ISODateTime
  resolvedAt: ISODateTime | null
}

export interface Notification {
  id: UUID
  type: 'schedule' | 'deadline' | 'pomodoro' | 'review' | 'habit' | 'risk' | 'insight' | 'approval'
  title: string
  body: string
  targetUrl: string | null
  isRead: boolean
  createdAt: ISODateTime
}

export interface AppSettings {
  id: string
  pomodoroWorkMinutes: number
  pomodoroShortBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroLongBreakInterval: number
  lastCalendarView: string
  quietHoursStart: string | null
  quietHoursEnd: string | null
  pomodoroPresetId: string            // 第六轮新增: 'quick_start'|'standard'|'deep_focus'|'flow'|'custom'
  pomodoroCustomWork: number          // 第六轮新增
  pomodoroCustomShortBreak: number    // 第六轮新增
  pomodoroCustomLongBreak: number    // 第六轮新增
  pomodoroCustomLongInterval: number // 第六轮新增
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// --- 排序输入/输出 ---

export interface PrioritizeTasksInput {
  tasks: Task[]
  goals: Goal[]
  projects: Project[]
  dailyState: DailyState | null
  completionRecords: CompletionRecord[]
}

export interface PrioritizeTasksOutput {
  results: AIPriorityResult[]
}

// --- 导出类型 ---

export interface ExportData {
  version: string
  exportedAt: ISODateTime
  goals: Goal[]
  keyResults: KeyResult[]
  projects: Project[]
  projectColumns: ProjectColumn[]
  tasks: Task[]
  tags: Tag[]
  taskTags: TaskTag[]
  taskSchedules: TaskSchedule[]
  completionRecords: CompletionRecord[]
  timeRecords: TimeRecord[]
  pomodoroSessions: PomodoroSession[]
  dailyStates: DailyState[]
  dailyReviews: DailyReview[]
  weeklyReviews: WeeklyReview[]
  monthlyReviews: MonthlyReview[]
  lifeDomainScores: LifeDomainScore[]
  notifications: Notification[]
  appSettings: AppSettings | null
}
