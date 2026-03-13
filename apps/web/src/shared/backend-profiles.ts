export interface BackendProfile {
  id: string
  name: string
  apiBaseUrl: string
  adminKey: string
}

export const BACKEND_PROFILES_KV_KEY = 'nh:backend-profiles:v1'

export function createBackendProfileId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `backend-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function normalizeBackendApiBase(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : ''
}

export function isBackendProfile(value: unknown): value is BackendProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  return typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && typeof profile.apiBaseUrl === 'string'
    && typeof profile.adminKey === 'string'
}

export function sanitizeBackendProfiles(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .filter(isBackendProfile)
    .map((profile, index) => ({
      id: profile.id.trim() || createBackendProfileId(),
      name: profile.name.trim() || `Backend ${index + 1}`,
      apiBaseUrl: normalizeBackendApiBase(profile.apiBaseUrl),
      adminKey: profile.adminKey,
    }))
}
