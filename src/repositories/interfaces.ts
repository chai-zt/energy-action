// ============================================================
// Repository 接口 — 业务层与数据层之间的抽象
// ============================================================

import type {
  Goal, KeyResult, Project, ProjectColumn, Task, Tag, TaskTag,
  TaskSchedule, CompletionRecord, TimeRecord, PomodoroSession,
  DailyState, DailyReview, WeeklyReview, MonthlyReview,
  LifeDomainScore, AIPriorityResult, Notification, AppSettings,
  ExportData, UUID, ISODate,
} from '@/domain/models'

// --- Goal ---
export interface GoalRepository {
  getAll(): Promise<Goal[]>
  getById(id: UUID): Promise<Goal | undefined>
  getByParentId(parentId: UUID): Promise<Goal[]>
  getByStatus(status: string): Promise<Goal[]>
  create(goal: Goal): Promise<UUID>
  update(id: UUID, data: Partial<Goal>): Promise<void>
  softDelete(id: UUID): Promise<void>
  count(): Promise<number>
}

// --- KeyResult ---
export interface KeyResultRepository {
  getByGoalId(goalId: UUID): Promise<KeyResult[]>
  create(kr: KeyResult): Promise<UUID>
  update(id: UUID, data: Partial<KeyResult>): Promise<void>
  delete(id: UUID): Promise<void>
}

// --- Project ---
export interface ProjectRepository {
  getAll(): Promise<Project[]>
  getById(id: UUID): Promise<Project | undefined>
  getByGoalId(goalId: UUID): Promise<Project[]>
  create(project: Project): Promise<UUID>
  update(id: UUID, data: Partial<Project>): Promise<void>
  softDelete(id: UUID): Promise<void>
}

// --- Task ---
export interface TaskRepository {
  getAll(): Promise<Task[]>
  getRootTasks(): Promise<Task[]>
  getById(id: UUID): Promise<Task | undefined>
  getByProjectId(projectId: UUID): Promise<Task[]>
  getByStatus(status: string): Promise<Task[]>
  getTodayTasks(): Promise<Task[]>
  getHabits(): Promise<Task[]>
  getSubtasks(parentTaskId: UUID): Promise<Task[]>
  hasChildren(taskId: UUID): Promise<boolean>
  getByPlannedDate(date: ISODate): Promise<Task[]>
  getByDateRange(start: ISODate, end: ISODate): Promise<Task[]>
  create(task: Task): Promise<UUID>
  update(id: UUID, data: Partial<Task>): Promise<void>
  softDelete(id: UUID): Promise<void>
  count(): Promise<number>
}

// --- Schedule ---
export interface ScheduleRepository {
  getByDate(date: ISODate): Promise<TaskSchedule[]>
  getByTaskId(taskId: UUID): Promise<TaskSchedule | undefined>
  create(schedule: TaskSchedule): Promise<UUID>
  update(id: UUID, data: Partial<TaskSchedule>): Promise<void>
  delete(id: UUID): Promise<void>
}

// --- Completion ---
export interface CompletionRepository {
  getAll(): Promise<CompletionRecord[]>
  getByTaskId(taskId: UUID): Promise<CompletionRecord[]>
  getByDate(date: ISODate): Promise<CompletionRecord[]>
  getByDateRange(start: ISODate, end: ISODate): Promise<CompletionRecord[]>
  create(record: CompletionRecord): Promise<UUID>
  delete(id: UUID): Promise<void>
}

// --- TimeRecord ---
export interface TimeRecordRepository {
  getByTaskId(taskId: UUID): Promise<TimeRecord[]>
  getByDate(date: ISODate): Promise<TimeRecord[]>
  getByDateRange(start: ISODate, end: ISODate): Promise<TimeRecord[]>
  create(record: TimeRecord): Promise<UUID>
  update(id: UUID, data: Partial<TimeRecord>): Promise<void>
  softDelete(id: UUID): Promise<void>
}

// --- Pomodoro ---
export interface PomodoroRepository {
  getActive(): Promise<PomodoroSession | undefined>
  getByTaskId(taskId: UUID): Promise<PomodoroSession[]>
  getByDate(date: ISODate): Promise<PomodoroSession[]>
  create(session: PomodoroSession): Promise<UUID>
  update(id: UUID, data: Partial<PomodoroSession>): Promise<void>
}

// --- DailyState ---
export interface DailyStateRepository {
  getByDate(date: ISODate): Promise<DailyState | undefined>
  upsert(state: DailyState): Promise<void>
}

// --- DailyReview ---
export interface DailyReviewRepository {
  getByDate(date: ISODate): Promise<DailyReview | undefined>
  upsert(review: DailyReview): Promise<void>
}

// --- Weekly/Monthly Review ---
export interface WeeklyReviewRepository {
  getByWeek(weekStart: ISODate): Promise<WeeklyReview | undefined>
  upsert(review: WeeklyReview): Promise<void>
}

export interface MonthlyReviewRepository {
  getByMonth(year: number, month: number): Promise<MonthlyReview | undefined>
  upsert(review: MonthlyReview): Promise<void>
}

// --- LifeDomain ---
export interface LifeDomainRepository {
  getByDate(date: ISODate): Promise<LifeDomainScore[]>
  upsert(score: LifeDomainScore): Promise<void>
}

// --- 其他 ---
export interface TagRepository {
  getAll(): Promise<Tag[]>
  create(tag: Tag): Promise<UUID>
}

export interface NotificationRepository {
  getAll(): Promise<Notification[]>
  getUnread(): Promise<Notification[]>
  create(notification: Notification): Promise<UUID>
  markRead(id: UUID): Promise<void>
  markAllRead(): Promise<void>
}

export interface SettingsRepository {
  get(): Promise<AppSettings | undefined>
  upsert(settings: AppSettings): Promise<void>
}

// --- Export ---
export interface ExportRepository {
  exportAll(): Promise<ExportData>
  importAll(data: ExportData): Promise<void>
  clearAll(): Promise<void>
}
