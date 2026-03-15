import type { EdgeWorkerPlan, ReleaseArtifact } from '@contracts/index'

export const EDGE_WORKER_PLAN_PATH = 'runtime/worker-plan.json'

function escapeScriptValue(value: string): string {
  return JSON.stringify(String(value || ''))
}

export function buildEdgeWorkerScript(input: {
  publicBaseUrl: string
  nodeId: string
  agentToken: string
  workerDomain: string
  heartbeatIntervalSeconds: number
  versionPullIntervalSeconds: number
}): string {
  const controlPlaneUrl = input.publicBaseUrl.replace(/\/+$/, '')
  const config = `const CONFIG = {
  CONTROL_PLANE_URL: ${escapeScriptValue(controlPlaneUrl)},
  NODE_ID: ${escapeScriptValue(input.nodeId)},
  AGENT_TOKEN: ${escapeScriptValue(input.agentToken)},
  WORKER_DOMAIN: ${escapeScriptValue(input.workerDomain)},
}

const SYNC_INTERVAL_MS = ${Math.max(5, Math.trunc(input.versionPullIntervalSeconds || 15))} * 1000
const HEARTBEAT_INTERVAL_MS = ${Math.max(5, Math.trunc(input.heartbeatIntervalSeconds || 30))} * 1000
`

  return `${config}
let cachedPlan = null
let lastSyncAt = 0
let lastHeartbeatAt = 0
let currentSyncPromise = null
let activeConnections = 0
let bytesInTotal = 0
let bytesOutTotal = 0
let socketsConnect = null

function nowIso() {
  return new Date().toISOString()
}

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function apiUrl(path) {
  return CONFIG.CONTROL_PLANE_URL.replace(/\\/+$/, '') + path
}

function isWebSocketRequest(request) {
  return (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket'
}

function normalizePath(value) {
  const raw = String(value || '').trim()
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : '/' + raw
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  return new Uint8Array(0)
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}

async function getConnect() {
  if (socketsConnect) return socketsConnect
  const mod = await import('cloudflare:sockets')
  socketsConnect = mod.connect
  return socketsConnect
}

async function fetchJson(path, init) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': CONFIG.AGENT_TOKEN,
      ...(init && init.headers ? init.headers : {}),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || ('Request failed: ' + response.status))
  }
  return text ? JSON.parse(text) : null
}

async function maybeHeartbeat(ctx, force) {
  const now = Date.now()
  if (!force && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
    return
  }
  lastHeartbeatAt = now
  const task = fetchJson('/api/edge/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      nodeId: CONFIG.NODE_ID,
      workerDomain: CONFIG.WORKER_DOMAIN,
      currentConnections: activeConnections,
      bytesInTotal,
      bytesOutTotal,
    }),
  }).catch(() => null)
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task)
    return
  }
  await task
}

async function syncPlan(ctx, force) {
  const now = Date.now()
  if (!force && cachedPlan && now - lastSyncAt < SYNC_INTERVAL_MS) {
    return cachedPlan
  }
  if (currentSyncPromise) {
    return currentSyncPromise
  }
  currentSyncPromise = (async () => {
    const reconcile = await fetchJson('/api/edge/reconcile?nodeId=' + encodeURIComponent(CONFIG.NODE_ID))
    if (!reconcile || !reconcile.needsUpdate) {
      lastSyncAt = Date.now()
      return cachedPlan
    }
    const planUrl = String(reconcile.planUrl || '')
    if (!planUrl) {
      throw new Error('Missing planUrl in edge reconcile response')
    }
    const response = await fetch(planUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': CONFIG.AGENT_TOKEN,
      },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || ('Failed to fetch edge plan: ' + response.status))
    }
    const payload = text ? JSON.parse(text) : null
    cachedPlan = payload && payload.success ? payload.data : payload
    lastSyncAt = Date.now()
    if (reconcile.releaseId) {
      await fetchJson('/api/edge/releases/' + encodeURIComponent(reconcile.releaseId) + '/ack', {
        method: 'POST',
        body: JSON.stringify({
          nodeId: CONFIG.NODE_ID,
          status: 'healthy',
          message: 'Edge worker synced plan ' + String(cachedPlan && cachedPlan.revision ? cachedPlan.revision : ''),
        }),
      }).catch(() => null)
    }
    return cachedPlan
  })().finally(() => {
    currentSyncPromise = null
  })

  if (ctx && typeof ctx.waitUntil === 'function' && !force) {
    ctx.waitUntil(currentSyncPromise)
  }
  return currentSyncPromise
}

function findPlanEntry(pathname) {
  const entries = cachedPlan && Array.isArray(cachedPlan.entries) ? cachedPlan.entries : []
  return entries.find((entry) => normalizePath(entry.path) === normalizePath(pathname)) || null
}

async function openRemoteSocket(entry, initialChunk, ws) {
  if (entry.protocol === 'vless') {
    return connectVless(entry, initialChunk, ws)
  }
  if (entry.protocol === 'trojan') {
    return connectTrojan(entry, initialChunk)
  }
  throw new Error('Unsupported edge protocol: ' + String(entry.protocol || ''))
}

async function connectVless(entry, initialChunk, ws) {
  if (!entry.uuid) {
    throw new Error('VLESS uuid is missing')
  }
  if (initialChunk.length < 24) {
    throw new Error('VLESS header is too short')
  }

  const version = initialChunk[0]
  const requestUuid = bytesToUuid(initialChunk.slice(1, 17))
  if (requestUuid !== entry.uuid) {
    throw new Error('Invalid VLESS uuid')
  }

  const addonLength = initialChunk[17]
  const commandOffset = 18 + addonLength
  if (initialChunk.length < commandOffset + 4) {
    throw new Error('Invalid VLESS request header')
  }
  if (initialChunk[commandOffset] !== 1) {
    throw new Error('Only TCP is supported for VLESS edge workers')
  }

  const port = (initialChunk[commandOffset + 1] << 8) | initialChunk[commandOffset + 2]
  const addressType = initialChunk[commandOffset + 3]
  let offset = commandOffset + 4
  let hostname = ''

  if (addressType === 1) {
    if (initialChunk.length < offset + 4) throw new Error('Invalid VLESS IPv4 header')
    hostname = initialChunk[offset] + '.' + initialChunk[offset + 1] + '.' + initialChunk[offset + 2] + '.' + initialChunk[offset + 3]
    offset += 4
  } else if (addressType === 2) {
    if (initialChunk.length < offset + 1) throw new Error('Invalid VLESS domain header')
    const domainLength = initialChunk[offset]
    offset += 1
    if (initialChunk.length < offset + domainLength) throw new Error('Invalid VLESS domain payload')
    hostname = new TextDecoder().decode(initialChunk.slice(offset, offset + domainLength))
    offset += domainLength
  } else if (addressType === 3) {
    if (initialChunk.length < offset + 16) throw new Error('Invalid VLESS IPv6 header')
    const chunks = []
    for (let index = 0; index < 16; index += 2) {
      chunks.push(((initialChunk[offset + index] << 8) | initialChunk[offset + index + 1]).toString(16))
    }
    hostname = chunks.join(':')
    offset += 16
  } else {
    throw new Error('Unknown VLESS address type')
  }

  const connect = await getConnect()
  const socket = connect({ hostname, port })
  const writer = socket.writable.getWriter()
  const payload = initialChunk.slice(offset)

  if (payload.length > 0) {
    bytesInTotal += payload.length
    await writer.write(payload)
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(new Uint8Array([version, 0]))
  }

  return { socket, writer }
}

async function connectTrojan(entry, initialChunk) {
  if (!entry.password) {
    throw new Error('Trojan password is missing')
  }
  if (initialChunk.length < 60) {
    throw new Error('Trojan header is too short')
  }

  const digest = await crypto.subtle.digest('SHA-224', new TextEncoder().encode(entry.password))
  const expectedHash = Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('')
  const providedHash = new TextDecoder().decode(initialChunk.slice(0, 56))
  if (expectedHash !== providedHash) {
    throw new Error('Invalid Trojan password')
  }
  if (initialChunk[56] !== 13 || initialChunk[57] !== 10 || initialChunk[58] !== 1) {
    throw new Error('Unsupported Trojan request')
  }

  const addressType = initialChunk[59]
  let offset = 60
  let hostname = ''

  if (addressType === 1) {
    if (initialChunk.length < offset + 4) throw new Error('Invalid Trojan IPv4 header')
    hostname = initialChunk[offset] + '.' + initialChunk[offset + 1] + '.' + initialChunk[offset + 2] + '.' + initialChunk[offset + 3]
    offset += 4
  } else if (addressType === 3) {
    if (initialChunk.length < offset + 1) throw new Error('Invalid Trojan domain header')
    const domainLength = initialChunk[offset]
    offset += 1
    if (initialChunk.length < offset + domainLength) throw new Error('Invalid Trojan domain payload')
    hostname = new TextDecoder().decode(initialChunk.slice(offset, offset + domainLength))
    offset += domainLength
  } else if (addressType === 4) {
    if (initialChunk.length < offset + 16) throw new Error('Invalid Trojan IPv6 header')
    const chunks = []
    for (let index = 0; index < 16; index += 2) {
      chunks.push(((initialChunk[offset + index] << 8) | initialChunk[offset + index + 1]).toString(16))
    }
    hostname = chunks.join(':')
    offset += 16
  } else {
    throw new Error('Unknown Trojan address type')
  }

  if (initialChunk.length < offset + 2) {
    throw new Error('Invalid Trojan port payload')
  }

  const port = (initialChunk[offset] << 8) | initialChunk[offset + 1]
  offset += 2
  if (initialChunk[offset] === 13 && initialChunk[offset + 1] === 10) {
    offset += 2
  }

  const connect = await getConnect()
  const socket = connect({ hostname, port })
  const writer = socket.writable.getWriter()
  const payload = initialChunk.slice(offset)

  if (payload.length > 0) {
    bytesInTotal += payload.length
    await writer.write(payload)
  }

  return { socket, writer }
}

function attachRemoteReader(socket, ws) {
  socket.readable.pipeTo(new WritableStream({
    write(chunk) {
      const buffer = toUint8Array(chunk)
      bytesOutTotal += buffer.length
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer)
      }
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Remote closed')
      }
    },
    abort() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Remote aborted')
      }
    },
  })).catch(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Remote stream failed')
    }
  })
}

async function handleProxyWebSocket(request, ctx) {
  await syncPlan(ctx, true)
  if (!cachedPlan || !Array.isArray(cachedPlan.entries) || cachedPlan.entries.length === 0) {
    return new Response('Edge worker plan is not ready', { status: 503 })
  }

  const pathname = new URL(request.url).pathname
  const entry = findPlanEntry(pathname)
  if (!entry) {
    return new Response('Unknown edge route', { status: 404 })
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()
  activeConnections += 1

  let statePromise = null

  server.addEventListener('message', async (event) => {
    try {
      const chunk = toUint8Array(event.data)
      if (!statePromise) {
        statePromise = openRemoteSocket(entry, chunk, server).then((state) => {
          attachRemoteReader(state.socket, server)
          return state
        })
        await statePromise
        return
      }
      const state = await statePromise
      bytesInTotal += chunk.length
      await state.writer.write(chunk)
    } catch (error) {
      if (server.readyState === WebSocket.OPEN) {
        server.close(1011, error instanceof Error ? error.message : 'Proxy error')
      }
    }
  })

  server.addEventListener('close', async () => {
    activeConnections = Math.max(0, activeConnections - 1)
    if (statePromise) {
      const state = await statePromise.catch(() => null)
      if (state && state.writer) {
        state.writer.close().catch(() => null)
      }
    }
    await maybeHeartbeat(ctx, true)
  })

  server.addEventListener('error', async () => {
    activeConnections = Math.max(0, activeConnections - 1)
    if (statePromise) {
      const state = await statePromise.catch(() => null)
      if (state && state.writer) {
        state.writer.abort().catch(() => null)
      }
    }
    await maybeHeartbeat(ctx, true)
  })

  return new Response(null, { status: 101, webSocket: client })
}

export default {
  async fetch(request, env, ctx) {
    await maybeHeartbeat(ctx, false)
    if (isWebSocketRequest(request)) {
      return handleProxyWebSocket(request, ctx)
    }

    await syncPlan(ctx, false).catch(() => null)
    const pathname = new URL(request.url).pathname
    if (pathname === '/__nodehubs/status') {
      return json({
        ok: true,
        nodeId: CONFIG.NODE_ID,
        workerDomain: CONFIG.WORKER_DOMAIN,
        currentRevision: cachedPlan ? cachedPlan.revision : 0,
        lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
        lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt).toISOString() : null,
        entries: cachedPlan && Array.isArray(cachedPlan.entries) ? cachedPlan.entries.map((entry) => ({
          templateName: entry.templateName,
          protocol: entry.protocol,
          path: entry.path,
        })) : [],
        timestamp: nowIso(),
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
`
}

export function readEdgeWorkerPlan(artifact: ReleaseArtifact): EdgeWorkerPlan | null {
  const runtime = artifact.runtimes.find((item) => item.engine === 'worker')
  const file = runtime?.files.find((item) => item.path === EDGE_WORKER_PLAN_PATH)
  if (!file) return null

  try {
    const parsed = JSON.parse(file.content) as EdgeWorkerPlan | null
    if (!parsed || parsed.schema !== 'nodehubsapi-edge-plan-v1' || !Array.isArray(parsed.entries)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
