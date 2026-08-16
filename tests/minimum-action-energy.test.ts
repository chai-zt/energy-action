// ============================================================
// S1-D 测试 — Energy-Aware Minimum Action（service 级，fake provider）
//
// 验证：
//   B. AI Flow：low/medium/high 都被 minimum-action-v1 收到（不再固定 medium）
//   C. Regeneration：只调用 minimum-action-v1，不调用 task-decompose-v1，
//      child tasks / decomposition 不变，minimum action 更新并持久化
// ============================================================

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-s1d-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir

const { readTasks, readMinActions, readDecompositions, atomicWriteAll } = await import('../server/dataStore.ts')
const { setProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { decomposeTask } = await import('../server/services/decomposeService.ts')
const { regenerateMinimumAction } = await import('../server/services/minimumActionService.ts')

function makeLargeTask(title: string) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), title, description: '', projectId: null, goalId: null, keyResultId: null,
    columnId: null, parentTaskId: null, taskKind: 'large', status: 'todo', userPriority: null,
    aiPriorityScore: 0, aiPriorityLevel: null, aiPriorityReason: '', dueDate: null, plannedDate: null,
    estimatedMinutes: 30, actualMinutes: 0, cognitiveLoad: 'medium', energyDemand: 3,
    recurrenceRule: null, isHabit: false, completedAt: null, order: 0,
    createdAt: now, updatedAt: now, deletedAt: null,
  }
}

function decomposeProvider() {
  return {
    async generateJson(request: { systemPrompt: string }) {
      if (request.systemPrompt.includes('拆解')) {
        return { text: JSON.stringify({ shouldDecompose: true, children: [
          { title: '第一步', description: '', estimatedMinutes: 10 },
          { title: '第二步', description: '', estimatedMinutes: 10 },
        ] }) }
      }
      return { text: JSON.stringify({ actions: [
        { taskRef: 'child-0', description: '打开文件，写下标题。', estimatedMinutes: 3, difficulty: 1 },
        { taskRef: 'child-1', description: '整理第一段素材。', estimatedMinutes: 3, difficulty: 1 },
      ] }) }
    },
  }
}

describe('S1-D Energy-Aware Minimum Action', () => {
  it('B. energyLevel 传递：low/medium/high 都被 minimum-action-v1 收到（不再固定 medium）', async () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const parent = makeLargeTask(`任务-${level}`)
      atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

      let receivedEnergy: string | null = null
      setProvider({
        async generateJson(request: { systemPrompt: string; userPrompt: string }) {
          if (request.systemPrompt.includes('拆解')) {
            return { text: JSON.stringify({ shouldDecompose: true, children: [
              { title: 'A', description: '', estimatedMinutes: 10 },
            ] }) }
          }
          if (request.userPrompt.includes('当前精力水平：low')) receivedEnergy = 'low'
          else if (request.userPrompt.includes('当前精力水平：medium')) receivedEnergy = 'medium'
          else if (request.userPrompt.includes('当前精力水平：high')) receivedEnergy = 'high'
          return { text: JSON.stringify({ actions: [
            { taskRef: 'child-0', description: '打开文件，写下标题。', estimatedMinutes: 3, difficulty: 1 },
          ] }) }
        },
      })

      await decomposeTask(parent.id, level)
      assert.equal(receivedEnergy, level, `decompose(${level}) 应把 ${level} 传给 minimum-action-v1`)
    }
  })

  it('C. 重新生成：不调用 task-decompose-v1，只调用一次 minimum-action-v1；child / decomposition 不变', async () => {
    const parent = makeLargeTask('拆解后重新生成')
    atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

    setProvider(decomposeProvider())
    await decomposeTask(parent.id, 'low')

    const childIdsBefore = readTasks().filter(t => t.parentTaskId === parent.id).map(t => t.id).sort()
    const decompBefore = readDecompositions()
    assert.equal(childIdsBefore.length, 2)
    assert.equal(decompBefore.length, 1)

    // 重新生成（高精力）
    let decomposeCalls = 0
    let minActionCalls = 0
    setProvider({
      async generateJson(request: { systemPrompt: string }) {
        if (request.systemPrompt.includes('拆解')) {
          decomposeCalls += 1
          return { text: JSON.stringify({ shouldDecompose: true, children: [] }) }
        }
        minActionCalls += 1
        return { text: JSON.stringify({ actions: childIdsBefore.map((_, i) => ({
          taskRef: `child-${i}`, description: '高精力下重新生成的最小行动', estimatedMinutes: 5, difficulty: 2,
        })) }) }
      },
    })

    const result = await regenerateMinimumAction(parent.id, 'high')

    assert.equal(decomposeCalls, 0, '重新生成不得调用 task-decompose-v1')
    assert.equal(minActionCalls, 1, '重新生成只应调用一次 minimum-action-v1')

    // child tasks 不变
    const childIdsAfter = readTasks().filter(t => t.parentTaskId === parent.id).map(t => t.id).sort()
    assert.deepEqual(childIdsAfter, childIdsBefore)

    // decomposition 不变（数量 + id）
    const decompAfter = readDecompositions()
    assert.equal(decompAfter.length, decompBefore.length)
    assert.equal(decompAfter[0].id, decompBefore[0].id)

    // minimum action 更新
    assert.equal(result.minimumActions.length, childIdsBefore.length)
    assert.ok(result.minimumActions.every(a => a.description === '高精力下重新生成的最小行动'))

    // 持久化：reload 后仍是最新内容
    const persisted = readMinActions().filter(a => childIdsBefore.includes(a.taskId))
    assert.equal(persisted.length, childIdsBefore.length)
    assert.ok(persisted.every(a => a.description === '高精力下重新生成的最小行动' && a.estimatedMinutes === 5 && a.difficulty === 2))
  })

  it('C2. 未拆解任务（无 children）也能重新生成自身的最小行动', async () => {
    const parent = makeLargeTask('不拆解的大任务')
    atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

    // shouldDecompose=false：为父任务生成一个最小行动
    setProvider({
      async generateJson(request: { systemPrompt: string }) {
        if (request.systemPrompt.includes('拆解')) {
          return { text: JSON.stringify({ shouldDecompose: false, children: [] }) }
        }
        return { text: JSON.stringify({ actions: [
          { taskRef: 'parent', description: '低精力：打开文件写标题。', estimatedMinutes: 2, difficulty: 1 },
        ] }) }
      },
    })
    await decomposeTask(parent.id, 'low')
    const decompBefore = readDecompositions()

    // 重新生成（高精力）→ 应只针对 parent 本身
    let minActionCalls = 0
    setProvider({
      async generateJson(request: { systemPrompt: string }) {
        if (request.systemPrompt.includes('拆解')) return { text: JSON.stringify({ shouldDecompose: false, children: [] }) }
        minActionCalls += 1
        return { text: JSON.stringify({ actions: [
          { taskRef: 'parent', description: '高精力：先写第一段正文。', estimatedMinutes: 8, difficulty: 3 },
        ] }) }
      },
    })
    const result = await regenerateMinimumAction(parent.id, 'high')

    assert.equal(minActionCalls, 1)
    assert.equal(result.minimumActions.length, 1)
    assert.equal(result.minimumActions[0].taskId, parent.id)
    assert.equal(result.minimumActions[0].description, '高精力：先写第一段正文。')
    assert.equal(readDecompositions().length, decompBefore.length)
  })
})
