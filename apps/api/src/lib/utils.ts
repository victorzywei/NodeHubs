export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function createToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function parseJsonObject<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || fallback
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export function readNumber(source: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return Math.trunc(parsed)
    }
  }
  return fallback
}

export function readStringArray(source: Record<string, unknown>, key: string, fallback: string[] = []): string[] {
  const value = source[key]
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean)
    return items.length > 0 ? items : fallback
  }
  if (typeof value === 'string') {
    const items = value.split(',').map((item) => item.trim()).filter(Boolean)
    return items.length > 0 ? items : fallback
  }
  return fallback
}

export function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.trim().length > 0)))
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}
