// ============================================================
// Personal AI OS Backend — Entry Point
// Node.js 22 built-in http — zero external dependencies
// ============================================================

import { createServer } from 'node:http'
import { atomicWriteAll, purgeExpiredRecycleBin, readDecompositions, readMinActions, readProjects, readTasks } from './dataStore.ts'
import { decomposeTask } from './services/decomposeService.ts'
import { handleAiConfigRequest } from './ai/configApi.ts'
import { getAiAvailability } from './ai/availability.ts'
import { buildProviderFromConfig } from './ai/providers/providerFactory.ts'
import { setResolvedProvider, hasExplicitProvider, AiError } from './ai/providers/mimoProvider.ts'
import { decomposeLimiter } from './security/rateLimit.ts'
import type { Task } from '../src/domain/models.ts'

const PORT = parseInt(process.env.PORT || '4001', 10)
function writeTasks(tasks: ReturnType<typeof readTasks>) {
  atomicWriteAll({ tasks, minActions: readMinActions(), decompositions: readDecompositions(), projects: readProjects() })
}

function writeMinActions(minActions: ReturnType<typeof readMinActions>) {
  atomicWriteAll({ tasks: readTasks(), minActions, decompositions: readDecompositions(), projects: readProjects() })
}

function writeProjects(projects: ReturnType<typeof readProjects>) {
  atomicWriteAll({ tasks: readTasks(), minActions: readMinActions(), decompositions: readDecompositions(), projects })
}

// ponytail: 文件读写够用, 升级路径: 替换为 pg pool

// === CORS（仅本地前端 origin，不回显 *）===
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Energy-Action-Session',
  }
}

// === 请求体解析（累计 byte 上限，防止无界读取）===
const MAX_TASK_BODY_BYTES = 1024 * 1024 // 1 MB（通用任务/项目 body）
function parseBody(req: any, maxBytes = MAX_TASK_BODY_BYTES): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > maxBytes) { reject(new Error('BODY_TOO_LARGE')); return }
      const body = Buffer.concat(chunks).toString('utf-8')
      try { resolve(body ? JSON.parse(body) : {}) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function getTaskTreeIds(tasks: Task[], rootTaskId: string): string[] {
  const taskIds = new Set([rootTaskId])
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (!task.deletedAt && task.parentTaskId && taskIds.has(task.parentTaskId) && !taskIds.has(task.id)) {
        taskIds.add(task.id)
        changed = true
      }
    }
  }
  return [...taskIds]
}

function getRecycledRoots(tasks: Task[]): Task[] {
  return tasks.filter(task => {
    if (!task.deletedAt) return false
    const parent = task.parentTaskId ? tasks.find(item => item.id === task.parentTaskId) : undefined
    return !parent?.deletedAt || parent.recycleBatchId !== task.recycleBatchId
  })
}

// === 路由 ===
async function handleRequest(req: any, res: any): Promise<void> {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const headers = { 'Content-Type': 'application/json', ...corsHeaders() }

  // === /ai/* 模型配置中心（含敏感 API 守卫 / session / SSRF）===
  if (await handleAiConfigRequest(req, res, PORT)) return

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers); res.end(); return
  }

  purgeExpiredRecycleBin()

  // === POST /projects (任务组；保留 Project 为兼容数据模型) ===
  if (req.method === 'POST' && url.pathname === '/projects') {
    try {
      const body = await parseBody(req)
      if (typeof body.name !== 'string' || !body.name.trim()) {
        res.writeHead(400, headers)
        res.end(JSON.stringify({ error: 'name is required' })); return
      }
      const now = new Date().toISOString()
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID()
      const projects = readProjects()
      if (projects.some((project: any) => project.id === id)) {
        res.writeHead(409, headers)
        res.end(JSON.stringify({ error: 'PROJECT_ALREADY_EXISTS' })); return
      }
      const project = {
        id, name: body.name.trim(), description: typeof body.description === 'string' ? body.description : '',
        goalId: body.goalId || null, keyResultId: body.keyResultId || null,
        status: body.status || 'active', priority: typeof body.priority === 'number' ? body.priority : 0,
        startDate: body.startDate || null, dueDate: body.dueDate || null,
        progress: typeof body.progress === 'number' ? body.progress : 0,
        progressMode: body.progressMode || 'task', color: body.color || '#3b82f6', icon: body.icon || 'FolderKanban',
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : now,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : now,
        deletedAt: typeof body.deletedAt === 'string' ? body.deletedAt : null,
        completedAt: typeof body.completedAt === 'string' ? body.completedAt : null,
      }
      projects.push(project)
      writeProjects(projects)
      res.writeHead(201, headers)
      res.end(JSON.stringify(project))
    } catch (err: any) {
      res.writeHead(400, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === GET /projects ===
  if (req.method === 'GET' && url.pathname === '/projects') {
    const goalId = url.searchParams.get('goalId')
    let projects = readProjects().filter((project: any) => !project.deletedAt)
    if (goalId) projects = projects.filter((project: any) => project.goalId === goalId)
    res.writeHead(200, headers)
    res.end(JSON.stringify(projects))
    return
  }

  const projectIdMatch = url.pathname.match(/^\/projects\/([^/]+)$/)

  // === GET /projects/:id ===
  if (req.method === 'GET' && projectIdMatch) {
    const project = readProjects().find((item: any) => item.id === projectIdMatch[1] && !item.deletedAt)
    if (!project) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'PROJECT_NOT_FOUND' })); return }
    res.writeHead(200, headers)
    res.end(JSON.stringify(project))
    return
  }

  // === PATCH /projects/:id ===
  if (req.method === 'PATCH' && projectIdMatch) {
    try {
      const body = await parseBody(req)
      const projects = readProjects()
      const index = projects.findIndex((project: any) => project.id === projectIdMatch[1] && !project.deletedAt)
      if (index === -1) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'PROJECT_NOT_FOUND' })); return }
      if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) {
        res.writeHead(400, headers); res.end(JSON.stringify({ error: 'name must be a non-empty string' })); return
      }
      const editableFields = ['name', 'description', 'goalId', 'keyResultId', 'status', 'priority', 'startDate', 'dueDate', 'progress', 'progressMode', 'color', 'icon', 'completedAt']
      const updates = Object.fromEntries(editableFields
        .filter(field => Object.prototype.hasOwnProperty.call(body, field))
        .map(field => [field, field === 'name' ? body[field].trim() : body[field]]))
      const updated = { ...projects[index], ...updates, id: projects[index].id, createdAt: projects[index].createdAt, updatedAt: new Date().toISOString() }
      projects[index] = updated
      writeProjects(projects)
      res.writeHead(200, headers)
      res.end(JSON.stringify(updated))
    } catch (err: any) {
      res.writeHead(400, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === DELETE /projects/:id (soft delete) ===
  if (req.method === 'DELETE' && projectIdMatch) {
    const projects = readProjects()
    const index = projects.findIndex((project: any) => project.id === projectIdMatch[1] && !project.deletedAt)
    if (index === -1) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'PROJECT_NOT_FOUND' })); return }
    const deletedAt = new Date().toISOString()
    projects[index] = { ...projects[index], deletedAt, updatedAt: deletedAt }
    writeProjects(projects)
    res.writeHead(200, headers)
    res.end(JSON.stringify({ id: projects[index].id }))
    return
  }

  // === POST /tasks ===
  if (req.method === 'POST' && url.pathname === '/tasks') {
    try {
      const body = await parseBody(req)
      if (!body.title || !body.title.trim()) {
        res.writeHead(400, headers)
        res.end(JSON.stringify({ error: 'title is required' })); return
      }

      const now = new Date().toISOString()
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID()
      const tasks = readTasks()
      if (tasks.some((task: any) => task.id === id)) {
        res.writeHead(409, headers)
        res.end(JSON.stringify({ error: 'TASK_ALREADY_EXISTS' })); return
      }
      const task = {
        id,
        title: body.title.trim(),
        description: body.description || '',
        projectId: body.projectId || null,
        goalId: body.goalId || null,
        keyResultId: body.keyResultId || null,
        columnId: body.columnId || null,
        parentTaskId: body.parentTaskId || null,
        taskKind: body.taskKind === 'large' || body.taskKind === 'small' ? body.taskKind : undefined,
        status: body.status || 'todo',
        userPriority: body.userPriority || null,
        aiPriorityScore: body.aiPriorityScore || 0,
        aiPriorityLevel: body.aiPriorityLevel || null,
        aiPriorityReason: body.aiPriorityReason || '',
        dueDate: body.dueDate || null,
        plannedDate: body.plannedDate || null,
        estimatedMinutes: body.estimatedMinutes || 0,
        actualMinutes: body.actualMinutes || 0,
        cognitiveLoad: body.cognitiveLoad || 'medium',
        energyDemand: body.energyDemand || 3,
        recurrenceRule: body.recurrenceRule || null,
        isHabit: body.isHabit || false,
        completedAt: typeof body.completedAt === 'string' ? body.completedAt : null,
        order: typeof body.order === 'number'
          ? body.order
          : Math.max(0, ...tasks.filter((item: Task) => !item.deletedAt && item.parentTaskId === (body.parentTaskId || null)).map(item => item.order + 1)),
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : now,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : now,
        deletedAt: typeof body.deletedAt === 'string' ? body.deletedAt : null,
      }

      tasks.push(task)
      writeTasks(tasks)

      res.writeHead(201, headers)
      res.end(JSON.stringify(task))
    } catch (err: any) {
      res.writeHead(400, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === GET /tasks/:taskId/minimum-action ===
  const minimumActionMatch = url.pathname.match(/^\/tasks\/([^/]+)\/minimum-action$/)
  if (req.method === 'GET' && minimumActionMatch) {
    const action = readMinActions().find((item: any) => item.taskId === minimumActionMatch[1] && !item.deletedAt) || null
    res.writeHead(200, headers)
    res.end(JSON.stringify(action))
    return
  }

  // === GET /tasks ===
  if (req.method === 'GET' && url.pathname === '/tasks') {
    const parentTaskId = url.searchParams.get('parentTaskId')
    let tasks = readTasks().filter((t: any) => !t.deletedAt)
    if (parentTaskId) {
      tasks = tasks.filter((t: any) => t.parentTaskId === parentTaskId).sort((left: Task, right: Task) => left.order - right.order)
    }
    res.writeHead(200, headers)
    res.end(JSON.stringify(tasks))
    return
  }

  // === GET /tasks/recycle-bin ===
  if (req.method === 'GET' && url.pathname === '/tasks/recycle-bin') {
    const tasks = readTasks()
    const recycled = getRecycledRoots(tasks).map(task => ({
      ...task,
      descendantCount: tasks.filter(item => item.recycleBatchId === task.recycleBatchId && item.id !== task.id).length,
    })).sort((left, right) => (right.deletedAt || '').localeCompare(left.deletedAt || ''))
    res.writeHead(200, headers)
    res.end(JSON.stringify(recycled))
    return
  }

  const restoreTaskMatch = url.pathname.match(/^\/tasks\/([^/]+)\/restore$/)
  if (req.method === 'POST' && restoreTaskMatch) {
    const tasks = readTasks()
    const root = tasks.find(task => task.id === restoreTaskMatch[1] && task.deletedAt)
    if (!root) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'RECYCLED_TASK_NOT_FOUND' })); return }
    const batchId = root.recycleBatchId
    const taskIds = tasks.filter(task => task.id === root.id || (batchId && task.recycleBatchId === batchId)).map(task => task.id)
    const restoredAt = new Date().toISOString()
    const restoredTasks = tasks.map(task => taskIds.includes(task.id)
      ? { ...task, deletedAt: null, recycleBatchId: null, updatedAt: restoredAt }
      : task)
    const restoredActions = readMinActions().map(action => taskIds.includes(action.taskId)
      ? { ...action, deletedAt: null, recycleBatchId: null }
      : action)
    atomicWriteAll({ tasks: restoredTasks, minActions: restoredActions, decompositions: readDecompositions(), projects: readProjects() })
    res.writeHead(200, headers)
    res.end(JSON.stringify({ id: root.id, restoredTaskIds: taskIds }))
    return
  }

  const reorderTaskMatch = url.pathname.match(/^\/tasks\/([^/]+)\/order$/)
  if (req.method === 'PATCH' && reorderTaskMatch) {
    try {
      const body = await parseBody(req)
      if (body.direction !== 'up' && body.direction !== 'down') {
        res.writeHead(400, headers); res.end(JSON.stringify({ error: 'direction must be up or down' })); return
      }
      const tasks = readTasks()
      const task = tasks.find(item => item.id === reorderTaskMatch[1] && !item.deletedAt)
      if (!task) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'TASK_NOT_FOUND' })); return }
      const siblings = tasks.filter(item => !item.deletedAt && item.parentTaskId === task.parentTaskId)
        .sort((left, right) => left.order - right.order)
      const index = siblings.findIndex(item => item.id === task.id)
      const target = siblings[index + (body.direction === 'up' ? -1 : 1)]
      if (!target) { res.writeHead(200, headers); res.end(JSON.stringify({ moved: false })); return }
      const updatedAt = new Date().toISOString()
      const updatedTasks = tasks.map(item => {
        if (item.id === task.id) return { ...item, order: target.order, updatedAt }
        if (item.id === target.id) return { ...item, order: task.order, updatedAt }
        return item
      })
      writeTasks(updatedTasks)
      res.writeHead(200, headers)
      res.end(JSON.stringify({ moved: true }))
    } catch (err: any) {
      res.writeHead(400, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === GET /tasks/:id ===
  const taskIdMatch = url.pathname.match(/^\/tasks\/([^/]+)$/)
  if (req.method === 'GET' && taskIdMatch) {
    const tasks = readTasks()
    const task = tasks.find((t: any) => t.id === taskIdMatch[1] && !t.deletedAt)
    if (!task) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'not found' })); return }
    res.writeHead(200, headers)
    res.end(JSON.stringify(task))
    return
  }

  // === PATCH /tasks/:taskId ===
  if (req.method === 'PATCH' && taskIdMatch) {
    try {
      const taskId = taskIdMatch[1]
      const body = await parseBody(req)
      const tasks = readTasks()
      const index = tasks.findIndex((task: any) => task.id === taskId && !task.deletedAt)
      if (index === -1) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'TASK_NOT_FOUND' })); return }
      if ('title' in body && (typeof body.title !== 'string' || !body.title.trim())) {
        res.writeHead(400, headers); res.end(JSON.stringify({ error: 'title must be a non-empty string' })); return
      }

      const editableFields = [
        'title', 'description', 'projectId', 'goalId', 'keyResultId', 'columnId', 'parentTaskId', 'taskKind',
        'status', 'userPriority', 'aiPriorityScore', 'aiPriorityLevel', 'aiPriorityReason', 'dueDate',
        'plannedDate', 'estimatedMinutes', 'actualMinutes', 'cognitiveLoad', 'energyDemand',
        'recurrenceRule', 'isHabit', 'completedAt', 'order',
      ]
      const updates = Object.fromEntries(editableFields
        .filter(field => Object.prototype.hasOwnProperty.call(body, field))
        .map(field => [field, field === 'title' ? body[field].trim() : body[field]]))
      const updated = { ...tasks[index], ...updates, id: tasks[index].id, createdAt: tasks[index].createdAt, updatedAt: new Date().toISOString() }
      tasks[index] = updated
      writeTasks(tasks)
      res.writeHead(200, headers)
      res.end(JSON.stringify(updated))
    } catch (err: any) {
      res.writeHead(400, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === DELETE /tasks/:taskId (cascade recycle) ===
  if (req.method === 'DELETE' && taskIdMatch) {
    const tasks = readTasks()
    const task = tasks.find(task => task.id === taskIdMatch[1] && !task.deletedAt)
    if (!task) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'TASK_NOT_FOUND' })); return }
    const deletedAt = new Date().toISOString()
    const recycleBatchId = crypto.randomUUID()
    const deletedTaskIds = getTaskTreeIds(tasks, task.id)
    const deletedTasks = tasks.map(item => deletedTaskIds.includes(item.id)
      ? { ...item, deletedAt, recycleBatchId, updatedAt: deletedAt }
      : item)
    const deletedActions = readMinActions().map(action => deletedTaskIds.includes(action.taskId)
      ? { ...action, deletedAt, recycleBatchId }
      : action)
    atomicWriteAll({ tasks: deletedTasks, minActions: deletedActions, decompositions: readDecompositions(), projects: readProjects() })
    res.writeHead(200, headers)
    res.end(JSON.stringify({ id: task.id, descendantCount: deletedTaskIds.length - 1, deletedTaskIds }))
    return
  }

  // === PATCH /tasks/:taskId/minimum-action ===
  const minActionPatchMatch = url.pathname.match(/^\/tasks\/(.+)\/minimum-action$/)
  if (req.method === 'PATCH' && minActionPatchMatch) {
    try {
      const taskId = minActionPatchMatch[1]
      const body = await parseBody(req)
      const description = typeof body.description === 'string' ? body.description.trim() : null
      if (description === null && body.description !== '') {
        res.writeHead(400, headers)
        res.end(JSON.stringify({ error: 'description must be a string' })); return
      }
      if (!readTasks().some((task: any) => task.id === taskId && !task.deletedAt)) {
        res.writeHead(404, headers)
        res.end(JSON.stringify({ error: 'TASK_NOT_FOUND' })); return
      }
      const actions = readMinActions()
      const idx = actions.findIndex((a: any) => a.taskId === taskId && !a.deletedAt)
      if (description) {
        // 有内容：创建或更新
        if (idx === -1) {
          actions.push({
            id: crypto.randomUUID?.() || `${taskId}-ma`,
            taskId, description,
            estimatedMinutes: 5, difficulty: 1, aiGenerated: true,
            status: 'pending', completedAt: null, createdAt: new Date().toISOString(),
          })
        } else {
          actions[idx].description = description
        }
      } else {
        // 空内容：删除
        if (idx !== -1) actions.splice(idx, 1)
      }
      writeMinActions(actions)
      res.writeHead(200, headers)
      res.end(JSON.stringify({ taskId, description: description || '' }))
    } catch (err: any) {
      res.writeHead(500, headers)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // === POST /tasks/:taskId/decompose ===
  const decomposeMatch = url.pathname.match(/^\/tasks\/(.+)\/decompose$/)
  if (req.method === 'POST' && decomposeMatch) {
    // 限流（10/min）
    if (!decomposeLimiter.allow('decompose')) {
      res.writeHead(429, headers)
      res.end(JSON.stringify({ error: 'RATE_LIMITED' }))
      return
    }
    // 非测试注入场景：AI 可用性检查 + 从本地 Config/Secret 解析 Provider
    if (!hasExplicitProvider()) {
      const availability = await getAiAvailability()
      if (!availability.available) {
        res.writeHead(503, headers)
        res.end(JSON.stringify({ error: 'AI_UNAVAILABLE', reason: availability.reason }))
        return
      }
      const provider = await buildProviderFromConfig()
      if (!provider) {
        res.writeHead(503, headers)
        res.end(JSON.stringify({ error: 'AI_UNAVAILABLE', reason: 'no_secret' }))
        return
      }
      setResolvedProvider(provider)
    }

    try {
      const data = await decomposeTask(decomposeMatch[1])
      res.writeHead(200, headers)
      res.end(JSON.stringify(data))
    } catch (err: any) {
      // 认证失败（401/403）→ 立即 verified=false
      if (err instanceof AiError && (err.status === 401 || err.status === 403)) {
        const { updateVerificationStatus } = await import('./ai/providerConfig.ts')
        updateVerificationStatus('failed')
      }
      // 区分：404 任务不存在 / 422 AI输出非法 / 502 AI服务不可用
      if (err.message?.includes('not found')) {
        res.writeHead(404, headers)
        res.end(JSON.stringify({ error: 'TASK_NOT_FOUND', detail: err.message }))
      } else if (err.name === 'ValidationError') {
        res.writeHead(422, headers)
        res.end(JSON.stringify({ error: 'AI_DECOMPOSITION_FAILED', detail: err.message }))
      } else if (err.message === 'AI_DECOMPOSITION_NOT_ALLOWED') {
        res.writeHead(409, headers)
        res.end(JSON.stringify({ error: 'AI_DECOMPOSITION_NOT_ALLOWED' }))
      } else {
        res.writeHead(502, headers)
        res.end(JSON.stringify({ error: 'AI_DECOMPOSITION_FAILED', detail: err.message }))
      }
    }
    return
  }

  // 404
  res.writeHead(404, headers)
  res.end(JSON.stringify({ error: 'not found' }))
}

// === 启动 ===
export { handleRequest }

if (!process.env.PERSONAL_AI_OS_TEST) {
  const server = createServer(handleRequest)
  // P0 安全：只绑定 loopback，禁止 0.0.0.0 / LAN 暴露
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Backend] Energy Action API running on http://127.0.0.1:${PORT}`)
  })
}
