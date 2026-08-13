// ============================================================
// MiMo Live Smoke — 真实 MiMo API 验证（需本机配置 MIMO_API_KEY）
//
// 运行：npm run test:mimo:live
// 无 Key：输出 SKIPPED 并退出 0。
// 有 Key：跑两次真实 MiMo 调用（task-decompose-v1 + minimum-action-v1），
//         验证 JSON parse + runtime validation。
// 不打印 API key / Authorization / 完整 response / 完整 prompt。
// 不写任何 SQLite 数据库、不修改任何业务数据。
// ============================================================

import { runSkill } from '../server/ai/harness.ts'
import { taskDecomposeV1 } from '../server/ai/skills/taskDecomposeV1.ts'
import { minimumActionV1 } from '../server/ai/skills/minimumActionV1.ts'

if (!process.env.MIMO_API_KEY) {
  console.log('SKIPPED — MIMO_API_KEY not configured')
  process.exit(0)
}

const TASK_TITLE = '准备一次 10 分钟的项目演示'
const TASK_DESC = '向团队演示 Energy Action 项目'

// 安全诊断输出：只打印错误类型 / code / HTTP status / 安全 message，
// 绝不打印 API key / Authorization / 完整 response body / 完整 prompt。
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

console.log('provider: MiMo')
console.log(`model: ${process.env.MIMO_MODEL || 'mimo-v2.5'}`)

let overallOk = true
let childrenCount = 0
let actionCount = 0

// MiMo call 1：task-decompose-v1
let actionTargets: { taskRef: string; title: string; description: string }[] = [
  { taskRef: 'parent', title: TASK_TITLE, description: TASK_DESC },
]
try {
  const decomposeOut = await runSkill(taskDecomposeV1, {
    title: TASK_TITLE,
    description: TASK_DESC,
  })
  childrenCount = decomposeOut.children.length
  console.log('task-decompose-v1: PASS')
  if (decomposeOut.children.length > 0) {
    actionTargets = decomposeOut.children.map((c, i) => ({ taskRef: `child-${i}`, title: c.title, description: c.description }))
  }
} catch (err) {
  console.log('task-decompose-v1: FAIL')
  console.log(`  [诊断] ${safeError(err)}`)
  overallOk = false
}
console.log(`children count: ${childrenCount}`)

// MiMo call 2：minimum-action-v1（批量）
try {
  const actionOut = await runSkill(minimumActionV1, {
    tasks: actionTargets,
    energyLevel: 'medium',
  })
  actionCount = actionOut.actions.length
  console.log('minimum-action-v1: PASS')
} catch (err) {
  console.log('minimum-action-v1: FAIL')
  console.log(`  [诊断] ${safeError(err)}`)
  overallOk = false
}
console.log(`minimum action count: ${actionCount}`)

console.log(`overall: ${overallOk ? 'PASS' : 'FAIL'}`)
process.exit(overallOk ? 0 : 1)
