// ============================================================
// Energy Action Community — SQLite Persistence 测试
//
// 覆盖：自动建表 / Task CRUD / parent-child / MinimumAction /
//       Decomposition / 幂等 / Project 兼容 / transaction 回滚 /
//       restart 持久化 / 删除后重新初始化。
//
// 使用临时 DB（os.tmpdir 下独立目录），不污染 server/.data/energy-action.db。
// ============================================================

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-test-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir

const { readTasks, readMinActions, readDecompositions, readProjects, atomicWriteAll } = await import('../server/dataStore.ts')
const { getDb, closeDb, transaction, dbPath } = await import('../server/db/sqlite.ts')
const { setProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { decomposeTask } = await import('../server/services/decomposeService.ts')

// === helpers ===

let seq = 0
function makeId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function makeTask(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: makeId('task'),
    title: '测试任务',
    description: '',
    projectId: null,
    goalId: null,
    keyResultId: null,
    columnId: null,
    parentTaskId: null,
    status: 'todo',
    userPriority: null,
    aiPriorityScore: 0,
    aiPriorityLevel: null,
    aiPriorityReason: '',
    dueDate: null,
    plannedDate: null,
    estimatedMinutes: 0,
    actualMinutes: 0,
    cognitiveLoad: 'medium',
    energyDemand: 3,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    order: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

function makeMinAction(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: makeId('ma'),
    taskId: 'task-unknown',
    description: '最小行动',
    estimatedMinutes: 5,
    difficulty: 1,
    aiGenerated: true,
    status: 'pending',
    completedAt: null,
    createdAt: now,
    ...overrides,
  }
}

function makeDecomp(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: makeId('decomp'),
    taskId: 'task-unknown',
    status: 'completed',
    shouldDecompose: true,
    originalInput: { title: '标题', description: '' },
    originalOutput: { should_decompose: true, minimum_action: '', subtasks: [] },
    createdAt: now,
    ...overrides,
  }
}

function makeProject(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: makeId('project'),
    name: '测试项目',
    description: '',
    goalId: null,
    keyResultId: null,
    status: 'active',
    priority: 0,
    startDate: null,
    dueDate: null,
    progress: 0,
    progressMode: 'task',
    color: '#3b82f6',
    icon: 'FolderKanban',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    completedAt: null,
    ...overrides,
  }
}

describe('SQLite persistence', () => {
  it('1. fresh DB 自动建表（首次读取即建库建表）', () => {
    assert.equal(readTasks().length, 0)
    assert.equal(readMinActions().length, 0)
    assert.equal(readDecompositions().length, 0)
    assert.equal(readProjects().length, 0)
    assert.equal(existsSync(dbPath()), true)
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','minimum_actions','task_decompositions','projects') ORDER BY name").all() as { name: string }[]
    assert.deepEqual(tables.map(t => t.name), ['minimum_actions', 'projects', 'task_decompositions', 'tasks'])
  })

  it('2. create Task → read Task', () => {
    const t = makeTask({ title: '写 README' })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [], projects: [] })
    const read = readTasks()
    assert.equal(read.length, 1)
    assert.equal(read[0].id, t.id)
    assert.equal(read[0].title, '写 README')
  })

  it('3. update Task', () => {
    const t = makeTask({ title: '旧标题' })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [], projects: [] })
    const updated = { ...t, title: '新标题', status: 'doing' }
    atomicWriteAll({ tasks: [updated], minActions: [], decompositions: [], projects: [] })
    const read = readTasks()
    assert.equal(read.length, 1)
    assert.equal(read[0].title, '新标题')
    assert.equal(read[0].status, 'doing')
  })

  it('4. completed Task 状态可保存', () => {
    const doneAt = '2026-08-13T08:00:00.000Z'
    const t = makeTask({ title: '已完成任务', status: 'done', completedAt: doneAt })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [], projects: [] })
    const read = readTasks().find(x => x.id === t.id)
    assert.equal(read?.status, 'done')
    assert.equal(read?.completedAt, doneAt)
  })

  it('5. parent/child Task 保存', () => {
    const parent = makeTask({ title: '父任务', taskKind: 'large' })
    const child = makeTask({ title: '子任务', parentTaskId: parent.id, taskKind: 'small' })
    atomicWriteAll({ tasks: [parent, child], minActions: [], decompositions: [], projects: [] })
    const children = readTasks().filter(t => t.parentTaskId === parent.id)
    assert.equal(children.length, 1)
    assert.equal(children[0].title, '子任务')
    assert.equal(children[0].taskKind, 'small')
  })

  it('6. MinimumAction save/read/update', () => {
    const t = makeTask({ title: '有最小行动的任务' })
    const ma = makeMinAction({ taskId: t.id, description: '第一步' })
    atomicWriteAll({ tasks: [t], minActions: [ma], decompositions: [], projects: [] })
    assert.equal(readMinActions().find(m => m.taskId === t.id)?.description, '第一步')

    const updated = { ...ma, description: '改过的第一步' }
    atomicWriteAll({ tasks: [t], minActions: [updated], decompositions: [], projects: [] })
    assert.equal(readMinActions().find(m => m.taskId === t.id)?.description, '改过的第一步')
  })

  it('7. Decomposition save/read（originalInput/originalOutput 还原）', () => {
    const t = makeTask({ title: '拆解任务', taskKind: 'large' })
    const d = makeDecomp({
      taskId: t.id,
      originalInput: { title: '拆解任务', description: '描述' },
      originalOutput: { should_decompose: true, minimum_action: '', subtasks: [{ title: '子1', minimum_action: 'a' }, { title: '子2', minimum_action: 'b' }] },
    })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [d], projects: [] })
    const read = readDecompositions().find(x => x.taskId === t.id)
    assert.equal(read?.shouldDecompose, true)
    assert.equal((read?.originalInput as { title: string }).title, '拆解任务')
    assert.equal((read?.originalOutput as { subtasks: unknown[] }).subtasks.length, 2)
  })

  it('8. decomposition 幂等行为保持（重复调用不重复创建、不重复调 provider）', async () => {
    const parent = makeTask({ title: '幂等大任务', taskKind: 'large' })
    atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

    let providerCalls = 0
    setProvider({
      async generateJson(request: { systemPrompt: string }) {
        providerCalls += 1
        if (request.systemPrompt.includes('拆解')) {
          return { text: JSON.stringify({ shouldDecompose: true, children: [
            { title: '子A', description: '', estimatedMinutes: 5 },
            { title: '子B', description: '', estimatedMinutes: 5 },
          ] }) }
        }
        return { text: JSON.stringify({ actions: [
          { taskRef: 'child-0', description: '做A', estimatedMinutes: 3, difficulty: 1 },
          { taskRef: 'child-1', description: '做B', estimatedMinutes: 3, difficulty: 1 },
        ] }) }
      },
    })

    const first = await decomposeTask(parent.id)
    const firstChildIds = first.childTasks.map(c => c.id).sort()
    const callsAfterFirst = providerCalls

    const second = await decomposeTask(parent.id)
    const secondChildIds = second.childTasks.map(c => c.id).sort()

    // 第一次拆解 = 2 次 AI 调用（拆解 + 最小行动）
    assert.equal(callsAfterFirst, 2)
    // 第二次调用不再调 AI（幂等），provider 调用次数不变
    assert.equal(providerCalls, callsAfterFirst)
    assert.deepEqual(secondChildIds, firstChildIds)
    assert.equal(readTasks().filter(t => t.parentTaskId === parent.id).length, 2)
  })

  it('9. Project 兼容', () => {
    const p = makeProject({ name: '开源项目' })
    atomicWriteAll({ tasks: [], minActions: [], decompositions: [], projects: [p] })
    const read = readProjects()
    assert.equal(read.length, 1)
    assert.equal(read[0].name, '开源项目')
    assert.equal(read[0].status, 'active')
  })

  it('10. transaction 回滚（中途失败不留半套数据）', () => {
    const before = readTasks().length
    assert.throws(() => {
      transaction(() => {
        const db = getDb()
        db.prepare("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('rollback-task', '回滚任务', 'now', 'now')").run()
        db.prepare("INSERT INTO task_decompositions (id, task_id, status, should_decompose, original_input, original_output, created_at) VALUES ('rollback-decomp', 'rollback-task', 'completed', 1, '{}', '{}', 'now')").run()
        throw new Error('forced failure mid-transaction')
      })
    })
    // 半套数据必须被回滚
    assert.equal(readTasks().filter(t => t.id === 'rollback-task').length, 0)
    assert.equal(readDecompositions().filter(d => d.id === 'rollback-decomp').length, 0)
    assert.equal(readTasks().length, before)
  })

  it('11. restart persistence（关闭 DB 重新打开后数据仍存在）', () => {
    const t = makeTask({ title: '重启后仍在的任务' })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [], projects: [] })
    closeDb()
    assert.equal(readTasks().filter(x => x.id === t.id).length, 1)
  })

  it('12. 删除测试数据库后可以重新初始化', () => {
    const t = makeTask({ title: '待删除库里的任务' })
    atomicWriteAll({ tasks: [t], minActions: [], decompositions: [], projects: [] })
    closeDb()
    rmSync(dbPath(), { force: true })
    rmSync(dbPath() + '-wal', { force: true })
    rmSync(dbPath() + '-shm', { force: true })
    assert.equal(readTasks().length, 0)
    assert.equal(existsSync(dbPath()), true)
  })
})
