import {
  BACKEND_PROFILES_KV_KEY,
  sanitizeBackendProfiles,
  type BackendProfile,
} from '../../src/shared/backend-profiles'

export interface PanelEnv {
  BACKENDS_KV?: {
    get(key: string): Promise<string | null>
    put(key: string, value: string): Promise<void>
  }
  PANEL_PASSWORD?: string
  PANEL_SESSION_SECRET?: string
}

export interface PanelFunctionContext {
  env: PanelEnv
  request: Request
}

interface PanelEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

const SESSION_COOKIE_NAME = 'nh_panel_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function json<T>(data: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(
    JSON.stringify({ success: true, data } satisfies PanelEnvelope<T>),
    { ...init, headers },
  )
}

export function fail(code: string, message: string, status: number, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message },
    } satisfies PanelEnvelope<never>),
    { ...init, status, headers },
  )
}

export async function requirePanelAuth(context: PanelFunctionContext) {
  const envError = ensurePanelEnv(context.env)
  if (envError) return envError

  const expected = await getSessionToken(context.env)
  const provided = getCookie(context.request.headers.get('Cookie') || '', SESSION_COOKIE_NAME)
  if (!provided || provided !== expected) {
    return fail('UNAUTHORIZED', 'Panel login required', 401)
  }
  return null
}

export async function readBackendProfiles(env: PanelEnv): Promise<BackendProfile[]> {
  ensurePanelEnvOrThrow(env)
  const raw = await env.BACKENDS_KV!.get(BACKEND_PROFILES_KV_KEY)
  if (!raw) return []

  try {
    return sanitizeBackendProfiles(JSON.parse(raw))
  } catch {
    return []
  }
}

export async function writeBackendProfiles(env: PanelEnv, profiles: unknown) {
  ensurePanelEnvOrThrow(env)
  const sanitized = sanitizeBackendProfiles(profiles)
  await env.BACKENDS_KV!.put(BACKEND_PROFILES_KV_KEY, JSON.stringify(sanitized))
  return sanitized
}

export async function verifyPanelPassword(env: PanelEnv, password: string) {
  const envError = ensurePanelEnv(env)
  if (envError) return envError
  if (password !== String(env.PANEL_PASSWORD || '')) {
    return fail('UNAUTHORIZED', 'Invalid panel password', 401)
  }
  return null
}

export async function createSessionCookie(request: Request, env: PanelEnv) {
  const secure = new URL(request.url).protocol === 'https:'
  const token = await getSessionToken(env)
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

function ensurePanelEnv(env: PanelEnv) {
  if (!env.PANEL_PASSWORD) {
    return fail('CONFIG_ERROR', 'PANEL_PASSWORD is missing', 500)
  }
  if (!env.BACKENDS_KV) {
    return fail('CONFIG_ERROR', 'BACKENDS_KV binding is missing', 500)
  }
  return null
}

function ensurePanelEnvOrThrow(env: PanelEnv) {
  const error = ensurePanelEnv(env)
  if (error) {
    throw new Error('Panel environment is not configured')
  }
}

async function getSessionToken(env: PanelEnv) {
  ensurePanelEnvOrThrow(env)
  const encoder = new TextEncoder()
  const seed = `${env.PANEL_PASSWORD}:${env.PANEL_SESSION_SECRET || env.PANEL_PASSWORD}`
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
