// ============================================================
// AI Config / Security 单元测试（无网络、无真实 OS 凭据库）
//
// 覆盖：SecretStore、SSRF、Session、RateLimit、Fuse、ProviderFactory、Availability
// ============================================================

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SecretStore } from '../server/security/secretStore.ts'

const tempDir = mkdtempSync(join(tmpdir(), 'energy-action-security-'))
process.env.PERSONAL_AI_OS_DATA_DIR = tempDir

const {
  MemorySecretStore, setSecretStoreForTest, resetSecretStoreCache,
} = await import('../server/security/secretStore.ts')
const { validateHttpsUrl, isPrivateOrReserved, SsrfError } = await import('../server/security/ssrf.ts')
const { getSessionToken, isSessionValid } = await import('../server/security/session.ts')
const { RateLimiter } = await import('../server/security/rateLimit.ts')
const { securityFuse, resetSecurityFuse } = await import('../server/security/fuse.ts')
const { createProvider } = await import('../server/ai/providers/providerFactory.ts')
const {
  saveProviderConfig, clearProviderConfig, updateVerificationStatus, readProviderConfig, AI_SECRET_ID,
} = await import('../server/ai/providerConfig.ts')
const { getAiAvailability } = await import('../server/ai/availability.ts')
const { getDb } = await import('../server/db/sqlite.ts')

class FakeSecretStore implements SecretStore {
  private readonly map = new Map<string, string>()
  async setSecret(id: string, value: string): Promise<void> { this.map.set(id, value) }
  async getSecret(id: string): Promise<string | null> { return this.map.get(id) ?? null }
  async deleteSecret(id: string): Promise<void> { this.map.delete(id) }
  async hasSecret(id: string): Promise<boolean> { return this.map.has(id) }
}

const fakeStore = new FakeSecretStore()

function resetAll() {
  resetSecretStoreCache()
  setSecretStoreForTest(fakeStore)
  resetSecurityFuse()
  clearProviderConfig()
  // 清空 fake secret
  ;(fakeStore as unknown as { map: Map<string, string> }).map.clear()
}

describe('SecretStore', () => {
  it('MemorySecretStore save/get/delete/has', async () => {
    const s = new MemorySecretStore()
    assert.equal(await s.hasSecret('x'), false)
    await s.setSecret('x', 'secret-123')
    assert.equal(await s.hasSecret('x'), true)
    assert.equal(await s.getSecret('x'), 'secret-123')
    await s.deleteSecret('x')
    assert.equal(await s.getSecret('x'), null)
    assert.equal(await s.hasSecret('x'), false)
  })

  it('API Key 不进 SQLite（ai_provider_configs 无 api_key 列）', () => {
    const cols = getDb().prepare('PRAGMA table_info(ai_provider_configs)').all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    assert.equal(names.includes('api_key'), false)
    assert.equal(names.includes('apiKey'), false)
    assert.equal(names.includes('secret'), false)
  })
})

describe('SSRF', () => {
  it('私网/保留 IPv4 被识别', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '100.64.0.1']) {
      assert.equal(isPrivateOrReserved(ip), true, `expected ${ip} private`)
    }
  })

  it('公网 IPv4 不被识别为私网', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '9.9.9.9', '172.15.255.255']) {
      assert.equal(isPrivateOrReserved(ip), false, `expected ${ip} public`)
    }
  })

  it('私网/保留 IPv6 被识别', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd00::1', 'ff02::1', '2001:db8::1']) {
      assert.equal(isPrivateOrReserved(ip), true, `expected ${ip} private`)
    }
  })

  it('公网 IPv6 不被识别为私网', () => {
    assert.equal(isPrivateOrReserved('2606:4700:4700::1111'), false)
  })

  it('仅 HTTPS', () => {
    assert.throws(() => validateHttpsUrl('http://example.com'), SsrfError)
    assert.throws(() => validateHttpsUrl('ftp://example.com'), SsrfError)
    assert.throws(() => validateHttpsUrl('file:///etc/passwd'), SsrfError)
    assert.throws(() => validateHttpsUrl('data:text/plain,hi'), SsrfError)
  })

  it('禁止 URL userinfo / fragment', () => {
    assert.throws(() => validateHttpsUrl('https://user:pass@example.com'), SsrfError)
    assert.throws(() => validateHttpsUrl('https://example.com/#frag'), SsrfError)
  })

  it('私网 IP 字面量被拒绝', () => {
    assert.throws(() => validateHttpsUrl('https://127.0.0.1/v1'), SsrfError)
    assert.throws(() => validateHttpsUrl('https://10.0.0.1/v1'), SsrfError)
    assert.throws(() => validateHttpsUrl('https://192.168.1.1/v1'), SsrfError)
    assert.throws(() => validateHttpsUrl('https://[::1]/v1'), SsrfError)
  })

  it('合法公网 HTTPS 通过', () => {
    const u = validateHttpsUrl('https://api.example.com/v1')
    assert.equal(u.protocol, 'https:')
  })
})

describe('Session Token', () => {
  it('生成高熵 token（64 hex），且校验正确', () => {
    const token = getSessionToken()
    assert.match(token, /^[0-9a-f]{64}$/)
    assert.equal(isSessionValid(token), true)
  })

  it('错误 / 空 token 被拒绝', () => {
    assert.equal(isSessionValid('wrong'), false)
    assert.equal(isSessionValid(undefined), false)
    assert.equal(isSessionValid(''), false)
  })
})

describe('RateLimiter', () => {
  it('超过 limit 后拒绝', () => {
    const limiter = new RateLimiter(3)
    assert.equal(limiter.allow('k'), true)
    assert.equal(limiter.allow('k'), true)
    assert.equal(limiter.allow('k'), true)
    assert.equal(limiter.allow('k'), false)
  })
})

describe('Security Fuse', () => {
  beforeEach(() => resetSecurityFuse())

  it('连续非法 session 触发 LOCKED', () => {
    for (let i = 0; i < 5; i++) securityFuse.recordBadSession()
    assert.equal(securityFuse.isLocked(), true)
  })

  it('连续 SSRF target 触发 LOCKED（阈值 3）', () => {
    securityFuse.recordSsrfTarget()
    securityFuse.recordSsrfTarget()
    assert.equal(securityFuse.isLocked(), false)
    securityFuse.recordSsrfTarget()
    assert.equal(securityFuse.isLocked(), true)
  })

  it('LOCKED 后 getStatus 返回 LOCKED + reason', () => {
    for (let i = 0; i < 5; i++) securityFuse.recordBadSession()
    assert.equal(securityFuse.getStatus().state, 'LOCKED')
    assert.ok(securityFuse.getStatus().reason)
  })
})

describe('Provider Factory', () => {
  it('MiMo → thinking disabled + max_completion_tokens', async () => {
    const provider = createProvider({
      providerType: 'mimo', providerName: '', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      verificationStatus: 'verified', lastVerifiedAt: null,
    }, 'key-123')

    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (_u: any, opts: any) => {
      body = JSON.parse(opts.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    await provider.generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(body.model, 'mimo-v2.5')
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.equal(body.max_completion_tokens, 100)
    assert.equal(body.max_tokens, undefined)
  })

  it('OpenAI Compatible → max_tokens，无 thinking', async () => {
    const provider = createProvider({
      providerType: 'openai_compatible', providerName: 'MyService', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.example.com/v1', model: 'my-model',
      verificationStatus: 'verified', lastVerifiedAt: null,
    }, 'key-456')

    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (_u: any, opts: any) => {
      body = JSON.parse(opts.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    await provider.generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(body.model, 'my-model')
    assert.equal(body.thinking, undefined)
    assert.equal(body.max_tokens, 100)
    assert.equal(body.max_completion_tokens, undefined)
  })
})

describe('AI Availability', () => {
  beforeEach(resetAll)

  it('无 config → not_configured（available=false）', async () => {
    const a = await getAiAvailability()
    assert.equal(a.available, false)
    assert.equal(a.reason, 'not_configured')
  })

  it('有 config 但无 secret → no_secret', async () => {
    saveProviderConfig({
      providerType: 'mimo', providerName: '', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      verificationStatus: 'unverified', lastVerifiedAt: null,
    })
    const a = await getAiAvailability()
    assert.equal(a.available, false)
    assert.equal(a.reason, 'no_secret')
  })

  it('config + secret 但未验证 → unverified', async () => {
    saveProviderConfig({
      providerType: 'mimo', providerName: '', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      verificationStatus: 'unverified', lastVerifiedAt: null,
    })
    await fakeStore.setSecret(AI_SECRET_ID, 'key-123')
    const a = await getAiAvailability()
    assert.equal(a.available, false)
    assert.equal(a.reason, 'unverified')
  })

  it('config + secret + verified → available', async () => {
    saveProviderConfig({
      providerType: 'mimo', providerName: '', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      verificationStatus: 'unverified', lastVerifiedAt: null,
    })
    await fakeStore.setSecret(AI_SECRET_ID, 'key-123')
    updateVerificationStatus('verified')
    assert.equal(readProviderConfig()?.verificationStatus, 'verified')
    const a = await getAiAvailability()
    assert.equal(a.available, true)
    assert.equal(a.reason, 'available')
  })

  it('fuse LOCKED → fuse_locked（即使已配置）', async () => {
    saveProviderConfig({
      providerType: 'mimo', providerName: '', credentialType: 'pay_as_you_go',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      verificationStatus: 'verified', lastVerifiedAt: null,
    })
    await fakeStore.setSecret(AI_SECRET_ID, 'key-123')
    resetSecurityFuse()
    for (let i = 0; i < 5; i++) securityFuse.recordBadSession()
    const a = await getAiAvailability()
    assert.equal(a.available, false)
    assert.equal(a.reason, 'fuse_locked')
  })
})
