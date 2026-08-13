// ============================================================
// Native Secret Store Live Smoke — 测试 OS 凭据库读写
//
// 只使用随机生成的测试 Secret，绝不使用真实用户 API Key。
// 不支持（原生模块缺失 / 平台不支持）时输出 SKIPPED / UNSUPPORTED。
// ============================================================

import { randomBytes } from 'node:crypto'
import { getSecretStore } from '../server/security/secretStore.ts'

const testId = `smoke-${randomBytes(4).toString('hex')}`
const testValue = `test-secret-${randomBytes(16).toString('hex')}`

async function main() {
  const { store, mode } = await getSecretStore()
  if (mode !== 'native') {
    console.log('SKIPPED — native OS credential store unavailable (mode=' + mode + ')')
    return
  }

  try {
    await store.setSecret(testId, testValue)
    const read = await store.getSecret(testId)
    if (read !== testValue) {
      console.log('FAIL — value mismatch')
      process.exitCode = 1
      return
    }
    if (!(await store.hasSecret(testId))) {
      console.log('FAIL — hasSecret returned false')
      process.exitCode = 1
      return
    }
    await store.deleteSecret(testId)
    const after = await store.getSecret(testId)
    if (after !== null) {
      console.log('FAIL — secret still present after delete')
      process.exitCode = 1
      return
    }
    console.log('PASS — native secret store write/read/delete OK')
  } catch (err) {
    console.log('UNSUPPORTED — native secret store operation failed: ' + (err as Error).message)
    process.exitCode = 1
  }
}

void main()
