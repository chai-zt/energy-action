import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage()

// 先打开 dev 服务器上的页面，等待 IndexedDB 初始化
await page.goto('http://localhost:3173', { waitUntil: 'networkidle', timeout: 15000 })
await page.waitForTimeout(2000)

// 通过 evaluate 直接写入 IndexedDB
const result = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('PersonalAIOS')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const tx = db.transaction(['tasks'], 'readwrite')
  const now = new Date().toISOString()
  const today = now.split('T')[0]

  const tasks = [
    { name: '回复客户邮件', energy: 1, min: 3 },
    { name: '更新今日待办列表', energy: 1, min: 3 },
    { name: '整理本周文件归档', energy: 2, min: 15 },
    { name: '回复团队消息', energy: 2, min: 15 },
    { name: '写完周报', energy: 3, min: 30 },
    { name: '阅读产品文档', energy: 3, min: 30 },
    { name: '完成API接口开发', energy: 4, min: 60 },
    { name: '编写技术方案', energy: 4, min: 45 },
    { name: '系统架构重构', energy: 5, min: 120 },
    { name: '年度规划报告', energy: 5, min: 120 },
  ]

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    tx.objectStore('tasks').put({
      id: 'energy-test-' + (i + 1),
      title: t.name, description: '',
      projectId: null, goalId: null, keyResultId: null, columnId: null,
      status: 'todo', userPriority: null,
      aiPriorityScore: 100 - i * 8,
      aiPriorityLevel: i < 2 ? 'P0' : i < 4 ? 'P1' : i < 6 ? 'P2' : 'P3',
      aiPriorityReason: 'energy test ' + i,
      dueDate: null, plannedDate: today,
      estimatedMinutes: t.min, actualMinutes: 0,
      cognitiveLoad: 'medium', energyDemand: t.energy,
      recurrenceRule: null, isHabit: false, completedAt: null,
      parentTaskId: null, order: i * 10,
      createdAt: now, updatedAt: now, deletedAt: null,
    })
  }
  await new Promise(r => { tx.oncomplete = r })
  db.close()
  return '10 OK'
})

console.log(result)
await browser.close()
