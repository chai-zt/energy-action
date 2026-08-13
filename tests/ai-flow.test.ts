// ============================================================
// AI Flow 测试 — decomposeService 全链路（fake MiMo provider）
//
// 验证：Harness(task-decompose-v1) → Harness(minimum-action-v1)
//        → SQLite 保存 → 幂等。
// ============================================================

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-flow-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir

const { readTasks, readMinActions, readDecompositions, atomicWriteAll } = await import('../server/dataStore.ts')
const { setProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { decomposeTask } = await import('../server/services/decomposeService.ts')

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

describe('AI Flow（fake MiMo provider）', () => {
  it('一次拆解 = 1 decomposition + N children + N minimum actions；重复调用幂等', async () => {
    const parent = makeLargeTask('准备一次 10 分钟的项目演示')
    atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

    let decomposeCalls = 0
    let minActionCalls = 0
    setProvider({
      async generateJson(request: { systemPrompt: string }) {
        if (request.systemPrompt.includes('拆解')) {
          decomposeCalls += 1
          return { text: JSON.stringify({ shouldDecompose: true, children: [
            { title: '写演示大纲', description: '列出要点', estimatedMinutes: 15 },
            { title: '准备演示材料', description: '整理 PPT', estimatedMinutes: 10 },
            { title: '预演一遍', description: '计时讲一遍', estimatedMinutes: 10 },
          ] }) }
        }
        minActionCalls += 1
        return { text: JSON.stringify({ actions: [
          { taskRef: 'child-0', description: '打开文档，写下第一版演示大纲。', estimatedMinutes: 3, difficulty: 1 },
          { taskRef: 'child-1', description: '打开 PPT，新建第一页。', estimatedMinutes: 3, difficulty: 1 },
          { taskRef: 'child-2', description: '打开计时器，先讲开场白。', estimatedMinutes: 3, difficulty: 1 },
        ] }) }
      },
    })

    const first = await decomposeTask(parent.id)
    const firstChildIds = first.childTasks.map(c => c.id).sort()

    // AI 调用次数：1 次拆解 + 1 次批量最小行动
    assert.equal(decomposeCalls, 1)
    assert.equal(minActionCalls, 1)

    // 保存结果
    assert.equal(readDecompositions().length, 1)
    assert.equal(readTasks().filter(t => t.parentTaskId === parent.id).length, 3)
    assert.equal(readMinActions().length, 3)

    // 返回结构
    assert.equal(first.childTasks.length, 3)
    assert.equal(first.minimumActions.length, 3)
    assert.equal(first.decomposition.should_decompose, true)

    // 幂等：重复调用不再次调 AI，child ID 不变
    const second = await decomposeTask(parent.id)
    const secondChildIds = second.childTasks.map(c => c.id).sort()
    assert.equal(decomposeCalls, 1)
    assert.equal(minActionCalls, 1)
    assert.deepEqual(secondChildIds, firstChildIds)
    assert.equal(readTasks().filter(t => t.parentTaskId === parent.id).length, 3)
  })
})
