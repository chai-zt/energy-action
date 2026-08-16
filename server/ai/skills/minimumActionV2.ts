// ============================================================
// Skill: minimum-action-v2
//
// 为每个阶段生成与阶段语义一致的下一步最小行动。
// ============================================================

import type { AiSkill } from '../harness.ts'
import type { EnergyLevel } from '../../../src/domain/models.ts'
import type { TaskStageType } from './taskDecomposeV2.ts'

export interface MinimumActionInputTaskV2 {
  taskRef: string
  title: string
  description: string
  stageType: TaskStageType
}

export interface MinimumActionInputV2 {
  tasks: MinimumActionInputTaskV2[]
  energyLevel: EnergyLevel
}

export interface MinimumActionItemV2 {
  taskRef: string
  description: string
  estimatedMinutes: number
  difficulty: number
}

export interface MinimumActionOutputV2 {
  actions: MinimumActionItemV2[]
}

const SYSTEM_PROMPT = `你是个人执行系统的“最小行动”助手。

最小行动不是固定的身体动作，而是“推进当前阶段的最小下一步”。它必须现在可以开始，优先 1~5 分钟，最多 10 分钟，有明确完成边界。

按阶段类型生成：
- activation：直接启动，优先身体或现场动作；不得先准备环境、制定计划或记录。
- planning：允许计划动作，但必须具体，例如打开日历、选出三天并写下训练时间；禁止只说“制定计划”。
- execution：直接完成阶段的一小段，不要重新规划。
- review：完成一次具体检查、记录或回答，不要泛泛地说“复盘一下”。

通用规则：
1. 只返回 JSON；尽量为每个输入阶段返回一个行动，每个阶段最多一个；即使个别阶段没有行动，也不能影响其他阶段和阶段树保存。
2. 一个行动必须足够具体、可观察、可判断完成。
3. 尽量避免“准备环境、准备装备、拍环境照、搜索资料、研究方法”；如果模型确实生成了动作，也应保留显示，不因措辞不理想而阻塞阶段。
4. 尽量使用有完成边界的表达，但最小行动属于附加信息，不因自然语言差异而让整个阶段失败。
5. 当前精力只调整启动门槛，不改变阶段目标。

健身示例：
- activation + low：现在穿上运动鞋，站到门口。
- planning + medium：打开手机日历，选出本周三天并写下训练时间。
- execution + high：现在做一组开合跳，持续 30 秒。

输出结构：
{ "actions": [{ "taskRef": "child-0", "description": "现在穿上运动鞋，站到门口。", "estimatedMinutes": 1, "difficulty": 1 }] }`

export const minimumActionV2: AiSkill<MinimumActionInputV2, MinimumActionOutputV2> = {
  id: 'minimum-action-v2',
  version: '2',
  maxTokens: 1400,

  buildSystemPrompt() {
    return SYSTEM_PROMPT
  },

  buildUserPrompt(input) {
    const taskLines = input.tasks.map(task =>
      `- [${task.taskRef}] stageType=${task.stageType} ${task.title}${task.description ? `：${task.description}` : ''}`,
    ).join('\n')
    return `当前精力水平：${input.energyLevel}\n\n需要生成最小行动的阶段：\n${taskLines}`
  },

  validate(value: unknown, input: MinimumActionInputV2): MinimumActionOutputV2 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object')
    const r = value as Record<string, unknown>
    if (!Array.isArray(r.actions)) throw new Error('actions must be an array')
    if (r.actions.length > input.tasks.length) throw new Error('actions count must not exceed input tasks count')

    const taskByRef = new Map(input.tasks.map(task => [task.taskRef, task]))
    const seenRefs = new Set<string>()
    const actions = r.actions.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('each action must be an object')
      const action = raw as Record<string, unknown>
      if (typeof action.taskRef !== 'string' || !taskByRef.has(action.taskRef)) throw new Error('action.taskRef is invalid')
      if (seenRefs.has(action.taskRef)) throw new Error(`duplicate taskRef "${action.taskRef}"`)
      seenRefs.add(action.taskRef)
      if (typeof action.description !== 'string' || action.description.trim() === '') throw new Error('action.description must be non-empty')
      if (typeof action.estimatedMinutes !== 'number' || action.estimatedMinutes < 1 || action.estimatedMinutes > 10) {
        throw new Error('action.estimatedMinutes must be 1..10')
      }
      if (typeof action.difficulty !== 'number' || action.difficulty < 1 || action.difficulty > 5) throw new Error('action.difficulty must be 1..5')

      const description = action.description.trim()
      // Minimum Action 是阶段结果的附加信息，不阻塞阶段保存。
      // 保留 stageType 读取以维持契约，暂不对自然语言动作做语义拦截。
      void taskByRef.get(action.taskRef)!.stageType

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
