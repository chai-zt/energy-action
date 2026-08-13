// ============================================================
// Provider Factory — 从已保存 Config + Secret 构建 Provider
//
//   ProviderFactory
//     ├─ MiMo（thinking disabled + max_completion_tokens）
//     └─ OpenAI Compatible（max_tokens）
//
// Harness / Skills 保持 Provider-Agnostic（只依赖 AiJsonProvider）。
// ============================================================

import type { AiJsonProvider } from './mimoProvider.ts'
import { OpenAICompatibleProvider } from './openaiCompatibleProvider.ts'
import { getSecretStore } from '../../security/secretStore.ts'
import {
  readProviderConfig,
  MIMO_DEFAULT_BASE_URL,
  MIMO_DEFAULT_MODEL,
  AI_SECRET_ID,
  type ProviderConfig,
} from '../providerConfig.ts'

/** 由 config + apiKey 构建 provider（不读 secret store，便于测试）。 */
export function createProvider(config: ProviderConfig, apiKey: string): AiJsonProvider {
  const baseUrl = config.baseUrl || (config.providerType === 'mimo' ? MIMO_DEFAULT_BASE_URL : '')
  const model = config.model || (config.providerType === 'mimo' ? MIMO_DEFAULT_MODEL : '')

  if (config.providerType === 'mimo') {
    return new OpenAICompatibleProvider({
      apiKey, baseUrl, model,
      thinkingDisabled: true,
      maxTokensField: 'max_completion_tokens',
    })
  }
  return new OpenAICompatibleProvider({
    apiKey, baseUrl, model,
    thinkingDisabled: false,
    maxTokensField: 'max_tokens',
  })
}

/** 从已保存 Config + SecretStore 构建 provider；不可用则返回 null。 */
export async function buildProviderFromConfig(): Promise<AiJsonProvider | null> {
  const config = readProviderConfig()
  if (!config) return null
  const { store } = await getSecretStore()
  const apiKey = await store.getSecret(AI_SECRET_ID)
  if (!apiKey) return null
  return createProvider(config, apiKey)
}
