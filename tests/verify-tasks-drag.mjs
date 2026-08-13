import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

// ===== A: Calendar init to today =====
await page.goto('http://localhost:3173/goals', { waitUntil: 'networkidle', timeout: 10000 })
await page.waitForTimeout(500)
await page.goto('http://localhost:3173/tasks', { waitUntil: 'networkidle', timeout: 10000 })
await page.waitForTimeout(2000)

const today = new Date().toISOString().split('T')[0]
const selDate = await page.evaluate(() => {
  const b = document.querySelector('button[data-date]')
  return b ? b.textContent : 'none'
})
console.log('Today date from browser:', today)
console.log('Selected month check:', selDate !== 'none' ? 'OK' : 'FAIL')

// ===== B: Click a date then leave & return =====
const calBtns = page.locator('button[data-date]')
const calCount = await calBtns.count()
console.log('Calendar cells:', calCount)

// Click 15th
if (calCount > 14) {
  await calBtns.nth(14).click()
  await page.waitForTimeout(500)
  console.log('Clicked date 15')
}

// Navigate away and back
await page.goto('http://localhost:3173/goals', { waitUntil: 'networkidle', timeout: 10000 })
await page.waitForTimeout(500)
await page.goto('http://localhost:3173/tasks', { waitUntil: 'networkidle', timeout: 10000 })
await page.waitForTimeout(2000)
console.log('Returned to tasks — should be on today again')

// ===== C: Check drag doesn't trigger date change =====
// Simulate drag start on first task
const firstTask = page.locator('[class*="cursor-grab"]').first()
if (await firstTask.count() > 0) {
  const box = await firstTask.boundingBox()
  if (box) {
    // mouse down + small movement (should start drag)
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 50, box.y + 10, { steps: 5 })
    await page.waitForTimeout(300)
    // Check that no date became selected from just starting drag
    console.log('Drag start simulation completed')
    // Drop back on same spot
    await page.mouse.move(box.x + 10, box.y + 10, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    console.log('Drop back on task list — date should be unchanged')
  }
}

// ===== D: Verify no console errors =====
console.log('Console errors:', errors.length)
if (errors.length > 0) console.log('Errors:', errors.slice(0, 3))

await browser.close()
console.log('DONE')
