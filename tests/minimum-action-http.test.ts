// ============================================================
// S1-D HTTP 测试 — energyLevel 校验 + No-AI Mode（无公网）
//
// 验证：
//   A. Energy Validation：low/medium/high 通过校验，非法值 400
//   D. No-AI：无模型时 Minimum Action 生成返回 AI_UNAVAILABLE，
//      Task CRUD 正常，普通功能不失败
// ============================================================

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-s1d-http-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir
process.env.PERSONAL_AI_OS_TEST = '1'

const { handleRequest } = await import('../server/index.ts')

const server = createServer(handleRequest)
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

function jsonBody(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function req(path: string, method = 'GET', init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method, ...init })
}

try {
  // 创建大任务（No-AI 环境，Task CRUD 不受影响）
  const createRes = await req('/tasks', 'POST', jsonBody({ title: 'S1-D 大任务', taskKind: 'large' }))
  assert.equal(createRes.status, 201)
  const task = await createRes.json() as { id: string }
  assert.ok(task.id)

  // ============================================================
  // A. Energy Validation
  // ============================================================

  // 非法值 → 400（decompose）
  for (const bad of ['super-high', '999', '', 'HIGH', 3, null, ['low'], { level: 'low' }]) {
    const res = await req(`/tasks/${task.id}/decompose`, 'POST', jsonBody({ energyLevel: bad }))
    assert.equal(res.status, 400, `decompose energyLevel=${JSON.stringify(bad)} 应返回 400`)
  }

  // 非法值 → 400（minimum-action 重新生成）
  for (const bad of ['super-high', 3, ['low']]) {
    const res = await req(`/tasks/${task.id}/minimum-action`, 'POST', jsonBody({ energyLevel: bad }))
    assert.equal(res.status, 400, `minimum-action energyLevel=${JSON.stringify(bad)} 应返回 400`)
  }

  // 缺失 energyLevel → 400（minimum-action 必填）
  const missingRes = await req(`/tasks/${task.id}/minimum-action`, 'POST', jsonBody({}))
  assert.equal(missingRes.status, 400)

  // null → 400
  const nullRes = await req(`/tasks/${task.id}/minimum-action`, 'POST', jsonBody({ energyLevel: null }))
  assert.equal(nullRes.status, 400)

  // ============================================================
  // D. No-AI Mode：合法 energyLevel 但无 Provider → AI_UNAVAILABLE
  // ============================================================

  for (const good of ['low', 'medium', 'high']) {
    const res = await req(`/tasks/${task.id}/minimum-action`, 'POST', jsonBody({ energyLevel: good }))
    assert.equal(res.status, 503, `energyLevel=${good} 通过校验后，无 Provider 应返回 503 AI_UNAVAILABLE`)
    const body = await res.json() as { error: string }
    assert.equal(body.error, 'AI_UNAVAILABLE')
  }

  // Task CRUD 正常
  const patchRes = await req(`/tasks/${task.id}`, 'PATCH', jsonBody({ title: 'No-AI 下仍可改名' }))
  assert.equal(patchRes.status, 200)
  const getRes = await req(`/tasks/${task.id}`)
  assert.equal(getRes.status, 200)
  const got = await getRes.json() as { title: string }
  assert.equal(got.title, 'No-AI 下仍可改名')

  // 拆解同样返回 AI_UNAVAILABLE（不产生 children）
  const decompRes = await req(`/tasks/${task.id}/decompose`, 'POST', jsonBody({ energyLevel: 'low' }))
  assert.equal(decompRes.status, 503)

  console.log('S1-D HTTP energy validation / No-AI: PASS')
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()))
}
