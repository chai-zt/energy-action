// ============================================================
// Task Decomposition Provider — 任务拆解 Provider 接口
// ============================================================

import type { DecompositionResult } from '@/domain/models'

export interface DecompositionProvider {
  decompose(title: string, description: string): Promise<DecompositionResult>
}

// ============================================================
// Mock Decomposition Provider — 模拟 AI 拆解
// ============================================================

const MOCK_TEMPLATES: Record<string, string[]> = {
  '开发': ['确认技术栈和工具链', '搭建项目骨架', '实现核心模块', '编写测试用例', '部署验证'],
  '学习': ['制定学习计划', '收集学习资料', '完成基础理论学习', '做练习题巩固', '总结复盘'],
  '写': ['明确写作目的和受众', '收集素材和参考资料', '起草初稿', '修改润色', '最终审核发布'],
  '设计': ['需求分析和用户调研', '构思设计方案', '制作原型或草图', '细化设计细节', '评审与修改'],
  '会议': ['明确会议议程', '准备会议材料', '确定参会人员', '预约会议室和时间'],
  '报告': ['收集数据和信息', '分析整理数据', '撰写报告初稿', '检查核对数据准确性', '排版并定稿'],
  '测试': ['理解测试需求', '编写测试用例', '执行测试', '记录测试结果', '提交测试报告'],
  '部署': ['确认部署环境', '准备部署包', '备份现有系统', '执行部署', '验证部署结果'],
  '整理': ['明确整理范围', '分类和归档', '清理无用内容', '标记和索引', '定期维护检查'],
  '规划': ['明确目标和范围', '收集背景信息', '分析当前状态', '制定行动计划', '设置检查节点'],
}

const MOCK_ACTIONS: Record<string, string> = {
  '开发': '打开代码编辑器，创建新的项目目录并初始化 git',
  '学习': '打开笔记本，写下今天要掌握的第一条概念',
  '写': '打开文档工具，在空白页面上写下标题和第一行',
  '设计': '打开设计工具，新建画布并设置尺寸和网格',
  '会议': '打开日历，确认会议时间并发送邀请链接',
  '报告': '打开收集数据的表格或工具，定位到最新数据源',
  '整理': '选定第一个要整理的文件夹或分类，创建三个子目录：保留、待处理、归档',
  '测试': '打开测试管理工具，查看最新的测试任务列表',
  '部署': '登录服务器或云平台控制台，确认当前运行状态',
  '规划': '在白板或笔记上画一个简单的时间线，标记关键日期',
}

function getMockSteps(title: string): string[] {
  for (const [key, steps] of Object.entries(MOCK_TEMPLATES)) {
    if (title.includes(key)) {
      return steps.slice(0, Math.min(steps.length, 3 + (title.length % 3)))
    }
  }
  // 默认步骤
  return ['明确目标和预期结果', '列出需要完成的子任务', '按优先级开始执行第一个子任务', '跟踪进度并调整计划']
}

function getMockAction(title: string): string {
  for (const [key, action] of Object.entries(MOCK_ACTIONS)) {
    if (title.includes(key)) return action
  }
  return `打开任务"${title.length > 15 ? title.slice(0, 15) + '...' : title}"的相关工具或页面，准备开始`
}

export class MockDecompositionProvider implements DecompositionProvider {
  async decompose(title: string, _description: string): Promise<DecompositionResult> {
    // 模拟 300-600ms 延迟
    await new Promise(r => setTimeout(r, 300 + Math.random() * 300))

    const steps = getMockSteps(title)
    const minAction = getMockAction(title)

    return {
      steps: steps.map((content, i) => ({ content, order: i + 1 })),
      minimumAction: {
        description: minAction,
        estimatedMinutes: Math.min(5 + steps.length * 3, 30),
        difficulty: (steps.length <= 2 ? 1 : steps.length <= 4 ? 2 : 3) as 1 | 2 | 3 | 4 | 5,
        aiGenerated: true,
      },
    }
  }
}
