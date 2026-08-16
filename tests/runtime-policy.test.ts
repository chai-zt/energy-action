import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

process.env.PERSONAL_AI_OS_MODE = 'local'
const local = await import('../server/runtime.ts')
assert.equal(local.runtimeMode, 'local')
assert.equal(local.isAllowedOrigin('http://localhost:3001'), true)
assert.equal(local.isAllowedOrigin('https://evil.example.com'), false)

const script = "import { runtimeMode, isAllowedOrigin } from './server/runtime.ts'; console.log(JSON.stringify({ mode: runtimeMode, local: isAllowedOrigin('http://localhost:3001'), hosted: isAllowedOrigin('http://localhost:3000') }))"
const hosted = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
  cwd: process.cwd(),
  env: { ...process.env, PERSONAL_AI_OS_MODE: 'hosted' },
  encoding: 'utf8',
})
assert.equal(hosted.status, 0, hosted.stderr)
assert.deepEqual(JSON.parse(hosted.stdout.trim()), { mode: 'hosted', local: false, hosted: true })

console.log('Runtime policy local/hosted tests: PASS')
