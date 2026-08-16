// ============================================================
// AI Status / No-AI Mode / 敏感 API Guard（HTTP 级，无公网）
// ============================================================

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-status-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir
process.env.PERSONAL_AI_OS_TEST = '1'
process.env.PERSONAL_AI_OS_MODE = 'hosted'

const { handleRequest } = await import('../server/index.ts')

const server = createServer(handleRequest)
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

async function req(path: string, method = 'GET', opts: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method, ...opts })
}

async function getSession(): Promise<string> {
  const res = await req('/ai/session')
  const data = await res.json() as { session: string }
  return data.session
}

const validConfig = {
  providerType: 'mimo',
  credentialType: 'pay_as_you_go',
  model: 'mimo-v2.5',
  baseUrl: 'https://1.1.1.1/v1', // 公网 IP 字面量，避免测试依赖 DNS
  apiKey: 'test-key-123456',
}

function jsonBody(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }
}

try {
  // ============================================================
  // No-AI Mode（无 config）
  // ============================================================

  {
    const statusRes = await req('/ai/status')
    assert.equal(statusRes.status, 200)
    const status = await statusRes.json() as { available: boolean; reason: string }
    assert.equal(status.available, false)
    assert.equal(status.reason, 'not_configured')

    // 创建大任务应成功（不依赖 AI）
    const createRes = await req('/tasks', 'POST', jsonBody({ title: '无 AI 大任务', taskKind: 'large' }))
    assert.equal(createRes.status, 201)
    const task = await createRes.json() as { id: string }
    assert.ok(task.id)

    // 拆解应返回 503 AI_UNAVAILABLE，不产生 children
    const decompRes = await req(`/tasks/${task.id}/decompose`, 'POST')
    assert.equal(decompRes.status, 503)
    const decompBody = await decompRes.json() as { error: string }
    assert.equal(decompBody.error, 'AI_UNAVAILABLE')

    const childrenRes = await req(`/tasks?parentTaskId=${task.id}`)
    const children = await childrenRes.json() as unknown[]
    assert.equal(children.length, 0)
  }

  // ============================================================
  // 敏感 API Guard：session / origin / SSRF / secret 不泄露
  // ============================================================

  {
    // 无 session → 401
    const noSession = await req('/ai/config', 'PUT', jsonBody(validConfig))
    assert.equal(noSession.status, 401)

    // 错误 session → 401
    const badSession = await req('/ai/config', 'PUT', jsonBody(validConfig, { 'X-Energy-Action-Session': 'wrong' }))
    assert.equal(badSession.status, 401)

    // 非法 Origin → 403
    const session = await getSession()
    const badOrigin = await req('/ai/config', 'PUT', jsonBody(validConfig, {
      'X-Energy-Action-Session': session,
      'Origin': 'https://evil.example.com',
    }))
    assert.equal(badOrigin.status, 403)

    // 私网 baseUrl → SSRF 拒绝（400 INVALID_BASE_URL）
    const ssrfRes = await req('/ai/config', 'PUT', jsonBody({ ...validConfig, baseUrl: 'https://10.0.0.1/v1' }, {
      'X-Energy-Action-Session': session,
    }))
    assert.equal(ssrfRes.status, 400)

    // http 协议 → SSRF 拒绝
    const httpRes = await req('/ai/config', 'PUT', jsonBody({ ...validConfig, baseUrl: 'http://example.com/v1' }, {
      'X-Energy-Action-Session': session,
    }))
    assert.equal(httpRes.status, 400)

    // 正确保存 → 200
    const saveRes = await req('/ai/config', 'PUT', jsonBody(validConfig, { 'X-Energy-Action-Session': session }))
    assert.equal(saveRes.status, 200)

    // GET config 不泄露真实 key（只有 maskedSecret）
    const getRes = await req('/ai/config', 'GET', { headers: { 'X-Energy-Action-Session': session } })
    assert.equal(getRes.status, 200)
    const getBody = await getRes.json() as { maskedSecret: string | null }
    assert.ok(getBody.maskedSecret)
    assert.equal(getBody.maskedSecret.includes('test-key-123456'), false)
    assert.match(getBody.maskedSecret, /^••••\w{4}$/)

    // 保存后 status 仍 unverified（未测试连接）
    const statusRes2 = await req('/ai/status')
    const status2 = await statusRes2.json() as { available: boolean; reason: string; maskedSecret: string | null }
    assert.equal(status2.available, false)
    assert.equal(status2.reason, 'unverified')
    assert.ok(status2.maskedSecret && !status2.maskedSecret.includes('test-key-123456'))

    // DELETE → 200，清除后 status not_configured
    const delRes = await req('/ai/config', 'DELETE', { headers: { 'X-Energy-Action-Session': session } })
    assert.equal(delRes.status, 200)
    const statusRes3 = await req('/ai/status')
    const status3 = await statusRes3.json() as { available: boolean; reason: string }
    assert.equal(status3.available, false)
    assert.equal(status3.reason, 'not_configured')
  }

  // ============================================================
  // 内容类型 / 方法守卫
  // ============================================================

  {
    const session = await getSession()
    // 错误 Content-Type → 415
    const wrongType = await req('/ai/config', 'PUT', {
      headers: { 'Content-Type': 'text/plain', 'X-Energy-Action-Session': session },
      body: 'not json',
    })
    assert.equal(wrongType.status, 415)
  }

  console.log('AI status / No-AI / guard tests: PASS')
} finally {
  server.close()
}
