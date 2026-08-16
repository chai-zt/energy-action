import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SecretStore } from '../server/security/secretStore.ts'

process.env.PERSONAL_AI_OS_MODE = 'local'
process.env.PERSONAL_AI_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'energy-action-local-ai-'))

const { setSecretStoreForTest, resetSecretStoreCache } = await import('../server/security/secretStore.ts')
const { saveProviderConfig, AI_SECRET_ID } = await import('../server/ai/providerConfig.ts')
const { getAiAvailability } = await import('../server/ai/availability.ts')

class FakeSecretStore implements SecretStore {
  private value: string | null = null
  async setSecret(_id: string, value: string): Promise<void> { this.value = value }
  async getSecret(_id: string): Promise<string | null> { return this.value }
  async deleteSecret(_id: string): Promise<void> { this.value = null }
  async hasSecret(_id: string): Promise<boolean> { return this.value !== null }
}

const store = new FakeSecretStore()
resetSecretStoreCache()
setSecretStoreForTest(store)
saveProviderConfig({
  providerType: 'mimo', providerName: '', credentialType: 'token_plan',
  baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.5',
  verificationStatus: 'failed', lastVerifiedAt: null,
})
await store.setSecret(AI_SECRET_ID, 'stored-key')

const availability = await getAiAvailability()
assert.equal(availability.available, true)
assert.equal(availability.verified, false)
assert.equal(availability.reason, 'available')
console.log('Local AI availability keeps stored config usable: PASS')
