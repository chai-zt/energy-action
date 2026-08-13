import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser } from 'playwright'

const projectRoot = process.cwd()
const apiPort = 4301
const vitePort = 4175
const verificationDir = join(projectRoot, 'server', '.browser-verification-data', `project-groups-${Date.now()}`)
mkdirSync(verificationDir, { recursive: true })
process.env.PERSONAL_AI_OS_DATA_DIR = verificationDir
process.env.PERSONAL_AI_OS_TEST = '1'

const { handleRequest } = await import('../server/index.ts')
const { setProvider } = await import('../server/ai/providers/mimoProvider.ts')
setProvider({
  async generateJson(request: { systemPrompt: string }) {
    if (request.systemPrompt.includes('拆解')) {
      return { text: JSON.stringify({ shouldDecompose: true, children: [{ title: '浏览器验收第二层任务', description: '', estimatedMinutes: 5 }] }) }
    }
    return { text: JSON.stringify({ actions: [{ taskRef: 'child-0', description: '先完成这一小步。', estimatedMinutes: 3, difficulty: 1 }] }) }
  },
})
const apiServer = createServer(handleRequest)
await new Promise<void>(resolve => apiServer.listen(apiPort, '127.0.0.1', resolve))

let vite: ChildProcess | undefined
let browser: Browser | undefined

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function api(path: string, body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort)], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PERSONAL_AI_OS_API_PORT: String(apiPort) },
  })
  await waitFor(`http://127.0.0.1:${vitePort}/tasks`)

  const today = new Date().toISOString().slice(0, 10)
  const parentResponse = await api('/tasks', { title: '浏览器验收父任务', plannedDate: today, taskKind: 'large' })
  if (parentResponse.status !== 201) throw new Error(`Unable to create browser parent: ${await parentResponse.text()}`)
  assert.equal(parentResponse.status, 201)
  const parent = await parentResponse.json() as { id: string }
  const childResponse = await api('/tasks', { title: '浏览器验收子任务', parentTaskId: parent.id, plannedDate: today, taskKind: 'small' })
  if (childResponse.status !== 201) throw new Error(`Unable to create browser child: ${await childResponse.text()}`)
  assert.equal(childResponse.status, 201)
  const child = await childResponse.json() as { id: string }
  const siblingResponse = await api('/tasks', { title: '浏览器验收另一个子任务', parentTaskId: parent.id, plannedDate: today, taskKind: 'small' })
  assert.equal(siblingResponse.status, 201)
  const sibling = await siblingResponse.json() as { id: string }
  const augustTask = await api('/tasks', { title: '只应显示在八月的任务', plannedDate: '2026-08-09', taskKind: 'small' })
  const septemberTask = await api('/tasks', { title: '只应显示在九月的任务', plannedDate: '2026-09-09', taskKind: 'small' })
  assert.equal(augustTask.status, 201)
  assert.equal(septemberTask.status, 201)

  const chromePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync)
  browser = await chromium.launch({ headless: true, executablePath: chromePath })
  const page = await browser.newPage()

  await page.goto(`http://127.0.0.1:${vitePort}/tasks`)
  await page.getByRole('heading', { name: '大任务' }).waitFor()
  assert.equal(await page.getByText('任务组', { exact: false }).count(), 0)
  await page.getByText('浏览器验收父任务', { exact: true }).first().click()
  const childTaskButton = page.getByRole('button', { name: '浏览器验收子任务 小任务 · 可直接执行' })
  await childTaskButton.waitFor()
  await page.getByRole('button', { name: '编辑 浏览器验收子任务' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑任务' })
  await editDialog.getByLabel('任务名称').fill('浏览器验收子任务已改名')
  await editDialog.getByRole('button', { name: '保存', exact: true }).click()
  const renamedChildButton = page.getByRole('button', { name: '浏览器验收子任务已改名 小任务 · 可直接执行' })
  await renamedChildButton.waitFor()

  await page.getByRole('button', { name: '编辑 浏览器验收子任务已改名' }).click()
  await page.getByRole('dialog', { name: '编辑任务' }).getByPlaceholder('添加子任务...').fill('手动添加的第二层任务')
  await page.getByRole('dialog', { name: '编辑任务' }).getByPlaceholder('添加子任务...').press('Enter')
  await page.getByRole('dialog', { name: '编辑任务' }).getByRole('button', { name: '取消', exact: true }).click()
  const renamedParentButton = page.getByRole('button', { name: '浏览器验收子任务已改名 小任务 · 可直接执行' })
  await renamedParentButton.click()
  await page.getByRole('button', { name: '手动添加的第二层任务 小任务 · 可直接执行' }).waitFor()

  await page.getByRole('button', { name: '上移 浏览器验收另一个子任务' }).click()
  const reordered = await fetch(`http://127.0.0.1:${apiPort}/tasks?parentTaskId=${parent.id}`)
  assert.equal((await reordered.json() as { id: string }[])[0].id, sibling.id)

  assert.equal((await page.getByText('大任务', { exact: true }).count()) >= 2, true)
  await page.reload()
  await page.getByText('浏览器验收父任务', { exact: true }).first().click()
  await page.getByRole('button', { name: '浏览器验收子任务已改名 小任务 · 可直接执行' }).click()
  await page.getByRole('button', { name: '手动添加的第二层任务 小任务 · 可直接执行' }).waitFor()

  await page.getByRole('button', { name: '删除 浏览器验收父任务', exact: true }).click()
  await page.getByRole('dialog', { name: '移入回收站？' }).getByText(/及其 \d+ 个下级任务/).waitFor()
  await page.getByRole('dialog', { name: '移入回收站？' }).getByRole('button', { name: '确认删除' }).click()
  await page.getByRole('button', { name: /^浏览器验收父任务 大任务/ }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '打开回收站' }).click()
  await page.getByRole('dialog', { name: '回收站' }).getByText('浏览器验收父任务', { exact: true }).waitFor()
  await page.getByRole('dialog', { name: '回收站' }).getByRole('button', { name: '恢复' }).click()
  await page.getByRole('button', { name: /^浏览器验收父任务 大任务/ }).waitFor()
  await page.getByRole('button', { name: '关闭回收站' }).click()

  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page.getByPlaceholder('输入任务名称').fill('界面创建的大任务')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  const choiceDialog = page.getByRole('dialog', { name: '这个任务需要拆解吗？' })
  await choiceDialog.getByRole('button', { name: '归类为大任务（需要拆解）' }).click()
  const createdLargeTask = page.getByRole('button', { name: /^界面创建的大任务 大任务/ })
  await createdLargeTask.waitFor()
  await page.getByRole('button', { name: '浏览器验收第二层任务 小任务 · 可直接执行' }).waitFor()
  await page.getByRole('button', { name: '浏览器验收第二层任务 小任务 · 可直接执行' }).click()
  await page.getByText('先完成这一小步。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '浏览器验收第二层任务 小任务 · 可直接执行' }).click()
  await page.getByText('先完成这一小步。', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('AI 继续拆解', { exact: true }).count(), 0)
  assert.equal(await page.getByText('重新拆解', { exact: true }).count(), 0)

  assert.equal(await page.locator('nav').filter({ hasText: '项目' }).count(), 0)
  await page.getByRole('button', { name: '下个月任务' }).click()
  await page.getByText('只应显示在九月的任务', { exact: true }).waitFor()
  assert.equal(await page.getByText('只应显示在八月的任务', { exact: true }).count(), 0)
} finally {
  await browser?.close()
  vite?.kill()
  await new Promise<void>((resolve, reject) => apiServer.close(error => error ? reject(error) : resolve()))
}
