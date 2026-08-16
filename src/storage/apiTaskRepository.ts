import type { ISODate, Task, UUID } from '@/domain/models'
import { today } from '@/lib/utils'
import type { TaskRepository } from '@/repositories/interfaces'
import {
  createTask,
  getAllTasks,
  getTaskById,
  softDeleteTask,
  updateTask,
} from '@/services/apiClient'
import { db } from './db'

let legacyMigration: Promise<void> | null = null

async function migrateLegacyTasks(): Promise<void> {
  const remoteTasks = await getAllTasks()
  const remoteIds = new Set(remoteTasks.map(task => task.id))
  // 软删除记录继续保留在旧库中；服务端列表默认不返回它们，迁移会造成重复创建冲突。
  const legacyTasks = (await db.tasks.toArray()).filter(task => !task.deletedAt)

  for (const task of legacyTasks) {
    if (!remoteIds.has(task.id)) await createTask(task)
  }
}

function ensureLegacyTasksMigrated(): Promise<void> {
  legacyMigration ??= migrateLegacyTasks().catch(error => {
    // ponytail: 旧 IndexedDB 只是一次性兼容来源，不能阻断 SQLite 真源。
    console.warn('[Task migration] 已跳过不可用的旧本地数据:', error)
  })
  return legacyMigration
}

export class ApiTaskRepository implements TaskRepository {
  private async getTasks(): Promise<Task[]> {
    await ensureLegacyTasksMigrated()
    return getAllTasks()
  }

  async getAll(): Promise<Task[]> {
    return this.getTasks()
  }

  async getRootTasks(): Promise<Task[]> {
    return (await this.getTasks()).filter(task => !task.parentTaskId)
  }

  async getById(id: UUID): Promise<Task | undefined> {
    await ensureLegacyTasksMigrated()
    try {
      return await getTaskById(id)
    } catch {
      return undefined
    }
  }

  async getByProjectId(projectId: UUID): Promise<Task[]> {
    return (await this.getTasks()).filter(task => task.projectId === projectId)
  }

  async getByStatus(status: string): Promise<Task[]> {
    return (await this.getTasks()).filter(task => task.status === status)
  }

  async getTodayTasks(): Promise<Task[]> {
    const currentDate = today()
    return (await this.getTasks()).filter(task =>
      task.status !== 'done' && task.status !== 'cancelled'
      && (task.plannedDate === currentDate || task.dueDate === currentDate || !task.plannedDate)
    )
  }

  async getHabits(): Promise<Task[]> {
    return (await this.getTasks()).filter(task => task.isHabit)
  }

  async getSubtasks(parentTaskId: UUID): Promise<Task[]> {
    return (await this.getTasks())
      .filter(task => task.parentTaskId === parentTaskId)
      .sort((left, right) => left.order - right.order)
  }

  async hasChildren(taskId: UUID): Promise<boolean> {
    return (await this.getTasks()).some(task => task.parentTaskId === taskId)
  }

  async getByPlannedDate(date: ISODate): Promise<Task[]> {
    return (await this.getTasks()).filter(task => task.plannedDate === date)
  }

  async getByDateRange(start: ISODate, end: ISODate): Promise<Task[]> {
    return (await this.getTasks()).filter(task =>
      task.plannedDate !== null && task.plannedDate >= start && task.plannedDate <= end
    )
  }

  async create(task: Task): Promise<UUID> {
    await ensureLegacyTasksMigrated()
    return (await createTask(task)).id
  }

  async update(id: UUID, data: Partial<Task>): Promise<void> {
    await ensureLegacyTasksMigrated()
    await updateTask(id, data)
  }

  async softDelete(id: UUID): Promise<void> {
    await ensureLegacyTasksMigrated()
    await softDeleteTask(id)
  }

  async count(): Promise<number> {
    return (await this.getTasks()).length
  }
}
