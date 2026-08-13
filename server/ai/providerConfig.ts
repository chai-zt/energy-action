// ============================================================
// Provider Config — 非敏感模型配置（SQLite 保存）
//
// 只存非敏感字段；完整 API Key 绝不进 SQLite（走 SecretStore）。
// Community Alpha：单 active provider（不搞多账号管理）。
// ============================================================

import { getDb } from '../db/sqlite.ts'

export type ProviderType = 'mimo' | 'openai_compatible'
export type CredentialType = 'pay_as_you_go' | 'token_plan'
export type VerificationStatus = 'unverified' | 'verified' | 'failed'

export interface ProviderConfig {
  providerType: ProviderType
  providerName: string
  credentialType: CredentialType
  baseUrl: string
  model: string
  verificationStatus: VerificationStatus
  lastVerifiedAt: string | null
}

export const MIMO_DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const MIMO_DEFAULT_MODEL = 'mimo-v2.5'

/** SecretStore 中保存 API Key 的稳定 id（API Key 绝不进 SQLite）。 */
export const AI_SECRET_ID = 'ai-provider-api-key'

const ACTIVE_ID = 'active'

type ConfigRow = Record<string, unknown>

function rowToConfig(row: ConfigRow): ProviderConfig {
  return {
    providerType: row.provider_type as ProviderType,
    providerName: (row.provider_name as string) ?? '',
    credentialType: (row.credential_type as CredentialType) ?? 'pay_as_you_go',
    baseUrl: (row.base_url as string) ?? '',
    model: (row.model as string) ?? '',
    verificationStatus: (row.verification_status as VerificationStatus) ?? 'unverified',
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
  }
}

export function readProviderConfig(): ProviderConfig | null {
  const row = getDb().prepare('SELECT * FROM ai_provider_configs WHERE id = ?').get(ACTIVE_ID) as ConfigRow | undefined
  if (!row) return null
  return rowToConfig(row)
}

export function saveProviderConfig(config: ProviderConfig): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO ai_provider_configs (
      id, provider_type, provider_name, credential_type, base_url, model,
      verification_status, last_verified_at, updated_at
    ) VALUES (
      @id, @provider_type, @provider_name, @credential_type, @base_url, @model,
      @verification_status, @last_verified_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      provider_type = excluded.provider_type,
      provider_name = excluded.provider_name,
      credential_type = excluded.credential_type,
      base_url = excluded.base_url,
      model = excluded.model,
      verification_status = excluded.verification_status,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at
  `).run({
    id: ACTIVE_ID,
    provider_type: config.providerType,
    provider_name: config.providerName,
    credential_type: config.credentialType,
    base_url: config.baseUrl,
    model: config.model,
    verification_status: config.verificationStatus,
    last_verified_at: config.lastVerifiedAt,
    updated_at: new Date().toISOString(),
  })
}

export function clearProviderConfig(): void {
  getDb().prepare('DELETE FROM ai_provider_configs WHERE id = ?').run(ACTIVE_ID)
}

/** 更新验证状态（供 test connection 成功/失败后写回）。 */
export function updateVerificationStatus(status: VerificationStatus): void {
  const config = readProviderConfig()
  if (!config) return
  saveProviderConfig({
    ...config,
    verificationStatus: status,
    lastVerifiedAt: status === 'verified' ? new Date().toISOString() : config.lastVerifiedAt,
  })
}
