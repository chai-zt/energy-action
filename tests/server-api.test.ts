import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const verificationDir = join(process.cwd(), 'server', '.verification-data', `api-${Date.now()}`)
mkdirSync(verificationDir, { recursive: true })
process.env.PERSONAL_AI_OS_DATA_DIR = verificationDir
process.env.PERSONAL_AI_OS_TEST = '1'

const { handleRequest } = await import('../server/index.ts')
const { setProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { readDecompositions } = await import('../server/dataStore.ts')

// fake MiMo provider（mock fetch 层，不访问公网）
function fakeProvider({ decompose, minAction, fail }: { decompose?: unknown; minAction?: unknown; fail?: boolean } = {}) {
  return {
    async generateJson(request: { systemPrompt: string }) {
      if (fail) throw new Error('mock provider unavailable')
      if (request.systemPrompt.includes('拆解')) return { text: JSON.stringify(decompose) }
      return { text: JSON.stringify(minAction) }
    },
  }
}

const decompose2 = {
  shouldDecompose: true,
  children: [
    { title: '写项目简介', description: '', estimatedMinutes: 10 },
    { title: '写安装方法', description: '', estimatedMinutes: 10 },
  ],
}
const minAction2 = {
  actions: [
    { taskRef: 'child-0', description: '写一句定位。', estimatedMinutes: 5, difficulty: 1 },
    { taskRef: 'child-1', description: '确认启动命令。', estimatedMinutes: 5, difficulty: 1 },
  ],
}

setProvider(fakeProvider({ decompose: decompose2, minAction: minAction2 }))

const server = createServer(handleRequest)
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

async function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

try {
  const legacyProjectId = `legacy-project-${crypto.randomUUID()}`
  const legacyProjectCreatedAt = '2026-01-02T03:04:05.000Z'
  const createdProject = await request('/projects', 'POST', {
    id: legacyProjectId,
    name: 'Personal AI OS 开发',
    status: 'active',
    progressMode: 'task',
    createdAt: legacyProjectCreatedAt,
    updatedAt: legacyProjectCreatedAt,
  })
  assert.equal(createdProject.status, 201)
  const project = await createdProject.json() as { id: string; name: string; createdAt: string }
  assert.equal(project.id, legacyProjectId)
  assert.equal(project.name, 'Personal AI OS 开发')
  assert.equal(project.createdAt, legacyProjectCreatedAt)

  const renamedProject = await request(`/projects/${project.id}`, 'PATCH', { name: 'Personal AI OS 任务组' })
  assert.equal(renamedProject.status, 200)
  assert.equal((await renamedProject.json() as { name: string }).name, 'Personal AI OS 任务组')
  const projects = await request('/projects')
  assert.equal((await projects.json() as { id: string }[]).some(item => item.id === project.id), true)

  const created = await request('/tasks', 'POST', { title: '写 Personal AI OS README', plannedDate: '2026-08-11', taskKind: 'large' })
  assert.equal(created.status, 201)
  const task = await created.json() as { id: string; title: string }
  assert.equal(task.title, '写 Personal AI OS README')

  const attachedToProject = await request(`/tasks/${task.id}`, 'PATCH', { projectId: project.id })
  assert.equal(attachedToProject.status, 200)
  assert.equal((await attachedToProject.json() as { projectId: string | null }).projectId, project.id)

  const updated = await request(`/tasks/${task.id}`, 'PATCH', { status: 'doing' })
  assert.equal(updated.status, 200)
  assert.equal((await updated.json() as { status: string }).status, 'doing')

  const legacyCreatedAt = '2026-01-02T03:04:05.000Z'
  const legacyTaskId = `legacy-task-${crypto.randomUUID()}`
  const migrated = await request('/tasks', 'POST', {
    id: legacyTaskId,
    title: '迁入的旧任务',
    status: 'done',
    completedAt: legacyCreatedAt,
    createdAt: legacyCreatedAt,
    updatedAt: legacyCreatedAt,
    order: 0,
  })
  assert.equal(migrated.status, 201)
  const migratedTask = await migrated.json() as { id: string; status: string; completedAt: string; createdAt: string }
  assert.equal(migratedTask.id, legacyTaskId)
  assert.equal(migratedTask.status, 'done')
  assert.equal(migratedTask.completedAt, legacyCreatedAt)
  assert.equal(migratedTask.createdAt, legacyCreatedAt)

  const decomposed = await request(`/tasks/${task.id}/decompose`, 'POST')
  assert.equal(decomposed.status, 200)
  const result = await decomposed.json() as { childTasks: { id: string; taskKind: string }[]; minimumActions: { taskId: string }[] }
  assert.equal(result.childTasks.length, 2)
  assert.equal(result.minimumActions.length, 2)
  assert.equal(result.childTasks.every(child => child.taskKind === 'small'), true)
  assert.equal(await request(`/tasks/${task.id}/minimum-action`).then(response => response.json()), null)

  const children = await request(`/tasks?parentTaskId=${task.id}`)
  assert.equal((await children.json() as unknown[]).length, 2)

  const firstChildId = result.childTasks[0].id
  const nestedDecomposition = await request(`/tasks/${firstChildId}/decompose`, 'POST')
  assert.equal(nestedDecomposition.status, 409)
  const nestedChildren = await request(`/tasks?parentTaskId=${firstChildId}`)
  assert.equal((await nestedChildren.json() as unknown[]).length, 0)
  const repeatedNestedDecomposition = await request(`/tasks/${firstChildId}/decompose`, 'POST')
  assert.equal(repeatedNestedDecomposition.status, 409)
  assert.equal((await (await request(`/tasks?parentTaskId=${firstChildId}`)).json() as unknown[]).length, 0)

  setProvider(fakeProvider({
    decompose: { shouldDecompose: false, children: [] },
    minAction: { actions: [{ taskRef: 'parent', description: '打开任务并写下第一句话。', estimatedMinutes: 5, difficulty: 1 }] },
  }))
  const simpleTaskResponse = await request('/tasks', 'POST', { title: '两分钟可以完成的小任务', taskKind: 'small' })
  const simpleTask = await simpleTaskResponse.json() as { id: string }
  const simpleDecomposition = await request(`/tasks/${simpleTask.id}/decompose`, 'POST')
  assert.equal(simpleDecomposition.status, 409)
  assert.equal(await (await request(`/tasks/${simpleTask.id}/minimum-action`)).json(), null)

  setProvider(fakeProvider({ decompose: decompose2, minAction: minAction2 }))

  const minimumAction = await request(`/tasks/${firstChildId}/minimum-action`)
  assert.equal((await minimumAction.json() as { description: string }).description, '写一句定位。')

  const savedMinimumAction = await request(`/tasks/${firstChildId}/minimum-action`, 'PATCH', { description: '改成用户自己的第一步。' })
  assert.equal(savedMinimumAction.status, 200)

  const maintenanceParentResponse = await request('/tasks', 'POST', { title: '可维护任务树父任务' })
  const maintenanceParent = await maintenanceParentResponse.json() as { id: string }
  const firstChildResponse = await request('/tasks', 'POST', { title: '第一项', parentTaskId: maintenanceParent.id })
  const firstChild = await firstChildResponse.json() as { id: string }
  const secondChildResponse = await request('/tasks', 'POST', { title: '第二项', parentTaskId: maintenanceParent.id })
  const secondChild = await secondChildResponse.json() as { id: string }
  const grandchildResponse = await request('/tasks', 'POST', { title: '第二项的下级', parentTaskId: secondChild.id })
  const grandchild = await grandchildResponse.json() as { id: string }
  const renamed = await request(`/tasks/${firstChild.id}`, 'PATCH', { title: '已改名的第一项' })
  assert.equal((await renamed.json() as { title: string }).title, '已改名的第一项')
  const moved = await request(`/tasks/${secondChild.id}/order`, 'PATCH', { direction: 'up' })
  assert.equal((await moved.json() as { moved: boolean }).moved, true)
  const orderedChildren = await request(`/tasks?parentTaskId=${maintenanceParent.id}`)
  assert.equal((await orderedChildren.json() as { id: string }[])[0].id, secondChild.id)
  await request(`/tasks/${grandchild.id}/minimum-action`, 'PATCH', { description: '打开第一份资料。' })

  const recycled = await request(`/tasks/${maintenanceParent.id}`, 'DELETE')
  assert.equal(recycled.status, 200)
  assert.equal((await recycled.json() as { descendantCount: number }).descendantCount, 3)
  assert.equal((await (await request(`/tasks?parentTaskId=${maintenanceParent.id}`)).json() as unknown[]).length, 0)
  assert.equal((await request(`/tasks/${maintenanceParent.id}`)).status, 404)
  const recycleBin = await request('/tasks/recycle-bin')
  assert.equal((await recycleBin.json() as { id: string }[]).some(item => item.id === maintenanceParent.id), true)
  assert.equal(await request(`/tasks/${grandchild.id}/minimum-action`).then(response => response.json()).then((action: unknown) => action), null)
  const restored = await request(`/tasks/${maintenanceParent.id}/restore`, 'POST')
  assert.equal(restored.status, 200)
  assert.equal((await (await request(`/tasks?parentTaskId=${maintenanceParent.id}`)).json() as unknown[]).length, 2)
  assert.equal((await (await request(`/tasks/${grandchild.id}/minimum-action`)).json() as { description: string }).description, '打开第一份资料。')

  const expiredTask = await request('/tasks', 'POST', { title: '过期回收任务', deletedAt: '2026-07-01T00:00:00.000Z' })
  const expiredTaskId = (await expiredTask.json() as { id: string }).id
  await request('/tasks/recycle-bin')
  assert.equal((await (await request('/tasks')).json() as { id: string }[]).some(item => item.id === expiredTaskId), false)

  const decompositions = readDecompositions()
  const originalDecomposition = decompositions.find(item => item.originalInput.title === '写 Personal AI OS README')
  assert.equal(originalDecomposition?.originalInput.title, '写 Personal AI OS README')
  assert.equal((originalDecomposition?.originalOutput as { decomposition: { children: unknown[] } }).decomposition.children.length, 2)

  const deleted = await request(`/tasks/${result.childTasks[0].id}`, 'DELETE')
  assert.equal(deleted.status, 200)
  const childrenAfterDelete = await request(`/tasks?parentTaskId=${task.id}`)
  assert.equal((await childrenAfterDelete.json() as unknown[]).length, 1)

  setProvider(fakeProvider({ fail: true }))
  const failedParent = await request('/tasks', 'POST', { title: '拆解失败也必须保留的任务', taskKind: 'large' })
  const failedParentTask = await failedParent.json() as { id: string }
  const failedDecomposition = await request(`/tasks/${failedParentTask.id}/decompose`, 'POST')
  assert.equal(failedDecomposition.status, 502)
  assert.equal((await request(`/tasks/${failedParentTask.id}`)).status, 200)
  assert.equal((await (await request(`/tasks?parentTaskId=${failedParentTask.id}`)).json() as unknown[]).length, 0)

  const deletedProject = await request(`/projects/${project.id}`, 'DELETE')
  assert.equal(deletedProject.status, 200)
  assert.equal((await request(`/projects/${project.id}`)).status, 404)
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
