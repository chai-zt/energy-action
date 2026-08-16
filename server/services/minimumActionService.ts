// ============================================================
// Minimum Action Regeneration Service — S1-D
//
// 单一用途：用户修改当前精力后，只重新生成"最小行动"。
//
// 硬约束：
//   - 只调用 minimum-action-v2（一次批量）。
//   - 绝不调用 task-decompose-v2、绝不重建 Child Tasks、绝不覆盖 decomposition。
//   - 目标 = 该任务已有的 Child Tasks（若有），否则任务本身。
//   - 只写 minimum_actions，不触碰 tasks / task_decompositions / projects。
// ============================================================

import { readTasks, readMinActions, readDecompositions, readProjects, atomicWriteAll } from '../dataStore.ts'
import { runSkill } from '../ai/harness.ts'
import { minimumActionV2, type MinimumActionOutputV2, type MinimumActionInputTaskV2 } from '../ai/skills/minimumActionV2.ts'
import type { TaskStageType } from '../ai/skills/taskDecomposeV2.ts'
import type { MinimumAction } from '../../src/domain/models.ts'
import type { EnergyLevel } from '../../src/domain/models.ts'

export interface RegenerateMinimumActionResult {
  minimumActions: {
    id: string
    taskId: string
    description: string
    estimatedMinutes: number
    difficulty: number
  }[]
}

function readStageTypes(taskId: string, count: number): TaskStageType[] {
  const record = readDecompositions().find(item => item.taskId === taskId && item.status === 'completed')
  const raw = record?.originalOutput as { decomposition?: { children?: { stageType?: unknown }[] } } | undefined
  const children = raw?.decomposition?.children || []
  return Array.from({ length: count }, (_, index) => {
    const stageType = children[index]?.stageType
    return stageType === 'activation' || stageType === 'planning' || stageType === 'execution' || stageType === 'review'
      ? stageType
      : 'execution'
  })
}

function buildTargets(root: { id: string; title: string; description: string }, children: { id: string; title: string; description: string }[], stageTypes: TaskStageType[]): MinimumActionInputTaskV2[] {
  if (children.length > 0) {
    return children.map((child, i) => ({ taskRef: `child-${i}`, title: child.title, description: child.description, stageType: stageTypes[i] || 'execution' }))
  }
  return [{ taskRef: 'parent', title: root.title, description: root.description, stageType: 'activation' }]
}

export async function regenerateMinimumAction(taskId: string, energyLevel: EnergyLevel): Promise<RegenerateMinimumActionResult> {
  const tasks = readTasks()
  const root = tasks.find(task => task.id === taskId && !task.deletedAt)
  if (!root) throw new Error(`Task ${taskId} not found`)

  const children = tasks
    .filter(task => task.parentTaskId === taskId && !task.deletedAt)
    .sort((left, right) => left.order - right.order)

  const targets = buildTargets(
    { id: root.id, title: root.title, description: root.description || '' },
    children.map(child => ({ id: child.id, title: child.title, description: child.description || '' })),
    readStageTypes(taskId, children.length),
  )

  // 只调用 minimum-action-v2（一次批量），绝不调用 task-decompose-v2
  const actionOutput: MinimumActionOutputV2 = await runSkill(minimumActionV2, { tasks: targets, energyLevel })
  const actionByRef = new Map(actionOutput.actions.map(action => [action.taskRef, action]))

  const targetIds = new Set(children.length > 0 ? children.map(child => child.id) : [root.id])

  const now = new Date().toISOString()
  const newMinActions: MinimumAction[] = []

  if (children.length > 0) {
    children.forEach((child, i) => {
      const action = actionByRef.get(`child-${i}`)
      if (!action) return
      newMinActions.push({
        id: crypto.randomUUID(),
        taskId: child.id,
        description: action.description,
        estimatedMinutes: action.estimatedMinutes,
        difficulty: action.difficulty,
        aiGenerated: true,
        status: 'pending',
        completedAt: null,
        createdAt: now,
      })
    })
  } else {
    const action = actionByRef.get('parent')
    if (action) {
      newMinActions.push({
        id: crypto.randomUUID(),
        taskId: root.id,
        description: action.description,
        estimatedMinutes: action.estimatedMinutes,
        difficulty: action.difficulty,
        aiGenerated: true,
        status: 'pending',
        completedAt: null,
        createdAt: now,
      })
    }
  }

  // 只替换目标任务的 minimum action，其余保留；decomposition/tasks/projects 不变
  const remaining = readMinActions().filter(action => !targetIds.has(action.taskId))
  atomicWriteAll({
    tasks,
    minActions: [...remaining, ...newMinActions],
    decompositions: readDecompositions(),
    projects: readProjects(),
  })

  return {
    minimumActions: newMinActions.map(action => ({
      id: action.id,
      taskId: action.taskId,
      description: action.description,
      estimatedMinutes: action.estimatedMinutes,
      difficulty: action.difficulty,
    })),
  }
}
