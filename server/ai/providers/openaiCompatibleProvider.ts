// ============================================================
// OpenAICompatibleProvider — 通用远程 HTTPS 模型 Provider
//
// 与 MiMo 共享 OpenAI Chat Completions 协议，但通过构造参数显式
// 传入 { apiKey, baseUrl, model }（来自 Local Node 已保存 Config）。
// 不做 OpenAI SDK / LangChain 等框架。
//
// 安全：
//   - baseUrl 做 SSRF 结构校验（https only / 无 userinfo / 无私网 IP 字面量）
//   - redirect: manual（不自动跟随，防 SSRF redirect bypass）
//   - 错误信息绝不包含 Authorization / API Key
// ============================================================

import { AiError } from './mimoProvider.ts'
import type { AiJsonRequest, AiJsonResponse, AiJsonProvider } from './mimoProvider.ts'
import { validateHttpsUrl } from '../../security/ssrf.ts'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseUrl: string
  model: string
  /** MiMo 需要关闭 thinking；通用 provider 默认不发送该字段。 */
  thinkingDisabled?: boolean
  /** token 上限字段名：MiMo 用 max_completion_tokens，通用用 max_tokens。 */
  maxTokensField?: 'max_completion_tokens' | 'max_tokens'
}

const TIMEOUT_MS = 30_000

export class OpenAICompatibleProvider implements AiJsonProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly thinkingDisabled: boolean
  private readonly maxTokensField: 'max_completion_tokens' | 'max_tokens'

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl
    this.model = config.model
    this.thinkingDisabled = config.thinkingDisabled ?? false
    this.maxTokensField = config.maxTokensField ?? 'max_tokens'
  }

  async generateJson(request: AiJsonRequest): Promise<AiJsonResponse> {
    if (!this.apiKey) throw new AiError('AI_CONFIG_ERROR', 'API key not configured')

    // SSRF 结构校验（sync；DNS 已在保存/测试时做过全量校验）
    const url = validateHttpsUrl(this.baseUrl)
    const endpoint = `${url.toString().replace(/\/+$/, '')}/chat/completions`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const body: Record<string, unknown> = {
      model: request.model || this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      response_format: { type: 'json_object' },
    }
    if (this.thinkingDisabled) body.thinking = { type: 'disabled' }
    body[this.maxTokensField] = request.maxTokens

    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual',
      })
    } catch (err) {
      clearTimeout(timer)
      if ((err as Error).name === 'AbortError') {
        throw new AiError('AI_TIMEOUT', `request timed out after ${TIMEOUT_MS}ms`)
      }
      throw new AiError('AI_PROVIDER_ERROR', `request failed: ${(err as Error).message}`)
    }
    clearTimeout(timer)

    if (!res.ok) {
      // 只记录 status，不记录 Authorization / key / body
      throw new AiError('AI_PROVIDER_ERROR', `API ${res.status}`, res.status)
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw new AiError('AI_PROVIDER_ERROR', 'provider returned invalid JSON body')
    }

    const content = (data as any)?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new AiError('AI_PROVIDER_ERROR', 'response missing assistant content')
    }

    return { text: content, model: (data as any).model, usage: (data as any).usage }
  }
}
