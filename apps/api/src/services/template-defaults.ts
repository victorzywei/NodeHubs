import type { TemplatePreset, TemplateRecord } from '@contracts/index'

const SAMPLE_UUIDS = new Set([
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
])

const SAMPLE_SECRETS = new Set([
  'replace-me',
  'replace_me',
  'replace-me-base64-key',
  'your-password',
  'changeme',
  'change-me',
  'password',
])

const SAMPLE_REALITY_SNI = [
  'www.cloudflare.com',
  'www.microsoft.com',
  'www.apple.com',
  'aws.amazon.com',
]

type TemplateLike = Pick<TemplateRecord, 'protocol' | 'transport' | 'tlsMode' | 'defaults'>

function randomBytes(length: number): Uint8Array {
  const value = new Uint8Array(length)
  crypto.getRandomValues(value)
  return value
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (item) => item.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(value: Uint8Array): string {
  let binary = ''
  for (const item of value) binary += String.fromCharCode(item)
  return btoa(binary)
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const value = randomBytes(16)
  value[6] = (value[6] & 0x0f) | 0x40
  value[8] = (value[8] & 0x3f) | 0x80
  const hex = bytesToHex(value)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function randomOpaqueSecret(byteLength = 24): string {
  return bytesToHex(randomBytes(byteLength))
}

function randomShortId(byteLength = 8): string {
  return bytesToHex(randomBytes(byteLength))
}

function randomRealitySni(): string {
  const index = randomBytes(1)[0] % SAMPLE_REALITY_SNI.length
  return SAMPLE_REALITY_SNI[index] || SAMPLE_REALITY_SNI[0]
}

function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function isPlaceholderSecret(value: string): boolean {
  if (!value) return true
  const normalized = value.trim().toLowerCase()
  return SAMPLE_SECRETS.has(normalized)
}

function isSampleUuid(value: string): boolean {
  return SAMPLE_UUIDS.has(value.trim().toLowerCase())
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function isRealityShortId(value: string): boolean {
  return /^[0-9a-f]{2,32}$/i.test(value.trim())
}

function isPlaceholderSni(value: string): boolean {
  return /^例如\s+/i.test(value.trim())
}

function ss2022KeyLength(method: string): number | null {
  switch (method.trim().toLowerCase()) {
    case '2022-blake3-aes-128-gcm':
      return 16
    case '2022-blake3-aes-256-gcm':
      return 32
    case '2022-blake3-chacha20-poly1305':
      return 32
    default:
      return null
  }
}

function isValidSs2022Password(method: string, value: string): boolean {
  const expectedLength = ss2022KeyLength(method)
  if (!expectedLength) {
    return value.trim().length > 0
  }
  try {
    return atob(value.trim()).length === expectedLength
  } catch {
    return false
  }
}

function generateShadowsocksPassword(method: string): string {
  const expectedLength = ss2022KeyLength(method)
  if (!expectedLength) {
    return randomOpaqueSecret(24)
  }
  return bytesToBase64(randomBytes(expectedLength))
}

export function repairTemplateDefaults(template: TemplateLike): Record<string, unknown> {
  const defaults = { ...(template.defaults || {}) }
  const protocol = template.protocol.trim().toLowerCase()
  const tlsMode = template.tlsMode

  if (protocol === 'vless' || protocol === 'vmess') {
    const uuid = readString(defaults, 'uuid')
    if (!isUuid(uuid) || isSampleUuid(uuid)) {
      defaults.uuid = randomUuid()
    }
  }

  if (protocol === 'trojan' || protocol === 'hysteria2') {
    const password = readString(defaults, 'password')
    if (isPlaceholderSecret(password)) {
      defaults.password = randomOpaqueSecret(24)
    }
  }

  if (protocol === 'shadowsocks') {
    const method = readString(defaults, 'method', '2022-blake3-aes-128-gcm')
    defaults.method = method
    const password = readString(defaults, 'password')
    if (!isValidSs2022Password(method, password) || isPlaceholderSecret(password)) {
      defaults.password = generateShadowsocksPassword(method)
    }
  }

  if (tlsMode === 'reality') {
    const shortId = readString(defaults, 'realityShortId')
    if (!isRealityShortId(shortId)) {
      defaults.realityShortId = randomShortId()
    }
    const sni = readString(defaults, 'sni')
    if (!sni || isPlaceholderSni(sni)) {
      defaults.sni = randomRealitySni()
    }
  }

  return defaults
}

export function repairTemplateRecord(template: TemplateRecord): TemplateRecord {
  return {
    ...template,
    defaults: repairTemplateDefaults(template),
  }
}

export function hydrateTemplatePreset(preset: TemplatePreset): TemplatePreset {
  return {
    ...preset,
    defaults: repairTemplateDefaults({
      protocol: preset.protocol,
      transport: preset.transport,
      tlsMode: preset.tlsMode,
      defaults: preset.defaults || {},
    }),
  }
}
