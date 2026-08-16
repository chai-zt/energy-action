// ============================================================
// Dexie Repository 实现
// ============================================================

import { db } from '@/storage/db'
import { ApiTaskRepository } from '@/storage/apiTaskRepository'
import { ApiProjectRepository } from '@/storage/apiProjectRepository'
import type {
  Goal, KeyResult, Project, ProjectColumn, Task, Tag, TaskSchedule, CompletionRecord,
  TimeRecord, PomodoroSession, DailyState, DailyReview,
  WeeklyReview, MonthlyReview, LifeDomainScore,
  Notification, AppSettings, ExportData, UUID, ISODate,
  ExecutionStep, MinimumAction,
} from '@/domain/models'
import type {
  GoalRepository, KeyResultRepository, ProjectRepository,
  TaskRepository, ScheduleRepository, CompletionRepository,
  TimeRecordRepository, PomodoroRepository,
  DailyStateRepository, DailyReviewRepository,
  WeeklyReviewRepository, MonthlyReviewRepository,
  LifeDomainRepository, TagRepository,
  NotificationRepository, SettingsRepository,
  ExportRepository,
} from '@/repositories/interfaces'
import { generateId, today, now } from '@/lib/utils'

// --- Goal ---
export class DexieGoalRepository implements GoalRepository {
  async getAll(): Promise<Goal[]> {
    return db.goals.filter(g => !g.deletedAt).toArray()
  }
  async getById(id: UUID): Promise<Goal | undefined> {
    return db.goals.get(id)
  }
  async getByParentId(parentId: UUID): Promise<Goal[]> {
    return db.goals.where('parentGoalId').equals(parentId).filter(g => !g.deletedAt).toArray()
  }
  async getByStatus(status: string): Promise<Goal[]> {
    return db.goals.where('status').equals(status).filter(g => !g.deletedAt).toArray()
  }
  async create(goal: Goal): Promise<UUID> {
    await db.goals.add(goal)
    return goal.id
  }
  async update(id: UUID, data: Partial<Goal>): Promise<void> {
    await db.goals.update(id, { ...data, updatedAt: now() })
  }
  async softDelete(id: UUID): Promise<void> {
    await db.goals.update(id, { deletedAt: now(), updatedAt: now() })
  }
  async count(): Promise<number> {
    return db.goals.filter(g => !g.deletedAt).count()
  }
}

// --- KeyResult ---
export class DexieKeyResultRepository implements KeyResultRepository {
  async getByGoalId(goalId: UUID): Promise<KeyResult[]> {
    return db.keyResults.where('goalId').equals(goalId).filter(k => !k.deletedAt).toArray()
  }
  async create(kr: KeyResult): Promise<UUID> {
    await db.keyResults.add(kr)
    return kr.id
  }
  async update(id: UUID, data: Partial<KeyResult>): Promise<void> {
    await db.keyResults.update(id, { ...data, updatedAt: now() })
  }
  async delete(id: UUID): Promise<void> {
    await db.keyResults.update(id, { deletedAt: now(), updatedAt: now() })
  }
}

// --- Project ---
export class LegacyDexieProjectRepository implements ProjectRepository {
  async getAll(): Promise<Project[]> {
    return db.projects.filter(p => !p.deletedAt).toArray()
  }
  async getById(id: UUID): Promise<Project | undefined> {
    return db.projects.get(id)
  }
  async getByGoalId(goalId: UUID): Promise<Project[]> {
    return db.projects.where('goalId').equals(goalId).filter(p => !p.deletedAt).toArray()
  }
  async create(project: Project): Promise<UUID> {
    await db.projects.add(project)
    return project.id
  }
  async update(id: UUID, data: Partial<Project>): Promise<void> {
    await db.projects.update(id, { ...data, updatedAt: now() })
  }
  async softDelete(id: UUID): Promise<void> {
    await db.projects.update(id, { deletedAt: now(), updatedAt: now() })
  }
}

// --- Task ---
export class LegacyDexieTaskRepository implements TaskRepository {
  async getAll(): Promise<Task[]> {
    return db.tasks.filter(t => !t.deletedAt).toArray()
  }
  async getRootTasks(): Promise<Task[]> {
    return db.tasks.filter(t => !t.deletedAt && !t.parentTaskId).toArray()
  }
  async getById(id: UUID): Promise<Task | undefined> {
    return db.tasks.get(id)
  }
  async getByProjectId(projectId: UUID): Promise<Task[]> {
    return db.tasks.where('projectId').equals(projectId).filter(t => !t.deletedAt).toArray()
  }
  async getByStatus(status: string): Promise<Task[]> {
    return db.tasks.where('status').equals(status).filter(t => !t.deletedAt).toArray()
  }
  async getTodayTasks(): Promise<Task[]> {
    const todayStr = today()
    return db.tasks
      .filter(t => !t.deletedAt && t.status !== 'done' && t.status !== 'cancelled')
      .filter(t => t.plannedDate === todayStr || t.dueDate === todayStr || !t.plannedDate)
      .toArray()
  }
  async getHabits(): Promise<Task[]> {
    return db.tasks.filter(t => t.isHabit && !t.deletedAt).toArray()
  }
  async getSubtasks(parentTaskId: UUID): Promise<Task[]> {
    return db.tasks.where('parentTaskId').equals(parentTaskId).filter(t => !t.deletedAt).sortBy('order')
  }
  async hasChildren(taskId: UUID): Promise<boolean> {
    const count = await db.tasks.where('parentTaskId').equals(taskId).filter(t => !t.deletedAt).count()
    return count > 0
  }
  async getByPlannedDate(date: ISODate): Promise<Task[]> {
    return db.tasks.where('plannedDate').equals(date).filter(t => !t.deletedAt).toArray()
  }
  async getByDateRange(start: ISODate, end: ISODate): Promise<Task[]> {
    return db.tasks
      .where('plannedDate')
      .between(start, end, true, true)
      .filter(t => !t.deletedAt)
      .toArray()
  }
  async create(task: Task): Promise<UUID> {
    await db.tasks.add(task)
    return task.id
  }
  async update(id: UUID, data: Partial<Task>): Promise<void> {
    await db.tasks.update(id, { ...data, updatedAt: now() })
  }
  async softDelete(id: UUID): Promise<void> {
    await db.tasks.update(id, { deletedAt: now(), updatedAt: now() })
  }
  async count(): Promise<number> {
    return db.tasks.filter(t => !t.deletedAt).count()
  }
}

// ponytail: 保留旧导出名，任务组数据集中切换至 API；旧 Dexie 记录只用于一次性迁入。
export class DexieProjectRepository extends ApiProjectRepository {}

// ponytail: 保留旧导出名，集中切换所有任务消费者到 API 数据源。
// 升级路径：其余本地 Task 依赖移除后删除 LegacyDexieTaskRepository 与该兼容别名。
export class DexieTaskRepository extends ApiTaskRepository {}

// --- Schedule ---
export class DexieScheduleRepository implements ScheduleRepository {
  async getByDate(date: ISODate): Promise<TaskSchedule[]> {
    return db.taskSchedules.where('plannedDate').equals(date).toArray()
  }
  async getByTaskId(taskId: UUID): Promise<TaskSchedule | undefined> {
    return db.taskSchedules.where('taskId').equals(taskId).first()
  }
  async create(schedule: TaskSchedule): Promise<UUID> {
    await db.taskSchedules.add(schedule)
    return schedule.id
  }
  async update(id: UUID, data: Partial<TaskSchedule>): Promise<void> {
    await db.taskSchedules.update(id, { ...data, updatedAt: now() })
  }
  async delete(id: UUID): Promise<void> {
    await db.taskSchedules.delete(id)
  }
}

// --- Completion ---
export class DexieCompletionRepository implements CompletionRepository {
  async getAll(): Promise<CompletionRecord[]> {
    return db.completionRecords.toArray()
  }

  async getByTaskId(taskId: UUID): Promise<CompletionRecord[]> {
    return db.completionRecords.where('taskId').equals(taskId).toArray()
  }
  async getByDate(date: ISODate): Promise<CompletionRecord[]> {
    return db.completionRecords.where('completedDate').equals(date).toArray()
  }
  async getByDateRange(start: ISODate, end: ISODate): Promise<CompletionRecord[]> {
    return db.completionRecords
      .filter(r => r.completedDate >= start && r.completedDate <= end)
      .toArray()
  }
  async create(record: CompletionRecord): Promise<UUID> {
    await db.completionRecords.add(record)
    return record.id
  }
  async delete(id: UUID): Promise<void> {
    await db.completionRecords.delete(id)
  }
}

// --- TimeRecord ---
export class DexieTimeRecordRepository implements TimeRecordRepository {
  async getByTaskId(taskId: UUID): Promise<TimeRecord[]> {
    return db.timeRecords.where('taskId').equals(taskId).filter(t => !t.deletedAt).toArray()
  }
  async getByDate(date: ISODate): Promise<TimeRecord[]> {
    return db.timeRecords
      .filter(t => !t.deletedAt)
      .filter(t => t.startAt.startsWith(date))
      .toArray()
  }
  async getByDateRange(start: ISODate, end: ISODate): Promise<TimeRecord[]> {
    return db.timeRecords
      .filter(t => !t.deletedAt)
      .filter(t => t.startAt >= start + 'T00:00:00' && t.startAt <= end + 'T23:59:59')
      .toArray()
  }
  async create(record: TimeRecord): Promise<UUID> {
    await db.timeRecords.add(record)
    return record.id
  }
  async update(id: UUID, data: Partial<TimeRecord>): Promise<void> {
    await db.timeRecords.update(id, data)
  }
  async softDelete(id: UUID): Promise<void> {
    await db.timeRecords.update(id, { deletedAt: now() })
  }
}

// --- Pomodoro ---
export class DexiePomodoroRepository implements PomodoroRepository {
  async getActive(): Promise<PomodoroSession | undefined> {
    return db.pomodoroSessions.filter(p => !p.completed && !p.endAt).first()
  }
  async getByTaskId(taskId: UUID): Promise<PomodoroSession[]> {
    return db.pomodoroSessions.where('taskId').equals(taskId).toArray()
  }
  async getByDate(date: ISODate): Promise<PomodoroSession[]> {
    return db.pomodoroSessions
      .filter(p => p.startAt.startsWith(date))
      .toArray()
  }
  async create(session: PomodoroSession): Promise<UUID> {
    await db.pomodoroSessions.add(session)
    return session.id
  }
  async update(id: UUID, data: Partial<PomodoroSession>): Promise<void> {
    await db.pomodoroSessions.update(id, data)
  }
}

// --- DailyState ---
export class DexieDailyStateRepository implements DailyStateRepository {
  async getByDate(date: ISODate): Promise<DailyState | undefined> {
    return db.dailyStates.where('date').equals(date).first()
  }
  async upsert(state: DailyState): Promise<void> {
    const existing = await db.dailyStates.where('date').equals(state.date).first()
    if (existing) {
      await db.dailyStates.update(existing.id, { ...state, updatedAt: now() })
    } else {
      await db.dailyStates.add(state)
    }
  }
}

// --- DailyReview ---
export class DexieDailyReviewRepository implements DailyReviewRepository {
  async getByDate(date: ISODate): Promise<DailyReview | undefined> {
    return db.dailyReviews.where('date').equals(date).first()
  }
  async upsert(review: DailyReview): Promise<void> {
    const existing = await db.dailyReviews.where('date').equals(review.date).first()
    if (existing) {
      await db.dailyReviews.update(existing.id, { ...review, updatedAt: now() })
    } else {
      await db.dailyReviews.add(review)
    }
  }
}

// --- WeeklyReview ---
export class DexieWeeklyReviewRepository implements WeeklyReviewRepository {
  async getByWeek(weekStart: ISODate): Promise<WeeklyReview | undefined> {
    return db.weeklyReviews.where('weekStart').equals(weekStart).first()
  }
  async upsert(review: WeeklyReview): Promise<void> {
    const existing = await db.weeklyReviews.where('weekStart').equals(review.weekStart).first()
    if (existing) {
      await db.weeklyReviews.update(existing.id, { ...review, updatedAt: now() })
    } else {
      await db.weeklyReviews.add(review)
    }
  }
}

// --- MonthlyReview ---
export class DexieMonthlyReviewRepository implements MonthlyReviewRepository {
  async getByMonth(year: number, month: number): Promise<MonthlyReview | undefined> {
    return db.monthlyReviews.where('[year+month]').equals([year, month]).first()
  }
  async upsert(review: MonthlyReview): Promise<void> {
    const existing = await db.monthlyReviews.where('[year+month]').equals([review.year, review.month]).first()
    if (existing) {
      await db.monthlyReviews.update(existing.id, { ...review, updatedAt: now() })
    } else {
      await db.monthlyReviews.add(review)
    }
  }
}

// --- LifeDomain ---
export class DexieLifeDomainRepository implements LifeDomainRepository {
  async getByDate(date: ISODate): Promise<LifeDomainScore[]> {
    return db.lifeDomainScores.where('date').equals(date).toArray()
  }
  async upsert(score: LifeDomainScore): Promise<void> {
    const existing = await db.lifeDomainScores
      .where('[date+domain]')
      .equals([score.date, score.domain])
      .first()
    if (existing) {
      await db.lifeDomainScores.update(existing.id, { ...score, updatedAt: now() })
    } else {
      await db.lifeDomainScores.add(score)
    }
  }
}

// --- Tag ---
export class DexieTagRepository implements TagRepository {
  async getAll(): Promise<Tag[]> {
    return db.tags.toArray()
  }
  async create(tag: Tag): Promise<UUID> {
    await db.tags.add(tag)
    return tag.id
  }
}

// --- Notification ---
export class DexieNotificationRepository implements NotificationRepository {
  async getAll(): Promise<Notification[]> {
    return db.notifications.orderBy('createdAt').reverse().toArray()
  }
  async getUnread(): Promise<Notification[]> {
    return db.notifications.where('isRead').equals(0).toArray()
  }
  async create(notification: Notification): Promise<UUID> {
    await db.notifications.add(notification)
    return notification.id
  }
  async markRead(id: UUID): Promise<void> {
    await db.notifications.update(id, { isRead: true })
  }
  async markAllRead(): Promise<void> {
    const unread = await db.notifications.where('isRead').equals(0).toArray()
    await Promise.all(unread.map(n => db.notifications.update(n.id, { isRead: true })))
  }
}

// --- Settings ---
export class DexieSettingsRepository implements SettingsRepository {
  async get(): Promise<AppSettings | undefined> {
    return db.appSettings.get('default')
  }
  async upsert(settings: AppSettings): Promise<void> {
    await db.appSettings.put(settings)
  }
}

// --- Export ---
export class DexieExportRepository implements ExportRepository {
  async exportAll(): Promise<ExportData> {
    const [
      goals, keyResults, projects, projectColumns, tasks,
      tags, taskTags, taskSchedules, completionRecords,
      timeRecords, pomodoroSessions, dailyStates,
      dailyReviews, weeklyReviews, monthlyReviews,
      lifeDomainScores, notifications, appSettings,
    ] = await Promise.all([
      db.goals.toArray(),
      db.keyResults.toArray(),
      db.projects.toArray(),
      db.projectColumns.toArray(),
      db.tasks.toArray(),
      db.tags.toArray(),
      db.taskTags.toArray(),
      db.taskSchedules.toArray(),
      db.completionRecords.toArray(),
      db.timeRecords.toArray(),
      db.pomodoroSessions.toArray(),
      db.dailyStates.toArray(),
      db.dailyReviews.toArray(),
      db.weeklyReviews.toArray(),
      db.monthlyReviews.toArray(),
      db.lifeDomainScores.toArray(),
      db.notifications.toArray(),
      db.appSettings.get('default'),
    ])

    return {
      version: '0.1.0',
      exportedAt: now(),
      goals,
      keyResults,
      projects,
      projectColumns,
      tasks,
      tags,
      taskTags,
      taskSchedules,
      completionRecords,
      timeRecords,
      pomodoroSessions,
      dailyStates,
      dailyReviews,
      weeklyReviews,
      monthlyReviews,
      lifeDomainScores,
      notifications,
      appSettings: appSettings || null,
    }
  }

  async importAll(data: ExportData): Promise<void> {
    await db.transaction('rw',
      [
        db.goals, db.keyResults, db.projects, db.projectColumns,
        db.tasks, db.tags, db.taskTags, db.taskSchedules,
        db.completionRecords, db.timeRecords, db.pomodoroSessions,
        db.dailyStates, db.dailyReviews, db.weeklyReviews,
        db.monthlyReviews, db.lifeDomainScores,
        db.notifications, db.appSettings,
      ],
      async () => {
        await Promise.all([
          db.goals.clear(), db.keyResults.clear(), db.projects.clear(),
          db.projectColumns.clear(), db.tasks.clear(), db.tags.clear(),
          db.taskTags.clear(), db.taskSchedules.clear(),
          db.completionRecords.clear(), db.timeRecords.clear(),
          db.pomodoroSessions.clear(), db.dailyStates.clear(),
          db.dailyReviews.clear(), db.weeklyReviews.clear(),
          db.monthlyReviews.clear(), db.lifeDomainScores.clear(),
          db.notifications.clear(), db.appSettings.clear(),
        ])

        await Promise.all([
          db.goals.bulkAdd(data.goals),
          db.keyResults.bulkAdd(data.keyResults),
          db.projects.bulkAdd(data.projects),
          db.projectColumns.bulkAdd(data.projectColumns),
          db.tasks.bulkAdd(data.tasks),
          db.tags.bulkAdd(data.tags),
          db.taskTags.bulkAdd(data.taskTags),
          db.taskSchedules.bulkAdd(data.taskSchedules),
          db.completionRecords.bulkAdd(data.completionRecords),
          db.timeRecords.bulkAdd(data.timeRecords),
          db.pomodoroSessions.bulkAdd(data.pomodoroSessions),
          db.dailyStates.bulkAdd(data.dailyStates),
          db.dailyReviews.bulkAdd(data.dailyReviews),
          db.weeklyReviews.bulkAdd(data.weeklyReviews),
          db.monthlyReviews.bulkAdd(data.monthlyReviews),
          db.lifeDomainScores.bulkAdd(data.lifeDomainScores),
          db.notifications.bulkAdd(data.notifications),
        ])

        if (data.appSettings) {
          await db.appSettings.put(data.appSettings)
        }
      }
    )
  }

  async clearAll(): Promise<void> {
    await db.transaction('rw', db.tables.map(t => t.name as any), async () => {
      await Promise.all(db.tables.map(t => t.clear()))
    })
  }
}

// --- ExecutionStep ---
export class DexieExecutionStepRepository {
  async getByTaskId(taskId: UUID): Promise<ExecutionStep[]> {
    return db.executionSteps.where('taskId').equals(taskId).sortBy('order')
  }
  async createMany(steps: ExecutionStep[]): Promise<void> {
    await db.executionSteps.bulkPut(steps)
  }
  async update(id: UUID, data: Partial<ExecutionStep>): Promise<void> {
    await db.executionSteps.update(id, data)
  }
}

// --- MinimumAction ---
export class DexieMinimumActionRepository {
  async getByTaskId(taskId: UUID): Promise<MinimumAction | undefined> {
    return db.minimumActions.where('taskId').equals(taskId).first()
  }
  async create(ma: MinimumAction): Promise<void> {
    await db.minimumActions.put(ma)
  }
  async update(id: UUID, data: Partial<MinimumAction>): Promise<void> {
    await db.minimumActions.update(id, data)
  }
}
