// ============================================================
// S1-D Live Smoke — Energy-Aware Minimum Action（真实 Provider）
//
// 使用「当前已配置」的 Provider（AI Model Center + Secret Store），
// 绝不读 MIMO_API_KEY env / 不打印 Key / 不硬编码 Key / 不写真实数据。
//
// 流程：
//   low  → decompose + 生成 Minimum Action
//   high → 重新生成 Minimum Action（不重新 decomposition）
// 验证：两次结果结构合法（estimatedMinutes 1–10、difficulty 1–5），
//       Skill Contract 合法，regeneration 不调用 task-decompose-v1。
//
// 无有效 Provider 配置 → SKIPPED — AI NOT CONFIGURED（退出 0，非失败）。
// ============================================================

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { getAiAvailability } = await import('../server/ai/availability.ts')
const { buildProviderFromConfig } = await import('../server/ai/providers/providerFactory.ts')
const { setResolvedProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { closeDb } = await import('../server/db/sqlite.ts')

// 1. 先从「真实」配置读取并构建 Provider（真实 DB + OS 凭据库），
//    绝不硬编码 Key / 绝不把 Key 放 .env。
const availability = await getAiAvailability()
if (!availability.available) {
  console.log(`SKIPPED — AI NOT CONFIGURED (reason=${availability.reason})`)
  process.exit(0)
}

const provider = await buildProviderFromConfig()
if (!provider) {
  console.log('SKIPPED — AI NOT CONFIGURED (no provider resolved)')
  process.exit(0)
}
setResolvedProvider(provider)

// 2. 切换到临时 DB，避免污染真实任务数据（Provider 已就绪，Secret 在 OS 凭据库）
closeDb()
process.env.PERSONAL_AI_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'energy-action-s1d-live-'))

const { atomicWriteAll, readDecompositions, readMinActions } = await import('../server/dataStore.ts')
const { decomposeTask } = await import('../server/services/decomposeService.ts')
const { regenerateMinimumAction } = await import('../server/services/minimumActionService.ts')

function safeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const e = err as Error & { code?: string; status?: number }
  const parts: string[] = []
  if (e.name && e.name !== 'Error') parts.push(`type=${e.name}`)
  if (e.code) parts.push(`code=${e.code}`)
  if (typeof e.status === 'number') parts.push(`http=${e.status}`)
  parts.push(`msg=${e.message}`)
  return parts.join(' | ')
}

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

function checkContract(actions: { estimatedMinutes: number; difficulty: number }[], label: string): boolean {
  let ok = true
  for (const a of actions) {
    if (typeof a.estimatedMinutes !== 'number' || a.estimatedMinutes < 1 || a.estimatedMinutes > 10) {
      console.log(`  [${label}] invalid estimatedMinutes=${a.estimatedMinutes}`)
      ok = false
    }
    if (typeof a.difficulty !== 'number' || a.difficulty < 1 || a.difficulty > 5) {
      console.log(`  [${label}] invalid difficulty=${a.difficulty}`)
      ok = false
    }
  }
  return ok
}

let overallOk = true
try {
  const parent = makeLargeTask('准备一次 10 分钟的项目演示')
  atomicWriteAll({ tasks: [parent], minActions: [], decompositions: [], projects: [] })

  // 1. low：decompose + 生成 Minimum Action
  const lowResult = await decomposeTask(parent.id, 'low')
  const decompBefore = readDecompositions()
  console.log(`decompose(low): PASS (shouldDecompose=${lowResult.decomposition.should_decompose}, children=${lowResult.childTasks.length}, minActions=${lowResult.minimumActions.length})`)

  // 2. high：重新生成 Minimum Action（不重新 decomposition）
  const highResult = await regenerateMinimumAction(parent.id, 'high')
  const decompAfter = readDecompositions()
  console.log(`regenerate(high): PASS (minActions=${highResult.minimumActions.length})`)

  // 3. 结构合法
  const lowActions = readMinActions().filter(a => a.taskId === parent.id || lowResult.childTasks.some(c => c.id === a.taskId))
  const highActions = highResult.minimumActions
  overallOk = checkContract(lowActions, 'low') && checkContract(highActions, 'high') && overallOk

  // 4. decomposition 未变（未重新拆解）
  if (decompAfter.length !== decompBefore.length || decompAfter[0]?.id !== decompBefore[0]?.id) {
    console.log('  [regenerate] decomposition 被意外修改')
    overallOk = false
  } else {
    console.log('  decomposition unchanged: PASS')
  }

  // 5. 至少生成了 minimum action
  if (highResult.minimumActions.length === 0) {
    console.log('  [regenerate] 未生成任何 minimum action')
    overallOk = false
  }

  console.log(`overall: ${overallOk ? 'PASS' : 'FAIL'}`)
} catch (err) {
  console.log('S1-D live smoke: FAIL')
  console.log(`  [诊断] ${safeError(err)}`)
  overallOk = false
}

process.exit(overallOk ? 0 : 1)
