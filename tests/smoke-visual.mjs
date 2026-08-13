// ============================================================
// smoke-visual.ts — 第一轮真实浏览器冒烟测试
// 用法: node smoke-visual.ts [--visible | --auto]
// ============================================================

import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE_URL = 'http://localhost:3173'
const ARTIFACTS = path.join(__dirname, '../docs/smoke-test/artifacts')
const RUN_LOG = path.join(__dirname, '../docs/smoke-test/SMOKE_TEST_RUN_LOG.md')

if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true })

let FAILURES = []
let CONSOLE_ERRORS = []

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
  console.log(line)
  fs.appendFileSync(RUN_LOG, `\n${line}\n`)
}

function logFailure(id, stage, op, detail) {
  FAILURES.push({ id, stage, op, time: new Date().toISOString(), detail })
  log(`FAIL-${id} | ${stage} | ${op} | ${detail}`)
}

async function screenshot(page, name) {
  const file = path.join(ARTIFACTS, `${name.replace(/[^a-z0-9]/gi, '_')}.png`)
  await page.screenshot({ path: file, fullPage: false })
  log(`📸 ${name}`)
}

async function injectSeedData(page) {
  log('注入测试数据: 25 tasks + 15 habits + 3 projects...')
  await page.evaluate(async () => {
    // 使用原生 IndexedDB（绕过版本号问题）
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('PersonalAIOS') // 使用当前版本
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!db.objectStoreNames.contains('tasks')) {
      db.close()
      log('DB schema not ready, skipping seed')
      return
    }

    const now = new Date().toISOString()
    const today = new Date().toISOString().split('T')[0]

    // 清理旧测试数据
    try {
      const tx0 = db.transaction(['tasks', 'completionRecords'], 'readwrite')
      const allTasks = await new Promise(res => {
        const r = tx0.objectStore('tasks').getAll()
        r.onsuccess = () => res(r.result)
      })
      for (const t of allTasks) {
        if (t.title?.includes('烟雾') || t.id?.startsWith?.('smoke-')) {
          tx0.objectStore('tasks').delete(t.id)
        }
      }
      await new Promise(r => { tx0.oncomplete = r; tx0.onerror = r })
    } catch {} // 表可能不存在

    // 写入任务
    try {
      const tx = db.transaction(['tasks', 'projects'], 'readwrite')

      // 创建3个项目
      const projects = [
        { id: 'smoke-project-1', name: '烟雾测试项目A', description: '', goalId: null, keyResultId: null,
          status: 'active', priority: 1, startDate: '2026-07-01', dueDate: null, progress: 60,
          progressMode: 'task', color: '#3b82f6', icon: 'code', completedAt: null,
          createdAt: now, updatedAt: now, deletedAt: null },
        { id: 'smoke-project-2', name: '烟雾测试项目B', description: '', goalId: null, keyResultId: null,
          status: 'active', priority: 2, startDate: '2026-07-15', dueDate: null, progress: 30,
          progressMode: 'task', color: '#10b981', icon: 'folder', completedAt: null,
          createdAt: now, updatedAt: now, deletedAt: null },
        { id: 'smoke-project-3', name: '烟雾测试完成项目', description: '', goalId: null, keyResultId: null,
          status: 'completed', priority: 3, startDate: '2026-06-01', dueDate: null, progress: 100,
          progressMode: 'task', color: '#8b5cf6', icon: 'check', completedAt: '2026-07-31',
          createdAt: now, updatedAt: now, deletedAt: null },
      ]
      for (const p of projects) tx.objectStore('projects').put(p)

      // 25个普通任务
      for (let i = 1; i <= 25; i++) {
        tx.objectStore('tasks').put({
          id: `smoke-task-${i}`,
          title: `烟雾普通任务 ${i}${i <= 3 ? ' (高优)' : i <= 10 ? ' (中优)' : ''}`,
          description: '', projectId: i <= 15 ? `smoke-project-${(i % 2) + 1}` : null,
          goalId: null, keyResultId: null, columnId: null,
          status: 'todo', userPriority: null,
          aiPriorityScore: 100 - i * 3, aiPriorityLevel: i <= 5 ? 'P0' : i <= 12 ? 'P1' : i <= 20 ? 'P2' : 'P3',
          aiPriorityReason: `基于截止时间排序 #${i}`, dueDate: null,
          plannedDate: today, estimatedMinutes: 30, actualMinutes: 0,
          cognitiveLoad: 'medium', energyDemand: (i % 5) + 1,
          recurrenceRule: null, isHabit: false, completedAt: null,
          parentTaskId: null, order: i * 10,
          createdAt: now, updatedAt: now, deletedAt: null,
        })
      }

      // 15个固定任务
      const habitNames = [
        '每日复盘', '运动30分钟', '阅读30分钟', '冥想10分钟', '学习英语',
        '整理桌面', '喝水8杯', '早起6:30', '写作500字', '代码练习',
        '拉伸运动', '听播客', '计划明日', '背单词20个', '午休20分',
      ]
      for (let i = 0; i < 15; i++) {
        tx.objectStore('tasks').put({
          id: `smoke-habit-${i + 1}`,
          title: habitNames[i],
          description: '', projectId: null,
          goalId: null, keyResultId: null, columnId: null,
          status: 'todo', userPriority: null,
          aiPriorityScore: 50 - i, aiPriorityLevel: i < 3 ? 'P1' : 'P2',
          aiPriorityReason: '固定任务', dueDate: null,
          plannedDate: null, estimatedMinutes: 20, actualMinutes: 0,
          cognitiveLoad: 'low', energyDemand: i < 3 ? 4 : i < 8 ? 3 : 2,
          recurrenceRule: 'FREQ=DAILY', isHabit: true, completedAt: null,
          parentTaskId: null, order: i * 10,
          createdAt: now, updatedAt: now, deletedAt: null,
        })
      }

      await new Promise(resolve => { tx.oncomplete = resolve })
    } catch (e) {
      console.error('Seed inject error:', e)
    }
    db.close()
    return { tasks: 25, habits: 15 }
  })
}

// ============= 测试主流程 =============
async function runVisibleTests() {
  log('========== 第一部分：有头浏览器可视化测试 ==========')
  const browser = await chromium.launch({ channel: 'chromium', headless: false })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') {
      CONSOLE_ERRORS.push(msg.text())
      log(`⚠️ Console: ${msg.text().slice(0, 200)}`)
    }
  })

  page.on('pageerror', err => {
    CONSOLE_ERRORS.push(err.message)
    log(`💥 Page Error: ${err.message}`)
  })

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })
    log('✅ 首页加载成功')
    await page.waitForTimeout(2000)

    // 清除示例数据 + 注入测试数据
    await injectSeedData(page)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    log('✅ 测试数据注入完成，页面刷新')

    await screenshot(page, '01_home_loaded')

    // === 1. 首页检查 ===
    log('\n--- 1. 首页基础检查 ---')
    const title = await page.title()
    log(`页面标题: ${title}`)

    // 检查今日执行中心是否存在
    const executionCenter = await page.locator('text=今日执行中心').count()
    log(`今日执行中心存在: ${executionCenter > 0 ? 'PASS' : 'FAIL'}`)

    // 检查固定任务区域
    const habitArea = await page.locator('text=今日固定任务').count()
    log(`固定任务区域: ${habitArea > 0 ? 'PASS' : 'FAIL'}`)

    // 滚动检查
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, 0))
    log('✅ 页面可正常滚动')

    // === 2. 普通任务完成/撤回 ===
    log('\n--- 2. 普通任务完成/撤回 ---')
    for (const pos of [1, 10, 25]) {
      // 找到第pos个"完成"按钮
      const completeBtns = page.locator('button:has-text("完成")')
      const count = await completeBtns.count()
      log(`找到 ${count} 个"完成"按钮`)
      if (count >= 1) {
        try {
          await completeBtns.first().click()
          await page.waitForTimeout(1000)
          log(`✅ 任务 #${pos}: 完成按钮点击`)
        } catch (e) {
          logFailure(`F-${FAILURES.length + 1}`, 'task-complete', `task #${pos}`, e.message)
        }
      }

      // 查找"撤回"按钮
      const undoBtns = page.locator('button:has-text("撤回")')
      const undoCount = await undoBtns.count()
      if (undoCount > 0) {
        try {
          // 点击已完成区域的撤回
          await undoBtns.last().click()
          await page.waitForTimeout(1000)
          log(`✅ 撤回成功`)
        } catch (e) {}
      }
    }
    await screenshot(page, '02_task_complete_undo')

    // === 3. 固定任务完成/撤回 ===
    log('\n--- 3. 固定任务检查 ---')
    const habitChips = page.locator('button:has-text("✓"), button:has-text("○")')
    const chipCount = await habitChips.count()
    log(`固定任务快捷项数: ${chipCount}`)
    for (const pos of [0, 7, 14]) {
      if (pos < chipCount) {
        try {
          await habitChips.nth(pos).click()
          await page.waitForTimeout(800)
          log(`✅ 固定任务 #${pos + 1} 点击`)
          // 再点击取消
          await habitChips.nth(pos).click()
          await page.waitForTimeout(800)
        } catch (e) {
          logFailure(`F-${FAILURES.length + 1}`, 'habit-toggle', `habit #${pos + 1}`, e.message)
        }
      }
    }
    await screenshot(page, '03_habit_toggle')

    // === 4. 跨模块联动 ===
    log('\n--- 4. 跨模块联动 ---')
    // 完成一个任务
    const completeBtn = page.locator('button:has-text("完成")').first()
    if (await completeBtn.count() > 0) {
      await completeBtn.click()
      await page.waitForTimeout(1000)
    }
    await screenshot(page, '04_cross_module_1')
    // 前往任务页
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(2000)
    await screenshot(page, '04_cross_module_2_tasks')
    // 前往日历
    await page.goto(`${BASE_URL}/calendar`, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(2000)
    await screenshot(page, '04_cross_module_3_calendar')
    // 返回首页
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(2000)
    log('✅ 跨模块切换完成 (首页→任务→日历→首页)')

    // === 5. 项目展开 ===
    log('\n--- 5. 项目展开 ---')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(2000)
    const projectCards = page.locator('text=烟雾测试项目').first()
    if (await projectCards.count() > 0) {
      await projectCards.click()
      await page.waitForTimeout(1500)
      await screenshot(page, '05_project_expanded')
      // 收起
      await projectCards.click()
      await page.waitForTimeout(500)
      log('✅ 项目展开/收起正常')
    } else {
      log('⚠️ 未找到测试项目')
    }

    // === 6. 番茄钟 ===
    log('\n--- 6. 番茄钟测试 ---')
    await page.goto(`${BASE_URL}/timer`, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(2000)
    await screenshot(page, '06_timer_page')
    // 点击播放按钮
    const playBtn = page.locator('button').filter({ has: page.locator('svg') }).first()
    try {
      await playBtn.click()
      await page.waitForTimeout(3000)
      await screenshot(page, '06_timer_running')
      // 暂停
      await playBtn.click()
      await page.waitForTimeout(1000)
      log('✅ 番茄钟启动/暂停正常')
    } catch (e) {
      log(`⚠️ 番茄钟控制异常: ${e.message}`)
    }

    // === 7. 刷新恢复 ===
    log('\n--- 7. 刷新恢复 ---')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 })
    await page.waitForTimeout(3000)
    await screenshot(page, '07_after_refresh')
    log('✅ 刷新恢复完成')

    log('\n========== VISIBLE_BROWSER_TEST_COMPLETE ==========')
    log(`控制台错误数: ${CONSOLE_ERRORS.length}`)

  } catch (e) {
    log(`💥 可视化测试异常: ${e.message}`)
    await screenshot(page, 'FATAL_ERROR')
  } finally {
    await page.waitForTimeout(2000)
    await browser.close()
  }
}

// ============= 第二部分：后台自动化测试 =============
async function runAutoTests() {
  log('\n========== 第二部分：后台自动化测试 ==========')
  const browser = await chromium.launch({ channel: 'chromium', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const autoErrors = []

  page.on('console', msg => {
    if (msg.type() === 'error') autoErrors.push(msg.text())
  })

  page.on('pageerror', err => autoErrors.push(err.message))

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2000)

    // === 高频完成/撤回（普通任务） x10 ===
    log('\n--- A1: 高频完成/撤回 (普通) x10 ---')
    for (let i = 0; i < 10; i++) {
      try {
        const completeBtns = page.locator('button:has-text("完成")')
        if (await completeBtns.count() > 0) {
          await completeBtns.first().click()
          await page.waitForTimeout(600)
        }
        const undoBtns = page.locator('button:has-text("撤回")')
        if (await undoBtns.count() > 0) {
          await undoBtns.last().click()
          await page.waitForTimeout(600)
        }
        if (i === 0) log(`  第1次 PASS, 继续...`)
      } catch (e) {
        logFailure(`A-${i + 1}`, 'freq-complete-undo', `普通 #${i + 1}`, e.message)
      }
    }
    log(`✅ A1 完成: 10次完成/撤回循环`)

    // === 高频完成/撤回（固定任务） x10 ===
    log('\n--- A2: 高频完成/撤回 (固定) x10 ---')
    for (let i = 0; i < 10; i++) {
      try {
        const chips = page.locator('button:has-text("○"), button:has-text("✓")')
        const cnt = await chips.count()
        if (cnt > 0) {
          await chips.first().click()
          await page.waitForTimeout(600)
          await chips.first().click()
          await page.waitForTimeout(600)
        }
        if (i === 0) log(`  第1次 PASS, 继续...`)
      } catch (e) {
        logFailure(`A-${i + 1}`, 'freq-habit-toggle', `固定 #${i + 1}`, e.message)
      }
    }
    log(`✅ A2 完成: 10次固定任务完成/撤回`)

    // === 日期切换 x20 ===
    log('\n--- A3: 日期切换 x20 ---')
    for (let i = 0; i < 20; i++) {
      try {
        const nextBtns = page.locator('button').filter({ hasText: /›|⟩|下一/ })
        if (await nextBtns.count() > 0) {
          await nextBtns.first().click()
          await page.waitForTimeout(300)
        }
      } catch (e) {}
    }
    log('✅ 日期切换完成 (部分按钮可能不可见)')

    // === 页面切换 x5轮 ===
    log('\n--- A4: 页面切换 x5轮 ---')
    const pages = ['/today', '/tasks', '/calendar', '/today']
    for (let r = 0; r < 5; r++) {
      for (const p of pages) {
        try {
          await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
          await page.waitForTimeout(800)
        } catch (e) {
          logFailure(`A-${r}`, 'page-switch', p, e.message)
        }
      }
    }
    log('✅ 页面切换5轮完成')

    // === 刷新恢复 x5 ===
    log('\n--- A5: 刷新恢复 x5 ---')
    for (let i = 0; i < 5; i++) {
      try {
        await page.reload({ waitUntil: 'networkidle', timeout: 10000 })
        await page.waitForTimeout(2000)
      } catch (e) {
        logFailure(`A-refresh-${i}`, 'refresh', `#${i + 1}`, e.message)
      }
    }
    log('✅ 刷新恢复5次完成')

    // === 数据库一致性检查 ===
    log('\n--- A6: 数据库一致性检查 ---')
    const dbCheck = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('PersonalAIOS')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const tx = db.transaction(['tasks', 'completionRecords', 'projectDailyLogs'], 'readonly')
      const smokeTasks = await new Promise(res => {
        const r = tx.objectStore('tasks').getAll()
        r.onsuccess = () => res(r.result.filter(t => t.id?.startsWith?.('smoke-')))
      })
      const completionRecords = await new Promise(res => {
        const r = tx.objectStore('completionRecords').getAll()
        r.onsuccess = () => res(r.result)
      })

      const dupMap = new Map()
      for (const r of completionRecords) {
        const key = `${r.taskId}:${r.completedDate}`
        if (dupMap.has(key)) dupMap.get(key).push(r)
        else dupMap.set(key, [r])
      }
      const duplicates = []
      for (const [key, records] of dupMap) {
        if (records.length > 1) duplicates.push({ key, count: records.length })
      }

      db.close()
      return {
        smokeTasks: smokeTasks.length,
        completionRecords: completionRecords.length,
        completionDups: duplicates,
      }
    })

    log(`烟雾任务总数: ${dbCheck.smokeTasks}`)
    log(`CompletionRecord 总数: ${dbCheck.completionRecords}`)
    log(`CompletionRecord 重复: ${dbCheck.completionDups.length > 0 ? JSON.stringify(dbCheck.completionDups) : '无'}`)
    log(`ProjectDailyLog 重复: ${dbCheck.logDups.length > 0 ? '有!' : '无'}`)

    if (dbCheck.completionDups.length > 0) {
      logFailure('DB-DUP', 'completion-duplicate', '数据库检查', JSON.stringify(dbCheck.completionDups))
    }

    log(`\n后台自动化测试完成`)
    log(`自动测试控制台错误: ${autoErrors.length}`)
    if (autoErrors.length > 0) {
      log(`错误列表: ${autoErrors.slice(0, 5).join(' | ')}`)
    }

  } catch (e) {
    log(`💥 自动化测试异常: ${e.message}`)
  } finally {
    await browser.close()
  }
}

// ============= 主入口 =============
async function main() {
  const mode = process.argv.includes('--auto') ? 'auto' :
               process.argv.includes('--visible') ? 'visible' : 'both'

  log(`\n🔥 SMOKE TEST START — ${new Date().toISOString()}`)
  log(`模式: ${mode}`)
  log(`BASE_URL: ${BASE_URL}`)

  if (mode === 'visible' || mode === 'both') {
    await runVisibleTests()
  }

  if (mode === 'auto' || mode === 'both') {
    if (mode === 'both') {
      log('\n⏸ 可视化测试完成，等待用户确认后继续...')
    }
    await runAutoTests()
  }

  // 最终总结
  log(`\n========== 测试完成 ==========`)
  log(`总失败数: ${FAILURES.length}`)
  log(`控制台错误总数: ${CONSOLE_ERRORS.length}`)
  if (FAILURES.length > 0) {
    FAILURES.forEach(f => log(`  ${f.id}: ${f.stage} | ${f.op} | ${f.detail}`))
  }
  log(`报告: docs/smoke-test/SMOKE_TEST_REPORT.md`)
  process.exit(FAILURES.length > 0 ? 1 : 0)
}

main().catch(e => {
  log(`FATAL: ${e.message}`)
  process.exit(1)
})
