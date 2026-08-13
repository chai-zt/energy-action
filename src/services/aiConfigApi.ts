// ============================================================
// AI Config API Client — 模型配置中心请求层
//
// 安全：
//   - API Key 只经 Local Node 后端处理，绝不进入本文件返回值之外的存储。
//   - 敏感请求携带 X-Energy-Action-Session（后端内存会话 token）。
//   - 前端拿不到真实 API Key，只有 maskedSecret。
// ============================================================

const BASE_URL = '/api'

export type ProviderType = 'mimo' | 'openai_compatible'
export type CredentialType = 'pay_as_you_go' | 'token_plan'
export type VerificationStatus = 'unverified' | 'verified' | 'failed'
export type SecretStoreMode = 'native' | 'memory'
export type FuseState = 'NORMAL' | 'LOCKED'
export type AiUnavailableReason = 'not_configured' | 'no_secret' | 'unverified' | 'fuse_locked' | 'available'

export interface AiStatus {
  available: boolean
  reason: AiUnavailableReason
  providerType: ProviderType | null
  providerName: string | null
  credentialType: CredentialType | null
  baseUrl: string | null
  model: string | null
  configured: boolean
  hasSecret: boolean
  verified: boolean
  lastVerifiedAt: string | null
  fuseStatus: FuseState
  secretStoreMode: SecretStoreMode
  maskedSecret: string | null
}

export interface AiProviderConfig {
  providerType: ProviderType
  providerName: string
  credentialType: CredentialType
  baseUrl: string
  model: string
  verificationStatus: VerificationStatus
  lastVerifiedAt: string | null
}

export interface AiConfigSaveInput {
  providerType: ProviderType
  providerName?: string
  credentialType?: CredentialType
  baseUrl?: string
  model: string
  /** 仅当用户输入新 key 时传；留空表示保留原 key。 */
  apiKey?: string
}

export interface AiConfigTestResult {
  ok: boolean
  verified: boolean
  category?: 'credential' | 'network' | 'provider' | 'model' | 'rate_limit' | 'invalid_config'
}

// === 内存会话 token（不写 localStorage / 源码 / 日志）===

let sessionToken: string | null = null

async function ensureSession(): Promise<string> {
  if (sessionToken) return sessionToken
  const res = await fetch(`${BASE_URL}/ai/session`)
  if (!res.ok) throw new Error('SESSION_BOOTSTRAP_FAILED')
  const data = await res.json() as { session: string }
  sessionToken = data.session
  return sessionToken
}

async function request<T>(path: string, options: RequestInit = {}, sensitive = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sensitive) {
    headers['X-Energy-Action-Session'] = await ensureSession()
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `API ${res.status}`)
  }
  return res.json()
}

// === 公开状态 ===

export function getAiStatus(): Promise<AiStatus> {
  return request<AiStatus>('/ai/status')
}

// === 敏感操作 ===

export function getAiConfig(): Promise<{ config: AiProviderConfig | null; maskedSecret: string | null }> {
  return request('/ai/config', {}, true)
}

export function saveAiConfig(input: AiConfigSaveInput): Promise<{ config: AiProviderConfig; maskedSecret: string | null }> {
  return request('/ai/config', { method: 'PUT', body: JSON.stringify(input) }, true)
}

export function deleteAiConfig(): Promise<{ cleared: boolean }> {
  return request('/ai/config', { method: 'DELETE' }, true)
}

export function testAiConfig(input: AiConfigSaveInput): Promise<AiConfigTestResult> {
  return request('/ai/config/test', { method: 'POST', body: JSON.stringify(input) }, true)
}
