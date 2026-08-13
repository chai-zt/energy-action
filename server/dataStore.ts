// ============================================================
// 数据存储门面 — SQLite 持久化
//
// 对外 API 与旧 JSON 文件存储保持一致：
//   readTasks / readMinActions / readDecompositions / readProjects
//   atomicWriteAll（真正 transaction：全删 + 全插）
//   purgeExpiredRecycleBin
//
// 上层调用者（server/index.ts、decomposeService.ts）无需改动。
// 内部已从 JSON 文件切换为 SQLite（server/db/sqlite.ts）。
// ============================================================

import { getDb, transaction } from './db/sqlite.ts'
import type { MinimumAction, Project, Task } from '../src/domain/models.ts'

export const RECYCLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// === Decomposition 完成记录（供 decomposeService 复用）===

export interface DecompositionRecord {
  id: string
  taskId: string
  status: 'completed'
  shouldDecompose: boolean
  originalInput: { title: string; description: string }
  originalOutput: unknown
  createdAt: string
}

// === 类型转换 helpers ===

const toInt = (b: boolean | null | undefined) => (b ? 1 : 0)
const fromInt = (n: number | null | undefined) => n === 1
const toJson = (v: unknown) => JSON.stringify(v)
const fromJson = (s: string | null): unknown => {
  if (s === null || s === undefined) return null
  try { return JSON.parse(s) } catch { return null }
}

// === Task 映射 ===

type TaskRow = Record<string, unknown>

function taskToRow(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    project_id: task.projectId ?? null,
    goal_id: task.goalId ?? null,
    key_result_id: task.keyResultId ?? null,
    column_id: task.columnId ?? null,
    parent_task_id: task.parentTaskId ?? null,
    task_kind: task.taskKind ?? null,
    status: task.status,
    user_priority: task.userPriority ?? null,
    ai_priority_score: task.aiPriorityScore ?? 0,
    ai_priority_level: task.aiPriorityLevel ?? null,
    ai_priority_reason: task.aiPriorityReason ?? '',
    due_date: task.dueDate ?? null,
    planned_date: task.plannedDate ?? null,
    estimated_minutes: task.estimatedMinutes ?? 0,
    actual_minutes: task.actualMinutes ?? 0,
    cognitive_load: task.cognitiveLoad ?? 'medium',
    energy_demand: task.energyDemand ?? 3,
    recurrence_rule: task.recurrenceRule ?? null,
    is_habit: toInt(task.isHabit),
    completed_at: task.completedAt ?? null,
    sort_order: task.order ?? 0,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    deleted_at: task.deletedAt ?? null,
    recycle_batch_id: task.recycleBatchId ?? null,
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    projectId: (row.project_id as string | null) ?? null,
    goalId: (row.goal_id as string | null) ?? null,
    keyResultId: (row.key_result_id as string | null) ?? null,
    columnId: (row.column_id as string | null) ?? null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    ...(row.task_kind != null ? { taskKind: row.task_kind as Task['taskKind'] } : {}),
    status: row.status as Task['status'],
    userPriority: (row.user_priority as number | null) ?? null,
    aiPriorityScore: (row.ai_priority_score as number) ?? 0,
    aiPriorityLevel: (row.ai_priority_level as string | null) ?? null,
    aiPriorityReason: row.ai_priority_reason as string,
    dueDate: (row.due_date as string | null) ?? null,
    plannedDate: (row.planned_date as string | null) ?? null,
    estimatedMinutes: (row.estimated_minutes as number) ?? 0,
    actualMinutes: (row.actual_minutes as number) ?? 0,
    cognitiveLoad: row.cognitive_load as Task['cognitiveLoad'],
    energyDemand: (row.energy_demand as number) ?? 3,
    recurrenceRule: (row.recurrence_rule as string | null) ?? null,
    isHabit: fromInt(row.is_habit as number | null),
    completedAt: (row.completed_at as string | null) ?? null,
    order: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
    ...(row.recycle_batch_id != null ? { recycleBatchId: row.recycle_batch_id as string } : {}),
  }
}

// === MinimumAction 映射 ===

function minActionToRow(ma: MinimumAction): Record<string, unknown> {
  return {
    id: ma.id,
    task_id: ma.taskId,
    description: ma.description,
    estimated_minutes: ma.estimatedMinutes ?? 0,
    difficulty: ma.difficulty ?? 1,
    ai_generated: toInt(ma.aiGenerated),
    status: ma.status,
    completed_at: ma.completedAt ?? null,
    created_at: ma.createdAt,
    deleted_at: ma.deletedAt ?? null,
    recycle_batch_id: ma.recycleBatchId ?? null,
  }
}

function rowToMinAction(row: TaskRow): MinimumAction {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    description: row.description as string,
    estimatedMinutes: (row.estimated_minutes as number) ?? 0,
    difficulty: (row.difficulty as number) ?? 1,
    aiGenerated: fromInt(row.ai_generated as number | null),
    status: row.status as MinimumAction['status'],
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    ...(row.deleted_at != null ? { deletedAt: row.deleted_at as string } : {}),
    ...(row.recycle_batch_id != null ? { recycleBatchId: row.recycle_batch_id as string } : {}),
  }
}

// === Decomposition 映射 ===

function decompToRow(d: DecompositionRecord): Record<string, unknown> {
  return {
    id: d.id,
    task_id: d.taskId,
    status: d.status,
    should_decompose: toInt(d.shouldDecompose),
    original_input: toJson(d.originalInput),
    original_output: toJson(d.originalOutput),
    created_at: d.createdAt,
  }
}

function rowToDecomp(row: TaskRow): DecompositionRecord {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    status: 'completed',
    shouldDecompose: fromInt(row.should_decompose as number | null),
    originalInput: fromJson(row.original_input as string | null) as { title: string; description: string },
    originalOutput: fromJson(row.original_output as string | null),
    createdAt: row.created_at as string,
  }
}

// === Project 映射 ===

function projectToRow(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    goal_id: p.goalId ?? null,
    key_result_id: p.keyResultId ?? null,
    status: p.status,
    priority: p.priority ?? 0,
    start_date: p.startDate ?? null,
    due_date: p.dueDate ?? null,
    progress: p.progress ?? 0,
    progress_mode: p.progressMode ?? 'task',
    color: p.color ?? null,
    icon: p.icon ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted_at: p.deletedAt ?? null,
    completed_at: p.completedAt ?? null,
  }
}

function rowToProject(row: TaskRow): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    goalId: (row.goal_id as string | null) ?? null,
    keyResultId: (row.key_result_id as string | null) ?? null,
    status: row.status as Project['status'],
    priority: (row.priority as number) ?? 0,
    startDate: (row.start_date as string | null) ?? null,
    dueDate: (row.due_date as string | null) ?? null,
    progress: (row.progress as number) ?? 0,
    progressMode: row.progress_mode as Project['progressMode'],
    color: (row.color as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

// === 读（返回全部行，含软删除；由调用方自行过滤 deletedAt）===

export function readTasks(): Task[] {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY rowid').all() as TaskRow[]
  return rows.map(rowToTask)
}

export function readMinActions(): MinimumAction[] {
  const rows = getDb().prepare('SELECT * FROM minimum_actions ORDER BY rowid').all() as TaskRow[]
  return rows.map(rowToMinAction)
}

export function readDecompositions(): DecompositionRecord[] {
  const rows = getDb().prepare('SELECT * FROM task_decompositions ORDER BY rowid').all() as TaskRow[]
  return rows.map(rowToDecomp)
}

export function readProjects(): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects ORDER BY rowid').all() as TaskRow[]
  return rows.map(rowToProject)
}

// === 写：真正 transaction（全删 + 全插，与旧 atomicWriteAll 语义一致）===

export function atomicWriteAll(updates: {
  tasks: Task[]
  minActions: MinimumAction[]
  decompositions: DecompositionRecord[]
  projects: Project[]
}): void {
  transaction(() => {
    const db = getDb()

    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM minimum_actions').run()
    db.prepare('DELETE FROM task_decompositions').run()
    db.prepare('DELETE FROM projects').run()

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, project_id, goal_id, key_result_id, column_id,
        parent_task_id, task_kind, status, user_priority, ai_priority_score,
        ai_priority_level, ai_priority_reason, due_date, planned_date,
        estimated_minutes, actual_minutes, cognitive_load, energy_demand,
        recurrence_rule, is_habit, completed_at, sort_order, created_at,
        updated_at, deleted_at, recycle_batch_id
      ) VALUES (
        @id, @title, @description, @project_id, @goal_id, @key_result_id, @column_id,
        @parent_task_id, @task_kind, @status, @user_priority, @ai_priority_score,
        @ai_priority_level, @ai_priority_reason, @due_date, @planned_date,
        @estimated_minutes, @actual_minutes, @cognitive_load, @energy_demand,
        @recurrence_rule, @is_habit, @completed_at, @sort_order, @created_at,
        @updated_at, @deleted_at, @recycle_batch_id
      )
    `)

    const insertMinAction = db.prepare(`
      INSERT INTO minimum_actions (
        id, task_id, description, estimated_minutes, difficulty, ai_generated,
        status, completed_at, created_at, deleted_at, recycle_batch_id
      ) VALUES (
        @id, @task_id, @description, @estimated_minutes, @difficulty, @ai_generated,
        @status, @completed_at, @created_at, @deleted_at, @recycle_batch_id
      )
    `)

    const insertDecomp = db.prepare(`
      INSERT INTO task_decompositions (
        id, task_id, status, should_decompose, original_input, original_output, created_at
      ) VALUES (
        @id, @task_id, @status, @should_decompose, @original_input, @original_output, @created_at
      )
    `)

    const insertProject = db.prepare(`
      INSERT INTO projects (
        id, name, description, goal_id, key_result_id, status, priority,
        start_date, due_date, progress, progress_mode, color, icon,
        created_at, updated_at, deleted_at, completed_at
      ) VALUES (
        @id, @name, @description, @goal_id, @key_result_id, @status, @priority,
        @start_date, @due_date, @progress, @progress_mode, @color, @icon,
        @created_at, @updated_at, @deleted_at, @completed_at
      )
    `)

    for (const t of updates.tasks) insertTask.run(taskToRow(t))
    for (const m of updates.minActions) insertMinAction.run(minActionToRow(m))
    for (const d of updates.decompositions) insertDecomp.run(decompToRow(d))
    for (const p of updates.projects) insertProject.run(projectToRow(p))
  })
}

// === 回收站过期清理（语义与旧实现一致）===

function isExpired(deletedAt: string | null | undefined, currentTime: number): boolean {
  if (!deletedAt) return false
  const deletedTime = Date.parse(deletedAt)
  return Number.isFinite(deletedTime) && currentTime - deletedTime >= RECYCLE_RETENTION_MS
}

export function purgeExpiredRecycleBin(currentTime = Date.now()): void {
  const tasks = readTasks()
  const expiredTaskIds = new Set(tasks.filter(task => isExpired(task.deletedAt, currentTime)).map(task => task.id))
  const minActions = readMinActions()
  const remainingTasks = tasks.filter(task => !expiredTaskIds.has(task.id))
  const remainingMinActions = minActions.filter(action =>
    !expiredTaskIds.has(action.taskId) && !isExpired(action.deletedAt, currentTime),
  )

  if (remainingTasks.length === tasks.length && remainingMinActions.length === minActions.length) return
  atomicWriteAll({
    tasks: remainingTasks,
    minActions: remainingMinActions,
    decompositions: readDecompositions(),
    projects: readProjects(),
  })
}
