import {
  BACKEND_PROFILES_STORAGE_KEY,
  sanitizeBackendProfiles,
  type BackendProfile,
} from '../shared/backend-profiles'

interface PanelEnvelope<T> {
  success: boolean
  data: T
  error?: {
    code: string
    message: string
  }
}

export class PanelApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'PANEL_API_ERROR') {
    super(message)
    this.name = 'PanelApiError'
    this.status = status
    this.code = code
  }
}

let panelApiMode: 'unknown' | 'remote' | 'local' = 'unknown'

export function isLocalPanelMode() {
  return panelApiMode === 'local'
}

function isPanelApiUnavailable(error: unknown) {
  return error instanceof PanelApiError
    && error.status === 404
}

function readLocalProfiles(): BackendProfile[] {
  try {
    return sanitizeBackendProfiles(JSON.parse(localStorage.getItem(BACKEND_PROFILES_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

function writeLocalProfiles(profiles: BackendProfile[]) {
  const sanitized = sanitizeBackendProfiles(profiles)
  localStorage.setItem(BACKEND_PROFILES_STORAGE_KEY, JSON.stringify(sanitized))
  return sanitized
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (panelApiMode === 'local') {
    throw new PanelApiError('Panel API unavailable', 404, 'PANEL_API_UNAVAILABLE')
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  const rawBody = await response.text()
  const body = rawBody ? JSON.parse(rawBody) as PanelEnvelope<T> : null

  if (!response.ok || !body?.success) {
    const error = new PanelApiError(
      body?.error?.message || `Request failed: ${response.status}`,
      response.status,
      body?.error?.code || 'PANEL_API_ERROR',
    )
    if (response.status === 404 && path.startsWith('/api/panel/')) {
      panelApiMode = 'local'
    }
    throw error
  }

  if (path.startsWith('/api/panel/')) {
    panelApiMode = 'remote'
  }
  return body.data
}

export async function getPanelSession(): Promise<boolean> {
  try {
    const result = await request<{ authenticated: boolean }>('/api/panel/session')
    return Boolean(result.authenticated)
  } catch (error) {
    if (isPanelApiUnavailable(error)) {
      panelApiMode = 'local'
      return true
    }
    if (error instanceof PanelApiError && error.status === 401) {
      return false
    }
    throw error
  }
}

export function loginToPanel(password: string) {
  if (panelApiMode === 'local') {
    return Promise.resolve({ authenticated: true })
  }
  return request<{ authenticated: boolean }>('/api/panel/session', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function logoutFromPanel() {
  if (panelApiMode === 'local') {
    return Promise.resolve({ authenticated: false })
  }
  return request<{ authenticated: boolean }>('/api/panel/session', {
    method: 'DELETE',
  })
}

export async function listBackendProfiles() {
  if (panelApiMode === 'local') {
    return { profiles: readLocalProfiles() }
  }

  try {
    return await request<{ profiles: BackendProfile[] }>('/api/panel/backend-profiles')
  } catch (error) {
    if (isPanelApiUnavailable(error)) {
      panelApiMode = 'local'
      return { profiles: readLocalProfiles() }
    }
    throw error
  }
}

export async function saveBackendProfiles(profiles: BackendProfile[]) {
  if (panelApiMode === 'local') {
    return { profiles: writeLocalProfiles(profiles) }
  }

  try {
    return await request<{ profiles: BackendProfile[] }>('/api/panel/backend-profiles', {
      method: 'PUT',
      body: JSON.stringify({ profiles }),
    })
  } catch (error) {
    if (isPanelApiUnavailable(error)) {
      panelApiMode = 'local'
      return { profiles: writeLocalProfiles(profiles) }
    }
    throw error
  }
}
