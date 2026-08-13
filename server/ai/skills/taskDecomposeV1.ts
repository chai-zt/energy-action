// ============================================================
// Skill: task-decompose-v1
//
// 把用户授权拆解的 Task 转成有限数量真正可执行的 Child Tasks。
// ============================================================

import type { AiSkill } from '../harness.ts'

export interface TaskDecomposeInput {
  title: string
  description: string
  estimatedMinutes?: number
  cognitiveLoad?: string
  energyDemand?: number
}

export interface TaskDecomposeChild {
  title: string
  description: string
  estimatedMinutes: number
}

export interface TaskDecomposeOutput {
  shouldDecompose: boolean
  children: TaskDecomposeChild[]
}

const SYSTEM_PROMPT = `你是一个个人执行系统的任务拆解助手。

用户已经主动选择「大任务，需要拆解」，这代表拆解授权已经明确。
你的唯一职责是：把任务拆成 2~5 个可以直接执行的子任务。

严格规则：
1. 只返回 JSON，禁止 Markdown、禁止代码块、禁止任何解释文字。
2. 子任务数量 2~5 个。
3. 每个子任务必须是明确、可独立执行、有清晰完成状态的动作。
4. 子任务标题用动词开头（如"写"、"打开"、"创建"、"确认"），
   避免"思考一下""规划一下""研究一下"这类无法验证完成的模糊动作。
5. 避免重复，保持顺序，共同覆盖父任务。
6. 不要编造截止日期，不要返回长篇建议或鼓励话术。
7. 如果任务本身已经是明确的单一步骤，返回 shouldDecompose=false 且 children=[]。

输出 JSON 结构：
{
  "shouldDecompose": true,
  "children": [
    { "title": "确认技术栈", "description": "列出前端、后端、数据库选型", "estimatedMinutes": 15 }
  ]
}`

export const taskDecomposeV1: AiSkill<TaskDecomposeInput, TaskDecomposeOutput> = {
  id: 'task-decompose-v1',
  version: '1',
  maxTokens: 2000,

  buildSystemPrompt() {
    return SYSTEM_PROMPT
  },

  buildUserPrompt(input) {
    const lines = [`任务标题：${input.title}`]
    if (input.description) lines.push(`任务描述：${input.description}`)
    if (input.estimatedMinutes != null) lines.push(`预计耗时：${input.estimatedMinutes} 分钟`)
    if (input.cognitiveLoad) lines.push(`认知负荷：${input.cognitiveLoad}`)
    if (input.energyDemand != null) lines.push(`精力消耗：${input.energyDemand}（1-5）`)
    return lines.join('\n')
  },

  validate(value: unknown): TaskDecomposeOutput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object')
    const r = value as Record<string, unknown>

    if (typeof r.shouldDecompose !== 'boolean') throw new Error('shouldDecompose must be boolean')
    if (!Array.isArray(r.children)) throw new Error('children must be an array')

    if (r.shouldDecompose) {
      if (r.children.length === 0) throw new Error('children must be non-empty when shouldDecompose=true')
      if (r.children.length > 5) throw new Error('children must be at most 5')
    }

    const children = r.children.map((c: unknown) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('each child must be an object')
      const child = c as Record<string, unknown>
      if (typeof child.title !== 'string' || child.title.trim() === '') {
        throw new Error('child.title must be a non-empty string')
      }
      if (typeof child.description !== 'string') throw new Error('child.description must be a string')
      if (typeof child.estimatedMinutes !== 'number' || child.estimatedMinutes < 0) {
        throw new Error('child.estimatedMinutes must be a number >= 0')
      }
      return {
        title: child.title.trim(),
        description: child.description,
        estimatedMinutes: child.estimatedMinutes,
      }
    })

    return { shouldDecompose: r.shouldDecompose, children }
  },
}
