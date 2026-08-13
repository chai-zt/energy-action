// ============================================================
// AI Config API — 模型配置中心的后端路由
//
// 路由：
//   GET    /ai/status          （公开，无真实 Key）
//   GET    /ai/session         （bootstrap，返回本地会话 token）
//   GET    /ai/config          （敏感：返回非敏感 config + maskedSecret）
//   PUT    /ai/config          （敏感：保存 config + secret）
//   DELETE /ai/config          （敏感：清除 config + secret）
//   POST   /ai/config/test     （敏感：真实连接测试）
//
// 敏感 API Guard：loopback + Host + Origin allowlist + JSON Content-Type
//                + body size limit + Method + 本地 Session Token。
// 绝不返回真实 API Key（只返回 maskedSecret）。
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  readProviderConfig, saveProviderConfig, clearProviderConfig, updateVerificationStatus,
  MIMO_DEFAULT_BASE_URL, MIMO_DEFAULT_MODEL, AI_SECRET_ID,
  type ProviderConfig, type ProviderType, type CredentialType,
} from './providerConfig.ts'
import { getSecretStore, type SecretStoreMode } from '../security/secretStore.ts'
import { getAiAvailability } from './availability.ts'
import { createProvider } from './providers/providerFactory.ts'
import { AiError } from './providers/mimoProvider.ts'
import { assertSafeRemoteUrl, SsrfError } from '../security/ssrf.ts'
import { securityFuse } from '../security/fuse.ts'
import { configTestLimiter } from '../security/rateLimit.ts'
import { getSessionToken, isSessionValid, getSessionHeaderName } from '../security/session.ts'

const MAX_BODY_BYTES = 16 * 1024
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4001',
  'http://127.0.0.1:4001',
])

// === Guard helpers ===

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function isAllowedHost(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  // 去掉端口，只校验 hostname 是 loopback（防 DNS rebinding）
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // 无 Origin（非浏览器请求）→ 由 session token 兜底
  return ALLOWED_ORIGINS.has(origin)
}

function jsonHeaders(origin?: string) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${getSessionHeaderName()}`,
  }
}

/** 解析 JSON body（带累计 byte 上限，超限 413）。 */
function parseJsonBody(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'BODY_TOO_LARGE' }))
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > maxBytes) { resolve(null); return }
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw.trim()) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/** 敏感 API 守卫：返回 true 表示通过。失败时写响应并记录 fuse。 */
function guardSensitive(req: IncomingMessage, res: ServerResponse, port: number, method: string, hasBody = false): boolean {
  if (req.method !== method) {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }))
    return false
  }
  if (!isLoopback(req)) {
    securityFuse.recordBadOrigin()
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'FORBIDDEN' }))
    return false
  }
  if (!isAllowedHost(req)) {
    securityFuse.recordBadOrigin()
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'FORBIDDEN' }))
    return false
  }
  if (!isAllowedOrigin(req)) {
    securityFuse.recordBadOrigin()
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'FORBIDDEN' }))
    return false
  }
  if (hasBody) {
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      res.writeHead(415, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'UNSUPPORTED_MEDIA_TYPE' }))
      return false
    }
  }
  if (!isSessionValid(req.headers[getSessionHeaderName().toLowerCase()] as string | undefined)) {
    securityFuse.recordBadSession()
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'UNAUTHORIZED' }))
    return false
  }
  if (securityFuse.isLocked()) {
    res.writeHead(423, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'FUSE_LOCKED' }))
    return false
  }
  return true
}

// === mask / status ===

function maskSecret(secret: string | null): string | null {
  if (!secret) return null
  if (secret.length <= 4) return '••••'
  return `••••${secret.slice(-4)}`
}

async function getSecretForConfig(): Promise<string | null> {
  const { store } = await getSecretStore()
  return store.getSecret(AI_SECRET_ID)
}

async function getMaskedSecret(): Promise<string | null> {
  return maskSecret(await getSecretForConfig())
}

async function buildStatus() {
  const availability = await getAiAvailability()
  const config = readProviderConfig()
  const { mode } = await getSecretStore()
  return {
    available: availability.available,
    reason: availability.reason,
    providerType: config?.providerType ?? null,
    providerName: config?.providerName ?? null,
    credentialType: config?.credentialType ?? null,
    baseUrl: config?.baseUrl ?? null,
    model: config?.model ?? null,
    configured: config !== null,
    hasSecret: availability.hasSecret,
    verified: availability.verified,
    lastVerifiedAt: config?.lastVerifiedAt ?? null,
    fuseStatus: availability.fuseStatus,
    secretStoreMode: mode,
    maskedSecret: await getMaskedSecret(),
  }
}

// === 校验并规范化 config body ===

function parseProviderConfigBody(body: unknown): { config: Omit<ProviderConfig, 'verificationStatus' | 'lastVerifiedAt'>; apiKey: string | null } {
  if (typeof body !== 'object' || body === null) throw new Error('INVALID_JSON')
  const b = body as Record<string, unknown>

  const providerType = b.providerType
  if (providerType !== 'mimo' && providerType !== 'openai_compatible') {
    throw new Error('providerType must be "mimo" or "openai_compatible"')
  }

  const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : ''
  const model = typeof b.model === 'string' ? b.model.trim() : ''
  if (!model) throw new Error('model is required')

  let credentialType: CredentialType = 'pay_as_you_go'
  if (providerType === 'mimo' && b.credentialType === 'token_plan') credentialType = 'token_plan'
  if (providerType === 'mimo' && b.credentialType === 'pay_as_you_go') credentialType = 'pay_as_you_go'

  const providerName = typeof b.providerName === 'string' ? b.providerName.trim() : ''

  const apiKey = typeof b.apiKey === 'string' && b.apiKey.trim() !== '' ? b.apiKey.trim() : null

  return {
    config: { providerType, providerName, credentialType, baseUrl, model },
    apiKey,
  }
}

function effectiveBaseUrl(providerType: ProviderType, baseUrl: string): string {
  if (baseUrl) return baseUrl
  if (providerType === 'mimo') return MIMO_DEFAULT_BASE_URL
  throw new Error('baseUrl is required for openai_compatible')
}

// === 错误分类（安全，不含 key / 完整响应）===

type TestErrorCategory = 'credential' | 'network' | 'provider' | 'model' | 'rate_limit' | 'invalid_config'

function classifyTestError(err: unknown): TestErrorCategory {
  if (err instanceof SsrfError) return 'invalid_config'
  if (err instanceof AiError) {
    if (err.code === 'AI_TIMEOUT') return 'network'
    if (err.code === 'AI_CONFIG_ERROR') return 'invalid_config'
    const status = err.status
    if (status === 401 || status === 403) return 'credential'
    if (status === 429) return 'rate_limit'
    if (status === 404) return 'model'
    if (status && status >= 500) return 'provider'
    return 'provider'
  }
  return 'network'
}

// === 路由 ===

export async function handleAiConfigRequest(req: IncomingMessage, res: ServerResponse, port: number): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const pathname = url.pathname

  if (!pathname.startsWith('/ai/')) return false

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders(req.headers.origin as string | undefined))
    res.end()
    return true
  }

  // === GET /ai/status（公开，无 Key）===
  if (req.method === 'GET' && pathname === '/ai/status') {
    res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
    res.end(JSON.stringify(await buildStatus()))
    return true
  }

  // === GET /ai/session（bootstrap，loopback + origin 保护）===
  if (req.method === 'GET' && pathname === '/ai/session') {
    if (!isLoopback(req) || !isAllowedHost(req) || !isAllowedOrigin(req)) {
      securityFuse.recordBadOrigin()
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'FORBIDDEN' }))
      return true
    }
    res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
    res.end(JSON.stringify({ session: getSessionToken() }))
    return true
  }

  // === GET /ai/config ===
  if (req.method === 'GET' && pathname === '/ai/config') {
    if (!guardSensitive(req, res, port, 'GET')) return true
    const config = readProviderConfig()
    res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
    res.end(JSON.stringify({
      config,
      maskedSecret: await getMaskedSecret(),
    }))
    return true
  }

  // === PUT /ai/config ===
  if (req.method === 'PUT' && pathname === '/ai/config') {
    if (!guardSensitive(req, res, port, 'PUT', true)) return true
    const body = await parseJsonBody(req, res, MAX_BODY_BYTES)
    if (body === null) {
      if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'INVALID_JSON' })) }
      return true
    }
    try {
      const { config: parsedConfig, apiKey } = parseProviderConfigBody(body)
      const baseUrl = effectiveBaseUrl(parsedConfig.providerType, parsedConfig.baseUrl)

      // SSRF 全量校验（结构 + DNS + 私网拒绝）
      try {
        await assertSafeRemoteUrl(baseUrl)
      } catch {
        securityFuse.recordSsrfTarget()
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'INVALID_BASE_URL' }))
        return true
      }

      // 保存 config（非敏感）到 SQLite
      const fullConfig: ProviderConfig = {
        ...parsedConfig,
        baseUrl,
        verificationStatus: 'unverified',
        lastVerifiedAt: null,
      }
      saveProviderConfig(fullConfig)

      // 保存 / 更新 secret（若用户未输入新 key，则保留原 secret）
      const { store } = await getSecretStore()
      if (apiKey !== null) {
        await store.setSecret(AI_SECRET_ID, apiKey)
      }

      res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
      res.end(JSON.stringify({ config: fullConfig, maskedSecret: await getMaskedSecret() }))
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
    return true
  }

  // === DELETE /ai/config ===
  if (req.method === 'DELETE' && pathname === '/ai/config') {
    if (!guardSensitive(req, res, port, 'DELETE')) return true
    const { store } = await getSecretStore()
    await store.deleteSecret(AI_SECRET_ID)
    clearProviderConfig()
    res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
    res.end(JSON.stringify({ cleared: true }))
    return true
  }

  // === POST /ai/config/test ===
  if (req.method === 'POST' && pathname === '/ai/config/test') {
    if (!guardSensitive(req, res, port, 'POST', true)) return true
    if (!configTestLimiter.allow('config-test')) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'RATE_LIMITED' }))
      return true
    }
    const body = await parseJsonBody(req, res, MAX_BODY_BYTES)
    if (body === null) {
      if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'INVALID_JSON' })) }
      return true
    }
    try {
      const { config: parsedConfig, apiKey } = parseProviderConfigBody(body)
      const baseUrl = effectiveBaseUrl(parsedConfig.providerType, parsedConfig.baseUrl)

      // SSRF 全量校验
      try {
        await assertSafeRemoteUrl(baseUrl)
      } catch {
        securityFuse.recordSsrfTarget()
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'INVALID_BASE_URL', category: 'invalid_config' }))
        return true
      }

      // 用本次提供的 key（或已保存的 key）做真实连接测试
      const { store } = await getSecretStore()
      const key = apiKey ?? (await store.getSecret(AI_SECRET_ID))
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'API_KEY_REQUIRED', category: 'invalid_config' }))
        return true
      }

      const provider = createProvider(
        { ...parsedConfig, baseUrl, verificationStatus: 'unverified', lastVerifiedAt: null },
        key,
      )

      try {
        await provider.generateJson({ systemPrompt: 'ping', userPrompt: 'reply with the single word: ok', maxTokens: 16 })
        updateVerificationStatus('verified')
        res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
        res.end(JSON.stringify({ ok: true, verified: true }))
      } catch (err) {
        updateVerificationStatus('failed')
        securityFuse.recordConfigTestAnomaly()
        const category = classifyTestError(err)
        res.writeHead(200, jsonHeaders(req.headers.origin as string | undefined))
        res.end(JSON.stringify({ ok: false, verified: false, category }))
      }
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: (err as Error).message, category: 'invalid_config' }))
    }
    return true
  }

  // 其他 /ai/* 未匹配
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
  return true
}

// 供 index.ts 使用的导出
export function getSecretStoreMode(): Promise<SecretStoreMode> {
  return getSecretStore().then(({ mode }) => mode)
}
