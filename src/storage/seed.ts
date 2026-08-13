// ============================================================
// 种子数据 — 首次打开时的示例数据
// ============================================================

import { generateId, today, now } from '@/lib/utils'
import type {
  Goal, KeyResult, Project, ProjectColumn, Task, CompletionRecord,
  DailyState, DailyReview, AppSettings, Tag,
} from '@/domain/models'

export async function seedDataIfEmpty(): Promise<void> {
  const { db } = await import('@/storage/db')
  // 等待 DB 完全就绪（Dexie v2→v3 升级可能需时间）
  await db.open()
  const goalCount = await db.goals.filter(g => !g.deletedAt).count()
  if (goalCount > 0) return // 已有数据，不重复种子

  const nowStr = now()
  const todayStr = today()

  // 今天的日期 和 前几天的日期
  const d = new Date()
  const yesterday = new Date(d.getTime() - 86400000).toISOString().split('T')[0]
  const d2 = new Date(d.getTime() - 2 * 86400000).toISOString().split('T')[0]
  const d7 = new Date(d.getTime() - 7 * 86400000).toISOString().split('T')[0]

  // --- 设置 ---
  const settings: AppSettings = {
    id: 'default',
    pomodoroWorkMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroLongBreakInterval: 4,
    lastCalendarView: 'week',
    quietHoursStart: null,
    quietHoursEnd: null,
    pomodoroPresetId: 'standard',
    pomodoroCustomWork: 25,
    pomodoroCustomShortBreak: 5,
    pomodoroCustomLongBreak: 15,
    pomodoroCustomLongInterval: 4,
    createdAt: nowStr,
    updatedAt: nowStr,
  }

  // --- 标签 ---
  const habitTag: Tag = {
    id: generateId(),
    name: '习惯',
    color: '#10b981',
    createdAt: nowStr,
  }

  const importantTag: Tag = {
    id: generateId(),
    name: '重要',
    color: '#ef4444',
    createdAt: nowStr,
  }

  // --- 年度目标 ---
  const yearlyGoal: Goal = {
    id: generateId(),
    title: '2026 年度个人成长',
    description: '全面提升工作效率、健康水平和学习能力',
    level: 'yearly',
    parentGoalId: null,
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    status: 'active',
    progressMode: 'key_result',
    manualProgress: 0,
    domain: 'work',
    sortOrder: 1,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // --- 季度目标 ---
  const q3Goal: Goal = {
    id: generateId(),
    title: '2026 Q3 建立个人效率系统',
    description: '完成 Personal AI OS MVP 开发，建立每日执行和复盘习惯',
    level: 'quarterly',
    parentGoalId: yearlyGoal.id,
    startDate: '2026-07-01',
    dueDate: '2026-09-30',
    status: 'active',
    progressMode: 'key_result',
    manualProgress: 0,
    domain: 'work',
    sortOrder: 1,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // --- KR ---
  const kr1: KeyResult = {
    id: generateId(),
    goalId: q3Goal.id,
    title: '完成 V0.1 开发并发布',
    description: '实现目标-项目-任务-日历-番茄钟-复盘完整闭环',
    metricType: 'boolean',
    startValue: 0,
    currentValue: 0.4,
    targetValue: 1,
    dueDate: '2026-08-31',
    status: 'active',
    weight: 0.5,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  const kr2: KeyResult = {
    id: generateId(),
    goalId: q3Goal.id,
    title: '连续 30 天保持每日复盘',
    description: '建立每日复盘习惯',
    metricType: 'number',
    startValue: 0,
    currentValue: 5,
    targetValue: 30,
    dueDate: '2026-09-30',
    status: 'active',
    weight: 0.3,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  const kr3: KeyResult = {
    id: generateId(),
    goalId: q3Goal.id,
    title: '每周运动 3 次',
    description: '改善健康状况',
    metricType: 'number',
    startValue: 0,
    currentValue: 2,
    targetValue: 12,
    dueDate: '2026-09-30',
    status: 'active',
    weight: 0.2,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // --- 项目 ---
  const project: Project = {
    id: generateId(),
    name: 'Personal AI OS 开发',
    description: '开发个人 AI 工作操作系统 V0.1',
    goalId: q3Goal.id,
    keyResultId: kr1.id,
    status: 'active',
    priority: 1,
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    progress: 35,
    progressMode: 'task',
    color: '#3b82f6',
    icon: 'code',
    completedAt: null,
    createdAt: nowStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // --- 看板列 ---
  const colTodo: ProjectColumn = {
    id: generateId(),
    projectId: project.id,
    name: 'Todo',
    order: 0,
    color: '#94a3b8',
    createdAt: nowStr,
    updatedAt: nowStr,
  }
  const colDoing: ProjectColumn = {
    id: generateId(),
    projectId: project.id,
    name: 'Doing',
    order: 1,
    color: '#3b82f6',
    createdAt: nowStr,
    updatedAt: nowStr,
  }
  const colDone: ProjectColumn = {
    id: generateId(),
    projectId: project.id,
    name: 'Done',
    order: 2,
    color: '#22c55e',
    createdAt: nowStr,
    updatedAt: nowStr,
  }

  // --- 任务 ---
  // 已完成的任务 (Done)
  const task1: Task = {
    id: generateId(),
    title: '完成数据库 schema 设计',
    description: '',
    projectId: project.id,
    goalId: q3Goal.id,
    keyResultId: kr1.id,
    columnId: colDone.id,
    status: 'done',
    userPriority: 1,
    aiPriorityScore: 0,
    aiPriorityLevel: null,
    aiPriorityReason: '',
    dueDate: d2,
    plannedDate: d2,
    estimatedMinutes: 120,
    actualMinutes: 150,
    cognitiveLoad: 'high',
    energyDemand: 4,
    recurrenceRule: null,
    isHabit: false,
    completedAt: d2 + 'T18:00:00.000Z',
    parentTaskId: null,
    order: 0,
    createdAt: d7,
    updatedAt: d2 + 'T18:00:00.000Z',
    deletedAt: null,
  }

  // 进行中的任务 (Doing)
  const task2: Task = {
    id: generateId(),
    title: '实现日历五视图与拖拽排期',
    description: '日/周/月/年/列表视图，未排期任务区，拖拽交互',
    projectId: project.id,
    goalId: q3Goal.id,
    keyResultId: kr1.id,
    columnId: colDoing.id,
    status: 'doing',
    userPriority: 1,
    aiPriorityScore: 90,
    aiPriorityLevel: 'P0',
    aiPriorityReason: '关键路径任务，截止日期临近',
    dueDate: '2026-08-10',
    plannedDate: todayStr,
    estimatedMinutes: 240,
    actualMinutes: 60,
    cognitiveLoad: 'high',
    energyDemand: 5,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: d2,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // 待办任务 (Todo) — 今天的
  const task3: Task = {
    id: generateId(),
    title: '完成番茄钟模块开发',
    description: '实现计时器、休息周期、刷新恢复',
    projectId: project.id,
    goalId: q3Goal.id,
    keyResultId: kr1.id,
    columnId: colTodo.id,
    status: 'todo',
    userPriority: 2,
    aiPriorityScore: 85,
    aiPriorityLevel: 'P1',
    aiPriorityReason: '依赖日历完成，但可并行开发',
    dueDate: '2026-08-12',
    plannedDate: todayStr,
    estimatedMinutes: 180,
    actualMinutes: 0,
    cognitiveLoad: 'medium',
    energyDemand: 3,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: d2,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // 逾期任务 — 昨天的，未完成
  const task4: Task = {
    id: generateId(),
    title: '编写 Repository 接口文档',
    description: '整理所有 Repository 接口的使用说明',
    projectId: project.id,
    goalId: q3Goal.id,
    keyResultId: kr1.id,
    columnId: colTodo.id,
    status: 'todo',
    userPriority: 3,
    aiPriorityScore: 95,
    aiPriorityLevel: 'P0',
    aiPriorityReason: '已逾期 1 天，需尽快完成',
    dueDate: yesterday,
    plannedDate: yesterday,
    estimatedMinutes: 60,
    actualMinutes: 0,
    cognitiveLoad: 'low',
    energyDemand: 2,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: d7,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // 习惯任务 — 每日复盘
  const habitTask1: Task = {
    id: generateId(),
    title: '每日复盘',
    description: '回顾今天完成的任务、收获和明天计划',
    projectId: null,
    goalId: q3Goal.id,
    keyResultId: kr2.id,
    columnId: null,
    status: 'todo',
    userPriority: 2,
    aiPriorityScore: 60,
    aiPriorityLevel: 'P2',
    aiPriorityReason: '固定每日习惯，建议晚间完成',
    dueDate: null,
    plannedDate: todayStr,
    estimatedMinutes: 15,
    actualMinutes: 0,
    cognitiveLoad: 'low',
    energyDemand: 2,
    recurrenceRule: 'FREQ=DAILY',
    isHabit: true,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: d7,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // 习惯任务 — 运动
  const habitTask2: Task = {
    id: generateId(),
    title: '运动 30 分钟',
    description: '跑步或力量训练',
    projectId: null,
    goalId: q3Goal.id,
    keyResultId: kr3.id,
    columnId: null,
    status: 'todo',
    userPriority: 3,
    aiPriorityScore: 50,
    aiPriorityLevel: 'P2',
    aiPriorityReason: '固定健康习惯',
    dueDate: null,
    plannedDate: todayStr,
    estimatedMinutes: 30,
    actualMinutes: 0,
    cognitiveLoad: 'low',
    energyDemand: 4,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    isHabit: true,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: d7,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // 收件箱任务
  const task5: Task = {
    id: generateId(),
    title: '研究 React 19 新特性',
    description: '了解 Server Components 和 Actions',
    projectId: null,
    goalId: null,
    keyResultId: null,
    columnId: null,
    status: 'inbox',
    userPriority: null,
    aiPriorityScore: 20,
    aiPriorityLevel: 'P3',
    aiPriorityReason: '无截止日期，无项目关联',
    dueDate: null,
    plannedDate: null,
    estimatedMinutes: 60,
    actualMinutes: 0,
    cognitiveLoad: 'medium',
    energyDemand: 2,
    recurrenceRule: null,
    isHabit: false,
    completedAt: null,
    parentTaskId: null,
    order: 0,
    createdAt: todayStr,
    updatedAt: nowStr,
    deletedAt: null,
  }

  // --- 完成记录（模拟之前的习惯完成）---
  const completions: CompletionRecord[] = []
  for (let i = 1; i <= 5; i++) {
    const date = new Date(d.getTime() - i * 86400000).toISOString().split('T')[0]
    completions.push({
      id: generateId(),
      taskId: habitTask1.id,
      completedDate: date,
      completedAt: date + 'T22:00:00.000Z',
      status: 'completed' as const,
      energyCostSnapshot: 20,
      taskTitleSnapshot: habitTask1.title,
      projectIdSnapshot: null,
      createdAt: date + 'T22:00:00.000Z',
    })
  }

  // --- 每日状态（昨天的）---
  const yesterdayState: DailyState = {
    id: generateId(),
    date: yesterday,
    energyScore: 7,
    moodScore: 6,
    stressScore: 5,
    sleepHours: 7,
    sleepQuality: 6,
    availableMinutes: 480,
    note: '效率不错，下午略有疲劳',
    createdAt: yesterday + 'T22:00:00.000Z',
    updatedAt: yesterday + 'T22:00:00.000Z',
  }

  // --- 每日复盘（昨天的）---
  const yesterdayReview: DailyReview = {
    id: generateId(),
    date: yesterday,
    completed: '完成了数据库 schema 设计，开始日历模块开发',
    uncompleted: 'Repository 接口文档未完成',
    uncompletedReason: '下午被其他事情打断',
    biggestGain: '日历五视图的交互方案确定',
    mostDraining: '长时间 coding 缺少休息',
    tomorrowTop3: '1. 完成日历拖拽 2. 完成番茄钟 3. 编写文档',
    knowledgeToSave: 'FullCalendar 自定义视图的实现方式',
    isDraft: false,
    uncompletedTaskIds: [],
    uncompletedTaskSnapshots: [],
    createdAt: yesterday + 'T22:30:00.000Z',
    updatedAt: yesterday + 'T22:30:00.000Z',
  }

  // --- 批量写入 ---
  await db.transaction('rw', db.tables.map(t => t.name as any), async () => {
    await db.appSettings.add(settings)
    await db.tags.bulkAdd([habitTag, importantTag])
    await db.goals.bulkAdd([yearlyGoal, q3Goal])
    await db.keyResults.bulkAdd([kr1, kr2, kr3])
    await db.projects.add(project)
    await db.projectColumns.bulkAdd([colTodo, colDoing, colDone])
    await db.tasks.bulkAdd([task1, task2, task3, task4, task5, habitTask1, habitTask2])
    await db.completionRecords.bulkAdd(completions)
    await db.dailyStates.add(yesterdayState)
    await db.dailyReviews.add(yesterdayReview)
  })

  console.log('[Seed] 种子数据已写入')
}
