import type {
  NodeRecord,
  ReleaseLogRecord,
  ReleasePreviewRecord,
  ReleaseRecord,
  SubscriptionRecord,
  SystemStatus,
  TemplatePreset,
  TemplateRecord,
  TrafficSample,
} from '@contracts/index'

const API_BASE = import.meta.env.VITE_API_BASE || ''

interface Envelope<T> {
  success: boolean
  data: T
  error?: {
    code: string
    message: string
  }
}

async function request<T>(path: string, init: RequestInit = {}, adminKey = ''): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
      ...(init.headers || {}),
    },
  })

  const body = await response.json() as Envelope<T>
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message || `Request failed: ${response.status}`)
  }
  return body.data
}

async function requestText(path: string, init: RequestInit = {}, adminKey = ''): Promise<string> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    let message = body || `Request failed: ${response.status}`
    try {
      const parsed = JSON.parse(body) as Envelope<never>
      message = parsed.error?.message || message
    } catch {
      // Fall back to the raw response body.
    }
    throw new Error(message)
  }

  return response.text()
}

export function getSystemStatus(adminKey: string): Promise<SystemStatus> {
  return request('/api/system/status', {}, adminKey)
}

export function listNodes(adminKey: string): Promise<NodeRecord[]> {
  return request('/api/nodes', {}, adminKey)
}

export function createNode(adminKey: string, payload: Record<string, unknown>): Promise<NodeRecord> {
  return request('/api/nodes', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function deleteNode(adminKey: string, nodeId: string): Promise<{ deleted: string }> {
  return request(`/api/nodes/${nodeId}`, {
    method: 'DELETE',
  }, adminKey)
}

export function listTemplates(adminKey: string): Promise<TemplateRecord[]> {
  return request('/api/templates', {}, adminKey)
}

export function createTemplate(adminKey: string, payload: Record<string, unknown>): Promise<TemplateRecord> {
  return request('/api/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function updateTemplate(adminKey: string, templateId: string, payload: Record<string, unknown>): Promise<TemplateRecord> {
  return request(`/api/templates/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function deleteTemplate(adminKey: string, templateId: string): Promise<{ deleted: string }> {
  return request(`/api/templates/${templateId}`, {
    method: 'DELETE',
  }, adminKey)
}

export function listTemplateCatalog(adminKey: string): Promise<TemplatePreset[]> {
  return request('/api/templates/catalog', {}, adminKey)
}

export function listSubscriptions(adminKey: string): Promise<SubscriptionRecord[]> {
  return request('/api/subscriptions', {}, adminKey)
}

export function createSubscription(adminKey: string, payload: Record<string, unknown>): Promise<SubscriptionRecord> {
  return request('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function updateSubscription(adminKey: string, subscriptionId: string, payload: Record<string, unknown>): Promise<SubscriptionRecord> {
  return request(`/api/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function deleteSubscription(adminKey: string, subscriptionId: string): Promise<{ deleted: string }> {
  return request(`/api/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
  }, adminKey)
}

export function listNodeReleases(adminKey: string, nodeId: string): Promise<ReleaseRecord[]> {
  return request(`/api/nodes/${nodeId}/releases`, {}, adminKey)
}

export function getNodeReleaseLog(adminKey: string, nodeId: string, releaseId: string): Promise<ReleaseLogRecord> {
  return request(`/api/nodes/${nodeId}/releases/${releaseId}/log`, {}, adminKey)
}

export function publishNode(adminKey: string, nodeId: string, payload: Record<string, unknown>): Promise<ReleaseRecord> {
  return request(`/api/nodes/${nodeId}/releases`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function previewNodeRelease(
  adminKey: string,
  nodeId: string,
  payload: Record<string, unknown>,
): Promise<ReleasePreviewRecord> {
  return request(`/api/nodes/${nodeId}/releases/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, adminKey)
}

export function listNodeTraffic(adminKey: string, nodeId: string): Promise<TrafficSample[]> {
  return request(`/api/nodes/${nodeId}/traffic`, {}, adminKey)
}

export function getNodeInstallScript(adminKey: string, nodeId: string): Promise<string> {
  return requestText(`/api/nodes/${nodeId}/install-script`, {}, adminKey)
}

export function getNodeDeployCommand(adminKey: string, nodeId: string): Promise<{ command: string }> {
  return request(`/api/nodes/${nodeId}/deploy-command`, {}, adminKey)
}

export function getNodeUninstallCommand(adminKey: string, nodeId: string): Promise<{ command: string }> {
  return request(`/api/nodes/${nodeId}/uninstall-command`, {}, adminKey)
}
