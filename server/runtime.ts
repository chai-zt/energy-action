// Runtime policy is intentionally small: one codebase, two threat models.
// local is the default for the GitHub/community build; hosted is opt-in.

export type RuntimeMode = 'local' | 'hosted'

export const runtimeMode: RuntimeMode = process.env.PERSONAL_AI_OS_MODE === 'hosted'
  ? 'hosted'
  : 'local'

export function isHostedRuntime(): boolean {
  return runtimeMode === 'hosted'
}

function loopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

const hostedOrigins = new Set(
  (process.env.PERSONAL_AI_OS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4001,http://127.0.0.1:4001')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
)

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true
  return isHostedRuntime() ? hostedOrigins.has(origin) : loopbackOrigin(origin)
}

export function corsOrigin(origin?: string): string {
  if (origin && isAllowedOrigin(origin)) return origin
  return isHostedRuntime() ? [...hostedOrigins][0] : 'http://localhost:3000'
}
