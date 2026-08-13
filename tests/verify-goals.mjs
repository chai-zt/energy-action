import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []

page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(e.message))

await page.goto('http://localhost:3173/goals', { waitUntil: 'networkidle', timeout: 15000 })
await page.waitForTimeout(2000)

console.log('Title:', await page.textContent('h1'))

const createBtn = page.locator('button:has-text("新建目标")')
console.log('Create btn:', await createBtn.count() > 0)

await createBtn.click()
await page.waitForTimeout(1000)

// 填写名称
await page.locator('input').first().fill('PW测试目标')
await page.waitForTimeout(300)

// 选3个月
const cycle3m = page.locator('button:has-text("3个月")').first()
if (await cycle3m.count() > 0) { await cycle3m.click(); console.log('cycle: 3m') }

// 选领域
const domGrowth = page.locator('button:has-text("成长")').first()
if (await domGrowth.count() > 0) { await domGrowth.click(); console.log('domain: growth') }

// 提交
await page.locator('button:has-text("创建目标")').click()
await page.waitForTimeout(3000)

const goalCard = page.locator('text=PW测试目标')
console.log('Card exists:', await goalCard.count() > 0)

if (await goalCard.count() > 0) {
  await goalCard.first().click()
  await page.waitForTimeout(1000)

  // 添加 KR
  const krInput = page.locator('input[placeholder*="添加 KR"]')
  if (await krInput.count() > 0) {
    await krInput.first().fill('KR-1')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
    console.log('KR added')
  }

  // 勾选 KR
  const circles = page.locator('svg.lucide-circle')
  console.log('KR circles:', await circles.count())

  // 完成目标
  const completeBtn = page.locator('button:has-text("完成目标")')
  console.log('Complete btn:', await completeBtn.count() > 0)
  if (await completeBtn.count() > 0) {
    page.once('dialog', d => d.accept())
    await completeBtn.click()
    await page.waitForTimeout(1000)
    console.log('Goal completed')
  }
}

console.log('Console errors:', errors.length)
if (errors.length > 0) console.log('Errors:', errors.slice(0, 3))

await browser.close()
console.log('DONE')
