// ============================================================
// SecretStore — API Key 安全存储抽象
//
// 硬规则（Fail Closed）：
//   - API Key 严禁进入 localStorage / sessionStorage / IndexedDB /
//     SQLite 普通业务表 / JSON / .env / 源码 / 日志。
//   - 优先 OS Credential Store（@napi-rs/keyring）。
//   - OS Credential Store 不可用时：绝对禁止 plaintext file / SQLite /
//     JSON / localStorage fallback；只允许 MemorySecretStore
//     （仅存在于当前 Node 进程，重启即失效）。
//   - 宁可禁止保存，也不降低安全等级。
// ============================================================

export interface SecretStore {
  setSecret(id: string, value: string): Promise<void>
  getSecret(id: string): Promise<string | null>
  deleteSecret(id: string): Promise<void>
  hasSecret(id: string): Promise<boolean>
}

export type SecretStoreMode = 'native' | 'memory'

// === MemorySecretStore：仅当前进程，重启失效（Fail Closed 兜底）===

export class MemorySecretStore implements SecretStore {
  private readonly store = new Map<string, string>()

  async setSecret(id: string, value: string): Promise<void> {
    this.store.set(id, value)
  }

  async getSecret(id: string): Promise<string | null> {
    return this.store.get(id) ?? null
  }

  async deleteSecret(id: string): Promise<void> {
    this.store.delete(id)
  }

  async hasSecret(id: string): Promise<boolean> {
    return this.store.has(id)
  }
}

// === OsCredentialSecretStore：OS 凭据库（@napi-rs/keyring）===

const KEYRING_SERVICE = 'energy-action-community'

async function loadKeyringAsyncEntry(): Promise<typeof import('@napi-rs/keyring') | null> {
  try {
    return await import('@napi-rs/keyring')
  } catch {
    // 原生模块加载失败（二进制缺失 / 平台不支持）→ 上层回落 MemorySecretStore
    return null
  }
}

export class OsCredentialSecretStore implements SecretStore {
  private mod: typeof import('@napi-rs/keyring') | null = null
  private initPromise: Promise<typeof import('@napi-rs/keyring') | null> | null = null

  /** 尝试加载原生模块；失败返回 false（调用方回落 memory）。 */
  async isAvailable(): Promise<boolean> {
    if (!this.initPromise) this.initPromise = loadKeyringAsyncEntry()
    this.mod = await this.initPromise
    return this.mod !== null
  }

  private entry(id: string) {
    if (!this.mod) throw new Error('OS credential store unavailable')
    // account 用 id，service 固定；密钥作为 password 存于平台凭据库
    return new this.mod.AsyncEntry(KEYRING_SERVICE, id)
  }

  async setSecret(id: string, value: string): Promise<void> {
    await this.entry(id).setPassword(value)
  }

  async getSecret(id: string): Promise<string | null> {
    try {
      const v = await this.entry(id).getPassword()
      return v ?? null
    } catch (err) {
      // NoEntry 等：视为无 Secret
      if ((err as Error)?.message?.includes('NoEntry')) return null
      throw err
    }
  }

  async deleteSecret(id: string): Promise<void> {
    try {
      await this.entry(id).deletePassword()
    } catch (err) {
      // 不存在即视为已删除
      if ((err as Error)?.message?.includes('NoEntry')) return
      throw err
    }
  }

  async hasSecret(id: string): Promise<boolean> {
    return (await this.getSecret(id)) !== null
  }
}

// === 工厂：Fail Closed ===

let cachedStore: { store: SecretStore; mode: SecretStoreMode } | null = null

export async function getSecretStore(): Promise<{ store: SecretStore; mode: SecretStoreMode }> {
  if (cachedStore) return cachedStore

  const os = new OsCredentialSecretStore()
  if (await os.isAvailable()) {
    cachedStore = { store: os, mode: 'native' }
  } else {
    // OS 凭据库不可用 → 仅内存兜底（禁止任何明文磁盘 fallback）
    cachedStore = { store: new MemorySecretStore(), mode: 'memory' }
  }
  return cachedStore
}

// 测试接缝：重置缓存
export function resetSecretStoreCache(): void {
  cachedStore = null
}

// 测试接缝：注入 fake store（避免触碰真实 OS 凭据库）
export function setSecretStoreForTest(store: SecretStore, mode: SecretStoreMode = 'memory'): void {
  cachedStore = { store, mode }
}
