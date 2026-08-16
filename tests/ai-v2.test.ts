import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const { taskDecomposeV2 } = await import('../server/ai/skills/taskDecomposeV2.ts')
const { minimumActionV2 } = await import('../server/ai/skills/minimumActionV2.ts')

const fitnessInput = { title: '坚持健身一个月', description: '', estimatedMinutes: 30, cognitiveLoad: 'medium', energyDemand: 3 }

describe('task-decompose-v2', () => {
  it('保留阶段类型并允许启动/计划/执行三段结构', () => {
    const result = taskDecomposeV2.validate({
      shouldDecompose: true,
      children: [
        { title: '完成第一次低门槛训练', description: '', estimatedMinutes: 10, stageType: 'activation' },
        { title: '建立本周训练节奏', description: '', estimatedMinutes: 10, stageType: 'planning' },
        { title: '执行并巩固训练模式', description: '', estimatedMinutes: 10, stageType: 'execution' },
      ],
    }, fitnessInput)
    assert.deepEqual(result.children.map(child => child.stageType), ['activation', 'planning', 'execution'])
  })

  it('禁止健身任务把准备环境作为阶段', () => {
    assert.throws(() => taskDecomposeV2.validate({
      shouldDecompose: true,
      children: [
        { title: '准备健身装备和环境', description: '', estimatedMinutes: 5, stageType: 'planning' },
        { title: '完成第一次训练', description: '', estimatedMinutes: 10, stageType: 'execution' },
      ],
    }, fitnessInput))
  })
})

describe('minimum-action-v2', () => {
  it('允许计划阶段使用具体计划动作', () => {
    const result = minimumActionV2.validate({
      actions: [{
        taskRef: 'child-0',
        description: '打开手机日历，选出本周三天并写下训练时间。',
        estimatedMinutes: 3,
        difficulty: 1,
      }],
    }, { energyLevel: 'medium', tasks: [{
      taskRef: 'child-0', title: '建立本周训练节奏', description: '', stageType: 'planning',
    }] })
    assert.equal(result.actions[0].taskRef, 'child-0')
  })

  it('不因动作语义而阻塞结构合法的阶段结果', () => {
    const result = minimumActionV2.validate({
      actions: [{ taskRef: 'child-0', description: '制定健身计划。', estimatedMinutes: 2, difficulty: 1 }],
    }, { energyLevel: 'low', tasks: [{
      taskRef: 'child-0', title: '完成第一次低门槛训练', description: '', stageType: 'activation',
    }] })
    assert.equal(result.actions[0].description, '制定健身计划。')
  })
})
