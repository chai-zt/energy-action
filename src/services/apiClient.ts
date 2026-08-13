// ============================================================
// API Client — Task Backend 请求层
// ponytail: 最小抽象, 单文件, 复用现有 Task 类型
// ============================================================

import type { MinimumAction, Project, Task } from '@/domain/models'

const BASE_URL = '/api'  // Vite proxy → http://localhost:4001

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `API ${res.status}`)
  }
  return res.json()
}

// === Task API ===

export interface CreateTaskInput {
  id?: string
  title: string
  description?: string
  projectId?: string | null
  goalId?: string | null
  keyResultId?: string | null
  parentTaskId?: string | null
  taskKind?: 'large' | 'small'
  status?: Task['status']
  dueDate?: string | null
  plannedDate?: string | null
  estimatedMinutes?: number
  energyDemand?: number
  isHabit?: boolean
  recurrenceRule?: string | null
}

export async function createTask(data: CreateTaskInput): Promise<Task> {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getAllTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks')
}

export async function getTaskById(id: string): Promise<Task> {
  return request<Task>(`/tasks/${id}`)
}

export async function updateTask(id: string, data: Partial<Task>): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export interface RecycleTaskResult {
  id: string
  descendantCount: number
  deletedTaskIds: string[]
}

export interface RecycledTask extends Task {
  descendantCount: number
}

export async function softDeleteTask(id: string): Promise<RecycleTaskResult> {
  return request<RecycleTaskResult>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function moveTask(id: string, direction: 'up' | 'down'): Promise<{ moved: boolean }> {
  return request<{ moved: boolean }>(`/tasks/${encodeURIComponent(id)}/order`, {
    method: 'PATCH', body: JSON.stringify({ direction }),
  })
}

export async function getRecycledTasks(): Promise<RecycledTask[]> {
  return request<RecycledTask[]>('/tasks/recycle-bin')
}

export async function restoreTask(id: string): Promise<{ id: string; restoredTaskIds: string[] }> {
  return request<{ id: string; restoredTaskIds: string[] }>(`/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

export async function getChildTasks(parentTaskId: string): Promise<Task[]> {
  return request<Task[]>(`/tasks?parentTaskId=${encodeURIComponent(parentTaskId)}`)
}

export async function getMinimumAction(taskId: string): Promise<MinimumAction | null> {
  return request<MinimumAction | null>(`/tasks/${encodeURIComponent(taskId)}/minimum-action`)
}

export interface DecompositionResult {
  decomposition: { should_decompose: boolean; minimum_action: string; subtasks: { title: string; minimum_action?: string }[] }
  childTasks: { id: string; title: string; parentTaskId: string; taskKind: 'small'; plannedDate: string | null; status: string; estimatedMinutes: number }[]
  minimumActions: { id: string; taskId: string; description: string }[]
}

export async function decomposeTask(taskId: string): Promise<DecompositionResult> {
  const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/decompose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    // 区分：404=任务不存在, 其他=AI失败
    if (res.status === 404) throw new Error('TASK_NOT_FOUND')
    throw new Error('AI_DECOMPOSITION_FAILED')
  }
  return res.json()
}

export async function updateMinAction(taskId: string, description: string): Promise<{ taskId: string; description: string }> {
  return request(`/tasks/${encodeURIComponent(taskId)}/minimum-action`, {
    method: 'PATCH',
    body: JSON.stringify({ description }),
  })
}

// === Task group API (Project is the compatible internal model) ===

export async function createProject(project: Project): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify(project) })
}

export async function getAllProjects(): Promise<Project[]> {
  return request<Project[]>('/projects')
}

export async function getProjectById(id: string): Promise<Project> {
  return request<Project>(`/projects/${encodeURIComponent(id)}`)
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  return request<Project>(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function softDeleteProject(id: string): Promise<void> {
  await request<{ id: string }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
