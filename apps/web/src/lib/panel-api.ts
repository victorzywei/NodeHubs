import type { BackendProfile } from '../shared/backend-profiles'

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  const rawBody = await response.text()
  let body: PanelEnvelope<T> | null = null

  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as PanelEnvelope<T>
    } catch {
      throw new PanelApiError(`Request failed: ${response.status}`, response.status)
    }
  }

  if (!response.ok || !body?.success) {
    throw new PanelApiError(
      body?.error?.message || `Request failed: ${response.status}`,
      response.status,
      body?.error?.code || 'PANEL_API_ERROR',
    )
  }

  return body.data
}

export async function getPanelSession(): Promise<boolean> {
  try {
    const result = await request<{ authenticated: boolean }>('/api/panel/session')
    return Boolean(result.authenticated)
  } catch (error) {
    if (error instanceof PanelApiError && error.status === 401) {
      return false
    }
    throw error
  }
}

export function loginToPanel(password: string) {
  return request<{ authenticated: boolean }>('/api/panel/session', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function logoutFromPanel() {
  return request<{ authenticated: boolean }>('/api/panel/session', {
    method: 'DELETE',
  })
}

export function listBackendProfiles() {
  return request<{ profiles: BackendProfile[] }>('/api/panel/backend-profiles')
}

export function saveBackendProfiles(profiles: BackendProfile[]) {
  return request<{ profiles: BackendProfile[] }>('/api/panel/backend-profiles', {
    method: 'PUT',
    body: JSON.stringify({ profiles }),
  })
}
