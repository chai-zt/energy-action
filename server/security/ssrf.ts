// ============================================================
// SSRF Guard — 阻止 Custom Base URL 打到内网/本机
//
// 规则：
//   - 仅 HTTPS
//   - 禁止 localhost / loopback / RFC1918 / link-local / reserved / multicast
//   - 禁止 URL userinfo（username:password@）
//   - 禁止 fragment
//   - hostname 做 DNS 解析，任一解析结果落在私网/保留段即拒绝
//   - redirect: manual（不自动跟随，防 redirect bypass）
// ============================================================

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// === IPv4 ===

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = (value << 8) | n
  }
  return value >>> 0
}

function ipv4InCidr(ip: string, base: string, prefix: number): boolean {
  const a = ipv4ToInt(ip)
  if (a === null) return false
  const b = ipv4ToInt(base)!
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (a & mask) === (b & mask)
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  // 0.0.0.0/8, 10/8, 100.64/10(CGNAT), 127/8, 169.254/16, 172.16/12,
  // 192.0.0.0/24, 192.0.2.0/24(TEST-NET), 192.88.99/24, 192.168/16,
  // 198.18/15(benchmark), 198.51.100/24(TEST-NET-2), 203.0.113/24(TEST-NET-3),
  // 224/4(multicast), 240/4(reserved), 255.255.255.255
  const ranges: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
    ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
  ]
  return ranges.some(([base, prefix]) => ipv4InCidr(ip, base, prefix))
}

// === IPv6 ===

function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0] // 去掉 zone id
  if (normalized === '::' || normalized === '::1') return true
  // 简化判断：基于前缀字符串
  const prefixes = [
    'fc', 'fd',          // fc00::/7 ULA
    'fe8', 'fe9', 'fea', 'feb', // fe80::/10 link-local
    'ff',                // ff00::/8 multicast
    '::ffff:',           // IPv4-mapped（其内容按 IPv4 判定）
  ]
  for (const p of prefixes) {
    if (normalized.startsWith(p)) return true
  }
  // IPv4-mapped IPv6（::ffff:a.b.c.d）
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateOrReservedIPv4(mapped[1])
  // 其他未列出的保留段（2001:db8::/32 文档地址、64:ff9b::/96 等）保守拒绝
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('64:ff9b:')) return true
  return false
}

export function isPrivateOrReserved(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateOrReservedIPv4(ip)
  if (isIP(ip) === 6) return isPrivateOrReservedIPv6(ip)
  return true // 无法识别的 IP 一律拒绝
}

/** 去掉 IPv6 方括号（Node URL.hostname 对 IPv6 会保留括号）。 */
function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '')
}

// === URL 校验 ===

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

export interface ValidatedRemote {
  url: URL
  hostname: string
  resolvedIps: string[]
}

const KNOWN_MIMO_HOSTS = new Set([
  'api.xiaomimimo.com',
  'token-plan-cn.xiaomimimo.com',
  'token-plan-sgp.xiaomimimo.com',
  'token-plan-ams.xiaomimimo.com',
])

function localProxyConfigured(): boolean {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (!raw) return false
  try {
    const proxy = new URL(raw)
    return (proxy.protocol === 'http:' || proxy.protocol === 'https:')
      && ['localhost', '127.0.0.1', '::1'].includes(proxy.hostname)
  } catch {
    return false
  }
}

export function isKnownMiMoHost(hostname: string): boolean {
  return KNOWN_MIMO_HOSTS.has(hostname.toLowerCase().replace(/^\[|\]$/g, ''))
}

/** 校验 URL 结构（协议 / userinfo / fragment / 端口），不做 DNS。 */
export function validateHttpsUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfError('invalid URL')
  }
  if (url.protocol !== 'https:') {
    throw new SsrfError('only https:// is allowed')
  }
  if (url.username || url.password) {
    throw new SsrfError('URL userinfo is not allowed')
  }
  if (url.hash) {
    throw new SsrfError('URL fragment is not allowed')
  }
  if (!url.hostname) {
    throw new SsrfError('URL hostname is required')
  }
  // 同步拒绝私网 IP 字面量（hostname 的 DNS 校验在 assertSafeRemoteUrl）
  const hostname = hostnameOf(url)
  if (isIP(hostname) && isPrivateOrReserved(hostname)) {
    throw new SsrfError('target IP is private or reserved')
  }
  return url
}

/** 全量校验：结构 + DNS 解析 + 私网/保留段拒绝。 */
export async function assertSafeRemoteUrl(
  raw: string,
  options: { allowKnownMiMoProxy?: boolean } = {},
): Promise<ValidatedRemote> {
  const url = validateHttpsUrl(raw)
  const hostname = hostnameOf(url)

  // VPN/TUN clients may return a synthetic 198.18.* address locally while a
  // configured loopback proxy resolves the real public destination. Keep this
  // exception limited to official MiMo hosts and local runtime only.
  if (options.allowKnownMiMoProxy
    && process.env.PERSONAL_AI_OS_MODE !== 'hosted'
    && isKnownMiMoHost(hostname)
    && localProxyConfigured()) {
    return { url, hostname, resolvedIps: [] }
  }

  // 直接是 IP 字面量
  if (isIP(hostname)) {
    if (isPrivateOrReserved(hostname)) {
      throw new SsrfError('target IP is private or reserved')
    }
    return { url, hostname, resolvedIps: [hostname] }
  }

  // hostname → DNS 解析，任一结果落私网即拒绝
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new SsrfError('DNS resolution failed')
  }
  const resolvedIps = addresses.map(a => a.address)
  for (const ip of resolvedIps) {
    if (isPrivateOrReserved(ip)) {
      throw new SsrfError('resolved IP is private or reserved')
    }
  }
  return { url, hostname, resolvedIps }
}
