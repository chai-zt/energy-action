// ============================================================
// Task Decomposition Service — 任务拆解服务
// ============================================================

import { generateId, now } from '@/lib/utils'
import type { Task, ExecutionStep, MinimumAction, DecompositionResult } from '@/domain/models'
import type { DecompositionProvider } from './decompositionProvider'
import { MockDecompositionProvider } from './decompositionProvider'

let provider: DecompositionProvider = new MockDecompositionProvider()

/** 替换 Provider（未来接真实 AI 时调用） */
export function setDecompositionProvider(p: DecompositionProvider) {
  provider = p
}

export interface DecompositionOutput {
  steps: ExecutionStep[]
  minimumAction: MinimumAction
}

/**
 * 拆解任务并持久化
 */
export async function decomposeAndSave(
  task: Task,
  saveSteps: (steps: ExecutionStep[]) => Promise<void>,
  saveMinAction: (ma: MinimumAction) => Promise<void>,
): Promise<DecompositionOutput> {
  const result: DecompositionResult = await provider.decompose(task.title, task.description)

  const steps: ExecutionStep[] = result.steps.map((s, i) => ({
    id: generateId(),
    taskId: task.id,
    content: s.content,
    order: s.order ?? i + 1,
    status: 'pending' as const,
    completedAt: null,
    createdAt: now(),
  }))

  const minimumAction: MinimumAction = {
    id: generateId(),
    taskId: task.id,
    description: result.minimumAction.description,
    estimatedMinutes: result.minimumAction.estimatedMinutes,
    difficulty: result.minimumAction.difficulty,
    aiGenerated: result.minimumAction.aiGenerated,
    status: 'pending' as const,
    completedAt: null,
    createdAt: now(),
  }

  await Promise.all([saveSteps(steps), saveMinAction(minimumAction)])

  return { steps, minimumAction }
}
