// ============================================================
// AI Harness Lite — Skill → Prompt → Provider → JSON.parse → validate → result
//
// 只负责：
//   1. 接受 Skill
//   2. buildPrompt
//   3. 调 Provider
//   4. parse JSON
//   5. runtime validate
//   6. 最多一次 repair retry
//   7. 返回 typed result
//
// 不做：自主选 Agent / 循环规划 / 工具调用 / 访问数据库 / HTTP route / Memory。
// ============================================================

import { getProvider, AiError } from './providers/mimoProvider.ts'

export interface AiSkill<Input, Output> {
  id: string
  version: string
  model?: string
  maxTokens: number
  buildSystemPrompt(): string
  buildUserPrompt(input: Input): string
  validate(value: unknown, input: Input): Output
}

const MAX_ATTEMPTS = 2

export async function runSkill<Input, Output>(skill: AiSkill<Input, Output>, input: Input): Promise<Output> {
  let retrySummary: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 1. Provider 调用（provider 错误直接透传，不重试）
    const response = await getProvider().generateJson({
      model: skill.model,
      systemPrompt: skill.buildSystemPrompt(),
      userPrompt: buildUserPrompt(skill, input, retrySummary),
      maxTokens: skill.maxTokens,
    })

    // 2. JSON.parse + schema validate
    try {
      const parsed = JSON.parse(response.text)
      return skill.validate(parsed, input)
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new AiError('AI_OUTPUT_INVALID', `AI output invalid: ${(err as Error).message}`)
      }
      retrySummary = (err as Error).message
    }
  }

  // 不可达（循环内已 throw），仅满足类型
  throw new AiError('AI_OUTPUT_INVALID', 'AI output invalid after retries')
}

function buildUserPrompt<Input>(skill: AiSkill<Input, unknown>, input: Input, retrySummary: string | null): string {
  const base = skill.buildUserPrompt(input)
  if (!retrySummary) return base
  return `${base}\n\n[上一次输出未通过校验：${retrySummary}]\n请严格返回符合要求的纯 JSON，不要返回 Markdown、代码块或任何解释文字。`
}
