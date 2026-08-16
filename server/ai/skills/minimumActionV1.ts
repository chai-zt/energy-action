// ============================================================
// Skill: minimum-action-v1
//
// 产品核心：为每个任务生成"现在就能开始、约 60 秒内启动"的最小行动。
// ============================================================

import type { AiSkill } from '../harness.ts'
import type { EnergyLevel } from '../../../src/domain/models.ts'

export interface MinimumActionInputTask {
  taskRef: string
  title: string
  description: string
}

export interface MinimumActionInput {
  tasks: MinimumActionInputTask[]
  energyLevel: EnergyLevel
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

"最小行动"是产品核心：对每个阶段，给出一个用户现在马上就能开始、约 60 秒内能启动、优先 1~5 分钟（最多 10 分钟）能完成的单一具体动作。

严格规则：
1. 只返回 JSON，禁止 Markdown、禁止代码块、禁止解释文字。
2. 每个任务最多一个最小行动。
3. 最小行动必须：现在就能开始、不依赖额外规划、足够具体、单一动作、有明显完成边界；目标是先让身体或双手开始动起来。
4. 优先生成身体或现场启动动作（如"穿上运动鞋"、"走到门口"、"做 3 个俯卧撑"、"拿起书并翻到指定页"）。
5. 用具体动作描述（"打开什么、写下什么、拿起什么、走到哪里"），
   禁止"开始做 X""规划 X""思考 X""研究 X""了解 X"这类模糊表述。
6. 除非任务本身就是计划、记录或准备，否则禁止把“制定计划、准备装备、设置提醒、记录训练、搜索资料”当作最小行动。
7. taskRef 必须与输入完全一致，不得凭空新增 taskRef。
8. estimatedMinutes 1~10；difficulty 1~5，优先 1~3。

当前精力水平（low / medium / high）只决定动作的"启动门槛"，不改变"最小行动"本身：
- low（低精力）：给出阻力最低的启动动作（健身例：穿上运动鞋，站到门口；写作例：打开文档并写下标题）。
- medium（中精力）：给出已经进入执行状态的小动作（健身例：下楼快走 5 分钟；写作例：写出第一句话）。
- high（高精力）：仍然必须是最小行动，只是可以稍微更有挑战、更需专注；禁止变成"完成整个项目""写完整份报告""工作 2 小时"这类大任务。estimatedMinutes 上限 10 分钟始终不变。

健身示例：阶段“完成第一次训练”在 low 时优先输出“现在穿上运动鞋，站到门口”，在 medium 时优先输出“现在下楼，快走 5 分钟”，在 high 时可以输出“现在做 3 个俯卧撑”。不要输出“制定 12 周计划”或“准备运动装备”。

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

      const description = action.description.trim()
      // 这不是文案偏好，而是产品核心边界：最小行动不能把用户留在计划/准备阶段。
      // ponytail: 展示期先用窄启发式拦截；后续用评测集和领域策略替代。
      if (/(准备|计划|规划|环境|场地|装备|设置.*提醒|记录|打卡|拍.*照|搜索|研究|思考|了解)/.test(description)) {
        throw new Error('minimum action must start execution, not planning, preparation, tracking, or research')
      }

      if (!/^(现在)?\s*(穿|拿|走|下楼|做|打开|新建|创建|写|输入|点击|发送|拨打|读|翻|放|站|开始|确认|完成|执行|取|移动|扫|洗|收|吃|喝)/.test(description)) {
        throw new Error('minimum action must begin with a concrete immediate verb')
      }
      if (typeof action.estimatedMinutes !== 'number' || action.estimatedMinutes < 1 || action.estimatedMinutes > 10) {
        throw new Error('action.estimatedMinutes must be 1..10')
      }
      if (typeof action.difficulty !== 'number' || action.difficulty < 1 || action.difficulty > 5) {
        throw new Error('action.difficulty must be 1..5')
      }

      return {
        taskRef: action.taskRef,
        description,
        estimatedMinutes: action.estimatedMinutes,
        difficulty: action.difficulty,
      }
    })

    return { actions }
  },
}
