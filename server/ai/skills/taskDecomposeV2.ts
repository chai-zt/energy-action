// ============================================================
// Skill: task-decompose-v2
//
// 把大任务拆成有阶段语义的 Child Tasks，供 v2 最小行动 Skill 对齐生成。
// ============================================================

import type { AiSkill } from '../harness.ts'

export type TaskStageType = 'activation' | 'planning' | 'execution' | 'review'

export interface TaskDecomposeInputV2 {
  title: string
  description: string
  estimatedMinutes?: number
  cognitiveLoad?: string
  energyDemand?: number
}

export interface TaskDecomposeChildV2 {
  title: string
  description: string
  estimatedMinutes: number
  stageType: TaskStageType
}

export interface TaskDecomposeOutputV2 {
  shouldDecompose: boolean
  children: TaskDecomposeChildV2[]
}

const STAGE_TYPES: TaskStageType[] = ['activation', 'planning', 'execution', 'review']

const SYSTEM_PROMPT = `你是一个个人执行系统的任务阶段拆解助手。

用户已经主动选择“大任务，需要拆解”。请把任务拆成 2~5 个按顺序推进的阶段，并为每个阶段标注 stageType。

阶段类型：
- activation：第一次真正开始做，不是准备环境
- planning：为后续执行做一个具体、短小的安排
- execution：直接完成任务的一部分
- review：检查结果、记录反馈或调整下一步

严格规则：
1. 只返回 JSON，禁止 Markdown、解释和鼓励话术。
2. 阶段是有结果的里程碑，不是零散待办清单。
3. 不要求每种 stageType 都出现，但行动型任务至少要有 activation 或 execution 阶段。
4. 不要默认生成“准备环境、准备装备、拍环境照”阶段；只有用户明确要求准备时才允许。
5. 健身、家务、学习等生活任务必须尽快进入真正执行，不要先连续安排计划、打卡和复盘。
6. planning 阶段可以存在，但标题必须说明它要建立什么节奏或安排；review 阶段必须放在执行之后。
7. 标题用结果导向的动词开头，避免“思考一下、研究一下、了解一下”。
8. 不要编造日期；不要把一个阶段拆成多个琐碎动作。

健身示例：
- “完成第一次低门槛训练” / activation
- “建立本周三次训练节奏” / planning
- “执行并巩固训练模式” / execution

输出结构：
{
  "shouldDecompose": true,
  "children": [
    { "title": "完成第一次低门槛训练", "description": "完成一次短训练", "estimatedMinutes": 10, "stageType": "activation" }
  ]
}`

export const taskDecomposeV2: AiSkill<TaskDecomposeInputV2, TaskDecomposeOutputV2> = {
  id: 'task-decompose-v2',
  version: '2',
  maxTokens: 2200,

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

  validate(value: unknown, input: TaskDecomposeInputV2): TaskDecomposeOutputV2 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object')
    const r = value as Record<string, unknown>
    if (typeof r.shouldDecompose !== 'boolean') throw new Error('shouldDecompose must be boolean')
    if (!Array.isArray(r.children)) throw new Error('children must be an array')
    if (r.shouldDecompose && (r.children.length === 0 || r.children.length > 5)) {
      throw new Error('children must contain 1..5 items when shouldDecompose=true')
    }

    const children = r.children.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('each child must be an object')
      const child = raw as Record<string, unknown>
      if (typeof child.title !== 'string' || child.title.trim() === '') throw new Error('child.title must be non-empty')
      if (typeof child.description !== 'string') throw new Error('child.description must be a string')
      if (typeof child.estimatedMinutes !== 'number' || child.estimatedMinutes < 0) {
        throw new Error('child.estimatedMinutes must be a number >= 0')
      }
      const stageType = child.stageType == null ? 'execution' : child.stageType
      if (!STAGE_TYPES.includes(stageType as TaskStageType)) throw new Error('child.stageType is invalid')
      return {
        title: child.title.trim(),
        description: child.description,
        estimatedMinutes: child.estimatedMinutes,
        stageType: stageType as TaskStageType,
      }
    })

    if (/(健身|运动|锻炼|训练)/.test(input.title)) {
      if (children.some(child => /(准备|环境|装备|场地|拍照)/.test(child.title))) {
        throw new Error('fitness stages must start execution, not environment preparation or tracking')
      }
      if (children.length > 0 && !children.some(child => child.stageType === 'activation' || child.stageType === 'execution')) {
        throw new Error('fitness decomposition must include activation or execution')
      }
    }

    return { shouldDecompose: r.shouldDecompose, children }
  },
}
