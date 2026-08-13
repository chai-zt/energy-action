// ============================================================
// Task Domain Model — Personal AI OS V1.5
// 统一 Task 领域类型定义，所有模块从此引用
// ============================================================

import type { UUID, ISODate, ISODateTime, PriorityLevel, CognitiveLoad, EnergyDemand } from '../models'

// --- 核心 Task 实体 ---

/**
 * Task — 任务核心领域实体
 *
 * 职责：表达"需要做的一件事"，包括普通任务、固定任务/习惯。
 * 不包含 UI 状态（selected/hover/modalOpen/dragTargetDate 等）。
 *
 * 与 Goal 的关系：task.goalId → 关联到某个目标（V1.5 预留）
 * 最小行动：当 Goal 拆解后，可以生成多条 Task 作为最小执行单元（V1.5 预留）
 */
export interface Task {
  /** 唯一标识，UUID */
  id: UUID

  /** 任务名称 */
  title: string

  /** 详细描述 */
  description: string

  // ---- 组织关系 ----
  /** 所属项目 ID */
  projectId: UUID | null

  /** 关联目标 ID（V1.5 预留：Goal ↔ Task 主关联） */
  goalId: UUID | null

  /** 关联关键结果 ID */
  keyResultId: UUID | null

  /** 看板列 ID（项目看板用） */
  columnId: UUID | null

  /** 父任务 ID（子任务用） */
  parentTaskId: UUID | null

  /** 用户在创建时确定的任务层级；旧数据由是否有子任务兼容判断 */
  taskKind?: TaskKind

  // ---- 生命周期 ----
  /** 当前状态：inbox | todo | doing | done | cancelled */
  status: TaskStatus

  /** 完成时间 */
  completedAt: ISODateTime | null

  // ---- 优先级 ----
  /** 用户手动优先级（数值越大越优先） */
  userPriority: number | null

  /** AI 评估优先级分数 */
  aiPriorityScore: number

  /** AI 推荐优先级等级 */
  aiPriorityLevel: PriorityLevel | null

  /** AI 优先级推荐理由 */
  aiPriorityReason: string

  // ---- 时间规划 ----
  /** 截止日期 */
  dueDate: ISODate | null

  /** 计划执行日期（拖到日历的日期） */
  plannedDate: ISODate | null

  /** 预计耗时（分钟） */
  estimatedMinutes: number

  /** 实际耗时（分钟），由番茄钟/计时器累积 */
  actualMinutes: number

  // ---- 精力 ----
  /** 认知负荷等级（兼容旧字段，新 UI 已不直接使用） */
  cognitiveLoad: CognitiveLoad

  /** 精力消耗等级 1-5，映射为 3/5/10/20/30 点 */
  energyDemand: EnergyDemand

  // ---- 固定任务/习惯 ----
  /** 是否为固定任务/习惯 */
  isHabit: boolean

  /** 重复规则（RFC 5545 RRULE 格式），仅 isHabit=true 时有效 */
  recurrenceRule: string | null

  // ---- 排序 ----
  /** 列表排序权重 */
  order: number

  // ---- 审计 ----
  /** 创建时间 */
  createdAt: ISODateTime

  /** 最后更新时间 */
  updatedAt: ISODateTime

  /** 删除时间（软删除） */
  deletedAt: ISODateTime | null

  /** 同一次级联回收的批次标识，用于整体恢复任务树 */
  recycleBatchId?: UUID | null
}

// --- 状态枚举 ---

/**
 * Task 生命周期状态
 * - inbox: 待安排（兼容旧字段，新 UI 已转为 unscheduled）
 * - todo: 待办
 * - doing: 进行中
 * - done: 已完成
 * - cancelled: 已取消
 */
export type TaskStatus = 'inbox' | 'todo' | 'doing' | 'done' | 'cancelled'

export type TaskKind = 'large' | 'small'

// ============================================================
// V1.5 任务拆解 — 执行步骤 + 最小可行动作
// ============================================================

/** 执行步骤状态 */
export type StepStatus = 'pending' | 'done'

/**
 * ExecutionStep — 任务拆解后的执行步骤
 */
export interface ExecutionStep {
  id: UUID
  taskId: UUID
  content: string
  order: number
  status: StepStatus
  completedAt: ISODateTime | null
  createdAt: ISODateTime
}

/**
 * MinimumAction — 最小可行动作（现在第一步）
 *
 * 一条 Task 可以有一个 MinimumAction，
 * 表示"现在就可以开始的最小动作"。
 */
export interface MinimumAction {
  id: UUID
  taskId: UUID
  description: string
  estimatedMinutes: number
  difficulty: 1 | 2 | 3 | 4 | 5
  aiGenerated: boolean
  status: StepStatus
  completedAt: ISODateTime | null
  createdAt: ISODateTime
  /** 与所属任务一致的回收状态；保留七天后清理 */
  deletedAt?: ISODateTime | null
  recycleBatchId?: UUID | null
}

/**
 * DecompositionResult — 拆解结果
 */
export interface DecompositionResult {
  steps: Omit<ExecutionStep, 'id' | 'taskId' | 'status' | 'completedAt' | 'createdAt'>[]
  minimumAction: Omit<MinimumAction, 'id' | 'taskId' | 'status' | 'completedAt' | 'createdAt'>
}

/**
 * GoalRelation — Task 与 Goal 的关联信息（V1.5 预留）
 *
 * 本轮不实现，仅在模型层面明确 Task.goalId 的语义。
 */
export interface GoalRelation {
  goalId: UUID
  /** 该 Task 对 Goal 进度的贡献权重 (0-1) */
  contributionWeight: number
  /** 关联方式：manual | ai_decomposed */
  source: 'manual' | 'ai_decomposed'
}
