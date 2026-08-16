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
你的唯一职责是：把任务拆成 2~5 个有明确结果的阶段/子任务；后续会为每个阶段单独生成“现在就能开始”的最小行动。

严格规则：
1. 只返回 JSON，禁止 Markdown、禁止代码块、禁止任何解释文字。
2. 子任务数量 2~5 个。
3. 子任务必须是一个阶段性结果，可独立执行且有清晰完成状态，不要把所有阶段都写成“制定计划/准备材料/设置提醒”。
4. 子任务标题用结果导向的动词开头（如"完成"、"建立"、"开发"、"执行"、"检查"）。
   避免"思考一下""规划一下""研究一下"这类无法验证完成的模糊动作。
5. 对健身、家务、学习等生活任务，必须包含真正开始执行的阶段，而不是只生成计划阶段。
6. 避免重复，保持顺序，共同覆盖父任务；不要把一个阶段拆成多个琐碎动作。
7. 不要编造截止日期，不要返回长篇建议或鼓励话术。
8. 如果任务本身已经是明确的单一步骤，返回 shouldDecompose=false 且 children=[]。

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

  validate(value: unknown, input: TaskDecomposeInput): TaskDecomposeOutput {
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

    // 健身/运动类任务的第一版演示必须直接进入执行，不把准备环境当成阶段。
    // ponytail: 这是展示期的窄规则；后续用可配置的领域策略替代硬编码。
    if (/(健身|运动|锻炼|训练)/.test(input.title)) {
      const preparationStage = children.find(child =>
        /(准备|制定.*计划|规划|安排|设置.*提醒|记录|打卡|环境|装备|场地)/.test(child.title),
      )
      if (preparationStage) {
        throw new Error('physical task stages must start with execution, not preparation or tracking')
      }
    }

    return { shouldDecompose: r.shouldDecompose, children }
  },
}
