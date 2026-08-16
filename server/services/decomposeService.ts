// ============================================================
// Task Decomposition Service — AI 拆解 + 保存 Child Tasks
//
// 链路：decomposeTask → Harness(task-decompose-v2) → Harness(minimum-action-v2)
//        → 构建 child tasks + minimum actions → SQLite atomic transaction
//
// 外部行为（HTTP API / 返回结构 / 幂等）保持与旧 OpenAI 版本一致。
// ============================================================

import { readTasks, readMinActions, readDecompositions, readProjects, atomicWriteAll, type DecompositionRecord } from '../dataStore.ts'
import { runSkill } from '../ai/harness.ts'
import { taskDecomposeV2, type TaskDecomposeOutputV2 } from '../ai/skills/taskDecomposeV2.ts'
import { minimumActionV2, type MinimumActionOutputV2 } from '../ai/skills/minimumActionV2.ts'
import { setProvider, type AiJsonProvider } from '../ai/providers/mimoProvider.ts'
import type { MinimumAction, Task } from '../../src/domain/models.ts'
import type { EnergyLevel } from '../../src/domain/models.ts'

// 测试接缝：注入 fake MiMo provider
export { setProvider }
export type { AiJsonProvider }

// === Types ===

/** 兼容前端的拆解结果结构（should_decompose / minimum_action / subtasks）。 */
export interface AIDecompositionResult {
  should_decompose: boolean
  minimum_action: string
  subtasks: { title: string; minimum_action?: string }[]
}

export interface AIGenerationRecord {
  id: string; taskId: string; generationType: 'task_decomposition'
  originalInput: { title: string; description: string }
  originalOutput: unknown; createdAt: string
}

interface ChildTask {
  id: string; title: string; parentTaskId: string; plannedDate: string | null
  taskKind: 'small'; status: string; estimatedMinutes: number; createdAt: string; updatedAt: string
}

interface MinActionRecord {
  id: string; taskId: string; description: string; estimatedMinutes: number
  difficulty: number; aiGenerated: boolean; status: string
  completedAt: string | null; createdAt: string
}

export interface DecompositionSaveResult {
  decomposition: AIDecompositionResult
  childTasks: ChildTask[]
  minimumActions: MinActionRecord[]
  generation: AIGenerationRecord
}

const DEFAULT_MODEL = 'mimo-v2.5'

// === 幂等：基于持久化 decomposition 记录，而非 children 存在性 ===

function loadCompletedDecomposition(taskId: string): DecompositionSaveResult | null {
  const decomps = readDecompositions()
  const status = decomps.find(d => d.taskId === taskId && d.status === 'completed')
  if (!status) return null

  const tasks = readTasks()
  const children = tasks.filter(task => task.parentTaskId === taskId && !task.deletedAt)

  const mas = readMinActions()
  const taskMas = mas.filter(minimumAction =>
    minimumAction.taskId === taskId || children.some(child => child.id === minimumAction.taskId)
  )

  return {
    decomposition: {
      should_decompose: status.shouldDecompose,
      minimum_action: taskMas.find(minimumAction => minimumAction.taskId === taskId)?.description || '',
      subtasks: children.map(child => ({
        title: child.title,
        minimum_action: taskMas.find(minimumAction => minimumAction.taskId === child.id)?.description || '',
      })),
    },
    childTasks: children.map((c: Task) => ({
      id: c.id, title: c.title, parentTaskId: taskId,
      plannedDate: c.plannedDate, taskKind: 'small', status: c.status,
      estimatedMinutes: c.estimatedMinutes, createdAt: c.createdAt, updatedAt: c.updatedAt,
    })),
    minimumActions: taskMas.map((m: MinimumAction) => ({
      id: m.id, taskId: m.taskId, description: m.description,
      estimatedMinutes: m.estimatedMinutes, difficulty: m.difficulty,
      aiGenerated: m.aiGenerated, status: m.status,
      completedAt: m.completedAt, createdAt: m.createdAt,
    })),
    generation: {
      id: status.id, taskId, generationType: 'task_decomposition',
      originalInput: status.originalInput,
      originalOutput: status.originalOutput,
      createdAt: status.createdAt,
    },
  }
}

// === Core ===

export async function decomposeTask(taskId: string, energyLevel: EnergyLevel = 'medium'): Promise<DecompositionSaveResult> {
  // 幂等：已成功拆解 → 返回已有结果
  const cached = loadCompletedDecomposition(taskId)
  if (cached) return cached

  const tasks = readTasks()
  const parent = tasks.find(task => task.id === taskId && !task.deletedAt)
  if (!parent) throw new Error(`Task ${taskId} not found`)
  if (parent.taskKind !== 'large') throw new Error('AI_DECOMPOSITION_NOT_ALLOWED')

  const input = { title: parent.title, description: parent.description || '' }

  // 1. AI 拆解（task-decompose-v2）—— 网络调用，不在 SQLite 事务内
  const decomposeOutput: TaskDecomposeOutputV2 = await runSkill(taskDecomposeV2, {
    title: parent.title,
    description: parent.description || '',
    estimatedMinutes: parent.estimatedMinutes,
    cognitiveLoad: parent.cognitiveLoad,
    energyDemand: parent.energyDemand,
  })

  // 2. 最小行动（minimum-action-v2，批量一次）—— 网络调用，不在事务内
  const targets = decomposeOutput.shouldDecompose
    ? decomposeOutput.children.map((c, i) => ({ taskRef: `child-${i}`, title: c.title, description: c.description, stageType: c.stageType }))
    : [{ taskRef: 'parent', title: parent.title, description: parent.description || '', stageType: 'activation' as const }]

  // Minimum Action 是非阻塞附加信息：阶段拆解成功时，即使动作生成失败也要保留 Child Tasks。
  // ponytail: 先接受可用动作，后续再做独立的动作质量优化，不让附加字段阻断主流程。
  let actionOutput: MinimumActionOutputV2 = { actions: [] }
  try {
    actionOutput = await runSkill(minimumActionV2, {
      tasks: targets,
      energyLevel,
    })
  } catch {
    actionOutput = { actions: [] }
  }
  const actionByRef = new Map(actionOutput.actions.map(a => [a.taskRef, a]))

  // 3. 构建 child tasks + minimum actions（仅在内存，尚未写入）
  const now = new Date().toISOString()
  const newChildData: Task[] = []
  const childTasks: ChildTask[] = []
  const newMinActions: MinimumAction[] = []

  if (decomposeOutput.shouldDecompose) {
    decomposeOutput.children.forEach((c, i) => {
      const childId = crypto.randomUUID()
      const action = actionByRef.get(`child-${i}`)

      const child: Task = {
        id: childId, title: c.title, description: c.description,
        projectId: parent.projectId, goalId: parent.goalId, keyResultId: parent.keyResultId,
        columnId: null, parentTaskId: taskId,
        taskKind: 'small',
        status: 'todo', userPriority: null, aiPriorityScore: 0, aiPriorityLevel: null, aiPriorityReason: '',
        dueDate: null, plannedDate: parent.plannedDate,
        estimatedMinutes: c.estimatedMinutes, actualMinutes: 0, cognitiveLoad: 'medium', energyDemand: 3,
        recurrenceRule: null, isHabit: false, completedAt: null, order: newChildData.length + 1,
        createdAt: now, updatedAt: now, deletedAt: null,
      }
      newChildData.push(child)
      childTasks.push({
        id: childId, title: c.title, parentTaskId: taskId,
        plannedDate: parent.plannedDate, taskKind: 'small', status: 'todo',
        estimatedMinutes: c.estimatedMinutes, createdAt: now, updatedAt: now,
      })

      if (action) {
        newMinActions.push({
          id: crypto.randomUUID(), taskId: childId,
          description: action.description, estimatedMinutes: action.estimatedMinutes,
          difficulty: action.difficulty, aiGenerated: true,
          status: 'pending', completedAt: null, createdAt: now,
        })
      }
    })
  } else {
    // shouldDecompose=false：为原 Task 生成一个最小行动
    const action = actionByRef.get('parent')
    if (action) {
      newMinActions.push({
        id: crypto.randomUUID(), taskId,
        description: action.description, estimatedMinutes: action.estimatedMinutes,
        difficulty: action.difficulty, aiGenerated: true,
        status: 'pending', completedAt: null, createdAt: now,
      })
    }
  }

  // 4. 构建兼容前端的 decomposition 结构 + 完整 AI generation 记录
  const decomposition: AIDecompositionResult = {
    should_decompose: decomposeOutput.shouldDecompose,
    minimum_action: decomposeOutput.shouldDecompose ? '' : (actionByRef.get('parent')?.description || ''),
    subtasks: decomposeOutput.children.map((c, i) => ({
      title: c.title,
      minimum_action: actionByRef.get(`child-${i}`)?.description || '',
    })),
  }

  const generationOutput = {
    decomposition: decomposeOutput,
    minimumActions: actionOutput,
    skills: {
      decompose: { id: taskDecomposeV2.id, version: taskDecomposeV2.version },
      minimumAction: { id: minimumActionV2.id, version: minimumActionV2.version },
    },
    model: (process.env.MIMO_MODEL || DEFAULT_MODEL),
  }

  const decompRecord: DecompositionRecord = {
    id: crypto.randomUUID(),
    taskId,
    status: 'completed',
    shouldDecompose: decomposeOutput.shouldDecompose,
    originalInput: input,
    originalOutput: generationOutput,
    createdAt: now,
  }

  // 5. 原子写入（SQLite transaction：全部成功才提交）
  atomicWriteAll({
    tasks: [...tasks, ...newChildData],
    minActions: [...readMinActions(), ...newMinActions],
    decompositions: [...readDecompositions(), decompRecord],
    projects: readProjects(),
  })

  // 6. 返回
  const record: AIGenerationRecord = {
    id: decompRecord.id, taskId, generationType: 'task_decomposition',
    originalInput: decompRecord.originalInput,
    originalOutput: decompRecord.originalOutput,
    createdAt: decompRecord.createdAt,
  }

  return { decomposition, childTasks, minimumActions: newMinActions, generation: record }
}
