import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

// Inject 30 tasks
await page.goto('http://localhost:3173/tasks', { waitUntil: 'networkidle', timeout: 15000 })
await page.waitForTimeout(2000)

await page.evaluate(async () => {
  const db = await new Promise((resolve) => {
    const req = indexedDB.open('PersonalAIOS')
    req.onsuccess = () => resolve(req.result)
  })
  const tx = db.transaction(['tasks'], 'readwrite')
  const now = new Date().toISOString()
  const today = now.split('T')[0]
  for (let i = 1; i <= 30; i++) {
    tx.objectStore('tasks').put({
      id: `dragtest-${i}`, title: `拖拽测试任务 ${i}`, description: '',
      projectId: null, goalId: null, keyResultId: null, columnId: null,
      status: 'todo', userPriority: null,
      aiPriorityScore: 100 - i * 2, aiPriorityLevel: i <= 8 ? 'P0' : i <= 20 ? 'P1' : 'P2',
      aiPriorityReason: `test ${i}`, dueDate: null,
      plannedDate: today, estimatedMinutes: 20, actualMinutes: 0,
      cognitiveLoad: 'medium', energyDemand: 3,
      recurrenceRule: null, isHabit: false, completedAt: null,
      parentTaskId: null, order: i * 10,
      createdAt: now, updatedAt: now, deletedAt: null,
    })
  }
  await new Promise(r => { tx.oncomplete = r })
  db.close()
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// Test drag on task 10
const calCount = await page.locator('button[data-date]').count()
console.log('Calendar cells:', calCount)

// Find task 10 by text
const task10 = page.locator('text=拖拽测试任务 10').first()
if (await task10.count() > 0) {
  const box = await task10.boundingBox()
  if (box) {
    console.log('Task 10 box:', JSON.stringify(box))
    // Mouse down on task 10
    await page.mouse.move(box.x + 50, box.y + 5)
    await page.mouse.down()
    await page.mouse.move(box.x + 100, box.y + 5, { steps: 5 })
    await page.waitForTimeout(300)
    const overlay = page.locator('[role="presentation"]')
    const overlayBox = await overlay.first().boundingBox().catch(() => null)
    console.log('Overlay after drag:', overlayBox ? JSON.stringify(overlayBox) : 'NONE')
    // Check for jump (overlay Y should be close to original Y)
    if (overlayBox && box) {
      const jump = Math.abs(overlayBox.y - box.y)
      console.log('Y jump delta:', jump.toFixed(1), jump < 50 ? 'OK' : 'JUMP!')
    }
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}

// Test calendar month navigation
// Find month nav buttons
const monthBtns = page.locator('button[title*="月"]')
const monthBtnCount = await monthBtns.count()
console.log('Month nav buttons:', monthBtnCount)

if (monthBtnCount >= 2) {
  // Click right (next month)
  await monthBtns.nth(1).click()
  await page.waitForTimeout(500)
  console.log('Clicked next month')
  // Click left (prev month)
  await monthBtns.first().click()
  await page.waitForTimeout(500)
  console.log('Clicked prev month - back to original')
}

// Click "今天" button
const todayBtn = page.locator('button:has-text("今天")').first()
if (await todayBtn.count() > 0) {
  await todayBtn.click()
  await page.waitForTimeout(500)
  console.log('Clicked 今天')
}

console.log('Console errors:', errors.length)
if (errors.length > 0) console.log('Errors:', errors.slice(0, 3))

await browser.close()
console.log('DONE')
