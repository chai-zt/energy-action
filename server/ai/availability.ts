// ============================================================
// AI Availability — AI_AVAILABLE 判定
//
// AI_AVAILABLE 必须同时满足：
//   1. Provider Config 已配置
//   2. Secret 存在
//   3. 当前配置真实连接验证成功（verified）
//   4. Security Fuse = NORMAL
// 否则 AI_UNAVAILABLE。
// 不能只因为「有 API Key」就显示 AI 已连接。
// ============================================================

import { readProviderConfig, type ProviderConfig } from './providerConfig.ts'
import { getSecretStore } from '../security/secretStore.ts'
import { securityFuse, type FuseState } from '../security/fuse.ts'
import { AI_SECRET_ID } from './providerConfig.ts'

export type AiUnavailableReason = 'not_configured' | 'no_secret' | 'unverified' | 'fuse_locked'

export interface AiAvailability {
  available: boolean
  reason: 'available' | AiUnavailableReason
  config: ProviderConfig | null
  hasSecret: boolean
  verified: boolean
  fuseStatus: FuseState
}

export async function getAiAvailability(): Promise<AiAvailability> {
  const fuseStatus = securityFuse.getStatus().state
  if (fuseStatus === 'LOCKED') {
    return { available: false, reason: 'fuse_locked', config: null, hasSecret: false, verified: false, fuseStatus }
  }

  const config = readProviderConfig()
  if (!config) {
    return { available: false, reason: 'not_configured', config: null, hasSecret: false, verified: false, fuseStatus }
  }

  const { store } = await getSecretStore()
  const hasSecret = await store.hasSecret(AI_SECRET_ID)
  if (!hasSecret) {
    return { available: false, reason: 'no_secret', config, hasSecret: false, verified: false, fuseStatus }
  }

  const verified = config.verificationStatus === 'verified'
  if (!verified) {
    return { available: false, reason: 'unverified', config, hasSecret: true, verified: false, fuseStatus }
  }

  return { available: true, reason: 'available', config, hasSecret: true, verified: true, fuseStatus }
}
