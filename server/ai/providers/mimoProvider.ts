// ============================================================
// MiMo Provider — OpenAI Chat Completions compatible
//
// BYOK：MIMO_API_KEY 仅从服务端 process.env 读取，绝不进入前端。
// Base URL 可覆盖（Token Plan 用户可配自己的 Base URL）。
// 不做 OpenAI fallback：MiMo 失败即明确失败。
// ============================================================

export interface AiJsonRequest {
  model?: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}

export interface AiJsonResponse {
  text: string
  model?: string
  usage?: unknown
}

export interface AiJsonProvider {
  generateJson(request: AiJsonRequest): Promise<AiJsonResponse>
}

export type AiErrorCode =
  | 'AI_CONFIG_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_OUTPUT_INVALID'

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly status?: number
  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.status = status
  }
}

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const DEFAULT_MODEL = 'mimo-v2.5'
const TIMEOUT_MS = 30_000

interface MiMoConfig {
  apiKey: string
  baseUrl: string
  model: string
}

function readConfig(): MiMoConfig {
  return {
    apiKey: (process.env.MIMO_API_KEY || '').trim(),
    baseUrl: (process.env.MIMO_BASE_URL || DEFAULT_BASE_URL).trim(),
    model: (process.env.MIMO_MODEL || DEFAULT_MODEL).trim(),
  }
}

export class MiMoProvider implements AiJsonProvider {
  async generateJson(request: AiJsonRequest): Promise<AiJsonResponse> {
    const { apiKey, baseUrl, model } = readConfig()
    if (!apiKey) throw new AiError('AI_CONFIG_ERROR', 'MIMO_API_KEY not configured')

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          max_completion_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if ((err as Error).name === 'AbortError') {
        throw new AiError('AI_TIMEOUT', `MiMo request timed out after ${TIMEOUT_MS}ms`)
      }
      throw new AiError('AI_PROVIDER_ERROR', `MiMo request failed: ${(err as Error).message}`)
    }
    clearTimeout(timer)

    if (!res.ok) {
      // 只记录 status，不记录 Authorization / key / body
      throw new AiError('AI_PROVIDER_ERROR', `MiMo API ${res.status}`, res.status)
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      throw new AiError('AI_PROVIDER_ERROR', 'MiMo returned invalid JSON body')
    }

    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new AiError('AI_PROVIDER_ERROR', 'MiMo response missing assistant content')
    }

    return { text: content, model: data.model, usage: data.usage }
  }
}

let provider: AiJsonProvider = new MiMoProvider()

export function setProvider(p: AiJsonProvider): void { provider = p }
export function getProvider(): AiJsonProvider { return provider }
