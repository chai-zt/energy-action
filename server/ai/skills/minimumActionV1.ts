// ============================================================
// Skill: minimum-action-v1
//
// 产品核心：为每个任务生成"现在就能开始、约 60 秒内启动"的最小行动。
// ============================================================

import type { AiSkill } from '../harness.ts'

export interface MinimumActionInputTask {
  taskRef: string
  title: string
  description: string
}

export interface MinimumActionInput {
  tasks: MinimumActionInputTask[]
  energyLevel: 'low' | 'medium' | 'high'
}

export interface MinimumActionItem {
  taskRef: string
  description: string
  estimatedMinutes: number
  difficulty: number
}

export interface MinimumActionOutput {
  actions: MinimumActionItem[]
}

const SYSTEM_PROMPT = `你是一个个人执行系统的"最小行动"助手。

"最小行动"是产品核心：对每个任务，给出一个用户现在就能开始、约 60 秒内就能启动、1~10 分钟能完成的单一具体动作。

严格规则：
1. 只返回 JSON，禁止 Markdown、禁止代码块、禁止解释文字。
2. 每个任务最多一个最小行动。
3. 最小行动必须：现在就能开始、不依赖额外规划、足够具体、单一动作、有明显完成边界。
4. 用具体动作描述（"打开什么、写下什么、创建什么"），
   禁止"开始做 X""规划 X""思考 X"这类模糊表述。
5. taskRef 必须与输入完全一致，不得凭空新增 taskRef。
6. estimatedMinutes 1~10；difficulty 1~5，优先 1~3。

输出 JSON 结构：
{
  "actions": [
    { "taskRef": "child-0", "description": "打开 PPT，新建封面页，写下项目名 Energy Action 和一句话定位。", "estimatedMinutes": 3, "difficulty": 1 }
  ]
}`

export const minimumActionV1: AiSkill<MinimumActionInput, MinimumActionOutput> = {
  id: 'minimum-action-v1',
  version: '1',
  maxTokens: 1200,

  buildSystemPrompt() {
    return SYSTEM_PROMPT
  },

  buildUserPrompt(input) {
    const taskLines = input.tasks.map(t =>
      `- [${t.taskRef}] ${t.title}${t.description ? `：${t.description}` : ''}`,
    ).join('\n')
    return `当前精力水平：${input.energyLevel}\n\n需要生成最小行动的任务：\n${taskLines}`
  },

  validate(value: unknown, input: MinimumActionInput): MinimumActionOutput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object')
    const r = value as Record<string, unknown>
    if (!Array.isArray(r.actions)) throw new Error('actions must be an array')

    const validRefs = new Set(input.tasks.map(t => t.taskRef))
    if (r.actions.length > input.tasks.length) {
      throw new Error('actions count must not exceed input tasks count')
    }

    const seenRefs = new Set<string>()
    const actions = r.actions.map((a: unknown) => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('each action must be an object')
      const action = a as Record<string, unknown>

      if (typeof action.taskRef !== 'string' || action.taskRef.trim() === '') {
        throw new Error('action.taskRef must be a non-empty string')
      }
      if (!validRefs.has(action.taskRef)) throw new Error(`action.taskRef "${action.taskRef}" not in input`)
      if (seenRefs.has(action.taskRef)) throw new Error(`duplicate taskRef "${action.taskRef}"`)
      seenRefs.add(action.taskRef)

      if (typeof action.description !== 'string' || action.description.trim() === '') {
        throw new Error('action.description must be a non-empty string')
      }
      if (typeof action.estimatedMinutes !== 'number' || action.estimatedMinutes < 1 || action.estimatedMinutes > 10) {
        throw new Error('action.estimatedMinutes must be 1..10')
      }
      if (typeof action.difficulty !== 'number' || action.difficulty < 1 || action.difficulty > 5) {
        throw new Error('action.difficulty must be 1..5')
      }

      return {
        taskRef: action.taskRef,
        description: action.description.trim(),
        estimatedMinutes: action.estimatedMinutes,
        difficulty: action.difficulty,
      }
    })

    return { actions }
  },
}
