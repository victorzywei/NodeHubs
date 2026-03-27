import type { Context } from 'hono'
import type { AppServices, PanelConfig } from './app-types'
import { fail } from './response'

export interface PanelBackendProfile {
  id: string
  name: string
  apiBaseUrl: string
  adminKey: string
}

type AppContext = Context<{ Variables: { services: AppServices } }>

const SESSION_COOKIE_NAME = 'nh_panel_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function createPanelBackendProfileId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `backend-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function normalizePanelBackendApiBase(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : ''
}

export function sanitizePanelBackendProfiles(value: unknown): PanelBackendProfile[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isPanelBackendProfile)
    .map((profile, index) => ({
      id: profile.id.trim() || createPanelBackendProfileId(),
      name: profile.name.trim() || `Backend ${index + 1}`,
      apiBaseUrl: normalizePanelBackendApiBase(profile.apiBaseUrl),
      adminKey: profile.adminKey,
    }))
}

export async function requirePanelAuth(c: AppContext) {
  const panel = resolvePanelConfig(c.get('services'))
  if (panel instanceof Response) return panel

  const expected = await getSessionToken(panel)
  const provided = getCookie(c.req.header('Cookie') || '', SESSION_COOKIE_NAME)
  if (!provided || provided !== expected) {
    return fail('UNAUTHORIZED', 'Panel login required', 401)
  }
  return null
}

export async function verifyPanelPassword(services: AppServices, password: string) {
  const panel = resolvePanelConfig(services)
  if (panel instanceof Response) return panel
  if (password !== panel.password) {
    return fail('UNAUTHORIZED', 'Invalid panel password', 401)
  }
  return null
}

export async function createSessionCookie(request: Request, services: AppServices) {
  const panel = getPanelConfigOrThrow(services)
  const secure = new URL(request.url).protocol === 'https:'
  const token = await getSessionToken(panel)
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ]
  if (secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:'
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=0',
  ]
  if (secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export async function readPanelBackendProfiles(services: AppServices): Promise<PanelBackendProfile[]> {
  const rows = await services.db.all(
    `SELECT id, name, api_base_url, admin_key
     FROM panel_backend_profiles
     ORDER BY sort_order ASC, created_at ASC, id ASC`,
  )

  return rows.map((row) => ({
    id: String(row.id || ''),
    name: String(row.name || ''),
    apiBaseUrl: String(row.api_base_url || ''),
    adminKey: String(row.admin_key || ''),
  }))
}

export async function writePanelBackendProfiles(services: AppServices, profiles: unknown) {
  const sanitized = sanitizePanelBackendProfiles(profiles)
  await services.db.run('DELETE FROM panel_backend_profiles')

  const now = new Date().toISOString()
  for (const [index, profile] of sanitized.entries()) {
    await services.db.run(
      `INSERT INTO panel_backend_profiles (
        id,
        name,
        api_base_url,
        admin_key,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        profile.name,
        profile.apiBaseUrl,
        profile.adminKey,
        index,
        now,
        now,
      ],
    )
  }

  return sanitized
}

function isPanelBackendProfile(value: unknown): value is PanelBackendProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  return typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && typeof profile.apiBaseUrl === 'string'
    && typeof profile.adminKey === 'string'
}

function resolvePanelConfig(services: AppServices): PanelConfig | Response {
  if (!services.panel?.password) {
    return fail('CONFIG_ERROR', 'PANEL_PASSWORD is missing', 500)
  }
  return services.panel
}

function getPanelConfigOrThrow(services: AppServices): PanelConfig {
  const panel = resolvePanelConfig(services)
  if (panel instanceof Response) {
    throw new Error('Panel is not configured')
  }
  return panel
}

async function getSessionToken(panel: PanelConfig) {
  const encoder = new TextEncoder()
  const seed = `${panel.password}:${panel.sessionSecret}`
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(seed))
  return toBase64Url(new Uint8Array(digest))
}

function getCookie(cookieHeader: string, name: string) {
  for (const chunk of cookieHeader.split(';')) {
    const [rawName, ...rest] = chunk.trim().split('=')
    if (rawName === name) {
      return rest.join('=')
    }
  }
  return ''
}

function toBase64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
