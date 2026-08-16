// ============================================================
// AI Availability — AI_AVAILABLE 判定
//
// Hosted 模式 AI_AVAILABLE 必须同时满足：
//   1. Provider Config 已配置
//   2. Secret 存在
//   3. 当前配置真实连接验证成功（verified）
//   4. Security Fuse = NORMAL
//
// Local 模式是单用户本机应用：配置和 Secret 仍存在即可尝试调用；
// verified 是连接状态提示，不应因为一次网络/供应商失败逼用户重新填写 Key。
// ============================================================

import { readProviderConfig, type ProviderConfig } from './providerConfig.ts'
import { getSecretStore } from '../security/secretStore.ts'
import { securityFuse, type FuseState } from '../security/fuse.ts'
import { AI_SECRET_ID } from './providerConfig.ts'
import { isHostedRuntime } from '../runtime.ts'

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
  if (!isHostedRuntime()) {
    return { available: true, reason: 'available', config, hasSecret: true, verified, fuseStatus }
  }

  if (!verified) {
    return { available: false, reason: 'unverified', config, hasSecret: true, verified: false, fuseStatus }
  }

  return { available: true, reason: 'available', config, hasSecret: true, verified: true, fuseStatus }
}
