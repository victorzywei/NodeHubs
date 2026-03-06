import type {
  NodeRecord,
  PublicSubscriptionDocument,
  ReleaseArtifact,
  ReleaseKind,
  RuntimeBinaryPlan,
  SubscriptionDocumentFormat,
  SubscriptionEndpoint,
  TemplatePreset,
  TemplateRecord,
} from '@contracts/index'
import type { RuntimeCatalog } from './runtime-catalog'

type RenderContext = {
  releaseId: string
  revision: number
  kind: ReleaseKind
  configRevision: number
  bootstrapRevision: number
  createdAt: string
  message: string
  summary: string
  node: NodeRecord
  templates: TemplateRecord[]
}

type NormalizedTemplate = {
  id: string
  name: string
  engine: TemplateRecord['engine']
  protocol: string
  transport: string
  tlsMode: TemplateRecord['tlsMode']
  server: string
  port: number
  host: string
  sni: string
  path: string
  serviceName: string
  uuid: string
  password: string
  method: string
  flow: string
  realityPrivateKey: string
  realityPublicKey: string
  realityShortId: string
  certPath: string
  keyPath: string
  defaults: Record<string, unknown>
}

const SUPPORTED_PROTOCOLS = new Set(['vless', 'trojan', 'shadowsocks'])
const SUPPORTED_TRANSPORTS = new Set(['ws', 'grpc', 'tcp'])

const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'singbox-vless-ws-tls',
    name: 'VLESS WS TLS',
    engine: 'sing-box',
    protocol: 'vless',
    transport: 'ws',
    tlsMode: 'tls',
    defaults: {
      serverPort: 443,
      path: '/ws',
      host: '',
      sni: '',
      uuid: '00000000-0000-4000-8000-000000000001',
    },
    notes: 'TLS over WebSocket for CDN-style deployments.',
  },
  {
    id: 'singbox-vless-reality',
    name: 'VLESS Reality',
    engine: 'sing-box',
    protocol: 'vless',
    transport: 'tcp',
    tlsMode: 'reality',
    defaults: {
      serverPort: 443,
      uuid: '00000000-0000-4000-8000-000000000002',
      sni: 'www.cloudflare.com',
      realityPublicKey: 'replace-me',
      realityPrivateKey: 'replace-me',
      realityShortId: '0123456789abcdef',
    },
    notes: 'Direct TCP with Reality handshake fields.',
  },
  {
    id: 'xray-trojan-grpc',
    name: 'Trojan gRPC TLS',
    engine: 'xray',
    protocol: 'trojan',
    transport: 'grpc',
    tlsMode: 'tls',
    defaults: {
      serverPort: 443,
      serviceName: 'grpc',
      password: 'replace-me',
      sni: '',
    },
    notes: 'Trojan on gRPC for Xray runtime.',
  },
]

function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function readNumber(source: Record<string, unknown>, keys: string[], fallback: number): number {
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

function normalizePath(value: string): string {
  if (!value) return '/'
  return value.startsWith('/') ? value : `/${value}`
}

function ensureSingleEngine(templates: TemplateRecord[]): TemplateRecord['engine'] {
  if (templates.length === 0) return 'sing-box'
  const engine = templates[0].engine
  for (const template of templates) {
    if (template.engine !== engine) {
      throw new Error('A release can only include templates from a single runtime engine')
    }
  }
  return engine
}

function ensureProtocolSupport(template: TemplateRecord): void {
  const protocol = template.protocol.toLowerCase()
  const transport = template.transport.toLowerCase()
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new Error(`Template ${template.name} uses unsupported protocol: ${template.protocol}`)
  }
  if (!SUPPORTED_TRANSPORTS.has(transport)) {
    throw new Error(`Template ${template.name} uses unsupported transport: ${template.transport}`)
  }
}

function defaultPort(template: TemplateRecord): number {
  if (template.tlsMode === 'none') return 80
  return 443
}

function ensureField(value: string, fieldName: string, templateName: string): string {
  if (!value) {
    throw new Error(`Template ${templateName} is missing required field: ${fieldName}`)
  }
  return value
}

function normalizeTemplate(node: NodeRecord, template: TemplateRecord): NormalizedTemplate {
  ensureProtocolSupport(template)
  const defaults = template.defaults || {}
  const server = readString(defaults, 'server', node.primaryDomain || node.entryIp || node.backupDomain)
  if (!server) {
    throw new Error(`Node ${node.name} does not have a primary domain or entry IP for template ${template.name}`)
  }

  const protocol = template.protocol.toLowerCase()
  const transport = template.transport.toLowerCase()
  const tlsMode = template.tlsMode
  const host = readString(defaults, 'host', node.primaryDomain || server)
  const sni = readString(defaults, 'sni', node.primaryDomain || host || server)
  const normalized: NormalizedTemplate = {
    id: template.id,
    name: template.name,
    engine: template.engine,
    protocol,
    transport,
    tlsMode,
    server,
    port: readNumber(defaults, ['serverPort', 'port'], defaultPort(template)),
    host,
    sni,
    path: normalizePath(readString(defaults, 'path', `/connect/${template.id.slice(-6)}`)),
    serviceName: readString(defaults, 'serviceName', `grpc-${template.id.slice(-6)}`),
    uuid: readString(defaults, 'uuid'),
    password: readString(defaults, 'password'),
    method: readString(defaults, 'method', 'aes-128-gcm'),
    flow: readString(defaults, 'flow'),
    realityPrivateKey: readString(defaults, 'realityPrivateKey'),
    realityPublicKey: readString(defaults, 'realityPublicKey'),
    realityShortId: readString(defaults, 'realityShortId'),
    certPath: readString(defaults, 'certPath', '/etc/newnodeshub/certs/server.crt'),
    keyPath: readString(defaults, 'keyPath', '/etc/newnodeshub/certs/server.key'),
    defaults,
  }

  if (protocol === 'vless') {
    normalized.uuid = ensureField(normalized.uuid, 'uuid', template.name)
  }
  if (protocol === 'trojan') {
    normalized.password = ensureField(normalized.password, 'password', template.name)
  }
  if (protocol === 'shadowsocks') {
    normalized.password = ensureField(normalized.password, 'password', template.name)
    normalized.method = ensureField(normalized.method, 'method', template.name)
  }
  if (tlsMode === 'reality') {
    normalized.realityPublicKey = ensureField(normalized.realityPublicKey, 'realityPublicKey', template.name)
    normalized.realityPrivateKey = ensureField(normalized.realityPrivateKey, 'realityPrivateKey', template.name)
    normalized.realityShortId = ensureField(normalized.realityShortId, 'realityShortId', template.name)
    normalized.sni = ensureField(normalized.sni, 'sni', template.name)
  }

  return normalized
}

function buildSingBoxInbound(template: NormalizedTemplate, index: number) {
  const inbound: Record<string, unknown> = {
    type: template.protocol,
    tag: `in-${index + 1}`,
    listen: '::',
    listen_port: template.port,
  }

  if (template.protocol === 'vless') {
    inbound.users = [
      {
        uuid: template.uuid,
        flow: template.flow || undefined,
      },
    ]
  } else if (template.protocol === 'trojan') {
    inbound.users = [
      {
        password: template.password,
      },
    ]
  } else if (template.protocol === 'shadowsocks') {
    inbound.method = template.method
    inbound.password = template.password
  }

  if (template.transport === 'ws') {
    inbound.transport = {
      type: 'ws',
      path: template.path,
      headers: template.host ? { Host: template.host } : undefined,
    }
  } else if (template.transport === 'grpc') {
    inbound.transport = {
      type: 'grpc',
      service_name: template.serviceName,
    }
  }

  if (template.tlsMode === 'tls') {
    inbound.tls = {
      enabled: true,
      server_name: template.sni || template.server,
      certificate_path: template.certPath,
      key_path: template.keyPath,
    }
  } else if (template.tlsMode === 'reality') {
    inbound.tls = {
      enabled: true,
      server_name: template.sni,
      reality: {
        enabled: true,
        private_key: template.realityPrivateKey,
        short_id: [template.realityShortId],
      },
    }
  }

  return inbound
}

function buildXrayInbound(template: NormalizedTemplate, index: number) {
  const inbound: Record<string, unknown> = {
    tag: `in-${index + 1}`,
    port: template.port,
    listen: '0.0.0.0',
    protocol: template.protocol,
  }

  if (template.protocol === 'vless') {
    inbound.settings = {
      clients: [
        {
          id: template.uuid,
          flow: template.flow || undefined,
        },
      ],
      decryption: 'none',
    }
  } else if (template.protocol === 'trojan') {
    inbound.settings = {
      clients: [
        {
          password: template.password,
        },
      ],
    }
  } else if (template.protocol === 'shadowsocks') {
    inbound.settings = {
      method: template.method,
      password: template.password,
      network: 'tcp,udp',
    }
  }

  const streamSettings: Record<string, unknown> = {
    network: template.transport,
  }

  if (template.transport === 'ws') {
    streamSettings.wsSettings = {
      path: template.path,
      headers: template.host ? { Host: template.host } : undefined,
    }
  } else if (template.transport === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: template.serviceName,
    }
  }

  if (template.tlsMode === 'tls') {
    streamSettings.security = 'tls'
    streamSettings.tlsSettings = {
      serverName: template.sni || template.server,
      certificates: [
        {
          certificateFile: template.certPath,
          keyFile: template.keyPath,
        },
      ],
    }
  } else if (template.tlsMode === 'reality') {
    streamSettings.security = 'reality'
    streamSettings.realitySettings = {
      show: false,
      dest: `${template.sni}:443`,
      xver: 0,
      serverNames: [template.sni],
      privateKey: template.realityPrivateKey,
      shortIds: [template.realityShortId],
    }
  }

  inbound.streamSettings = streamSettings
  return inbound
}

function encodeURIComponentSafe(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+')
}

function buildSubscriptionUri(node: NodeRecord, template: NormalizedTemplate): string {
  const label = encodeURIComponentSafe(`${node.name} ${template.name}`)
  const params = new URLSearchParams()
  params.set('type', template.transport)
  if (template.protocol === 'vless') {
    params.set('encryption', 'none')
  }
  if (template.transport === 'ws') {
    params.set('path', template.path)
    if (template.host) params.set('host', template.host)
  }
  if (template.transport === 'grpc') {
    params.set('serviceName', template.serviceName)
  }
  if (template.tlsMode === 'tls') {
    params.set('security', 'tls')
    if (template.sni) params.set('sni', template.sni)
  } else if (template.tlsMode === 'reality') {
    params.set('security', 'reality')
    params.set('sni', template.sni)
    params.set('pbk', template.realityPublicKey)
    params.set('sid', template.realityShortId)
  } else {
    params.set('security', 'none')
  }

  if (template.protocol === 'vless') {
    return `vless://${template.uuid}@${template.server}:${template.port}?${params.toString()}#${label}`
  }
  if (template.protocol === 'trojan') {
    return `trojan://${template.password}@${template.server}:${template.port}?${params.toString()}#${label}`
  }
  const credentials = btoa(`${template.method}:${template.password}`)
  return `ss://${credentials}@${template.server}:${template.port}#${label}`
}

function buildSubscriptionEntry(node: NodeRecord, template: NormalizedTemplate): SubscriptionEndpoint {
  return {
    nodeId: node.id,
    nodeName: node.name,
    templateId: template.id,
    templateName: template.name,
    engine: template.engine,
    protocol: template.protocol,
    transport: template.transport,
    tlsMode: template.tlsMode,
    label: `${node.name} ${template.name}`,
    server: template.server,
    port: template.port,
    uri: buildSubscriptionUri(node, template),
  }
}

function buildRuntimeConfig(engine: TemplateRecord['engine'], templates: NormalizedTemplate[]): Record<string, unknown> {
  if (engine === 'xray') {
    return {
      log: {
        loglevel: 'warning',
      },
      inbounds: templates.map(buildXrayInbound),
      outbounds: [
        {
          protocol: 'freedom',
          tag: 'direct',
        },
      ],
    }
  }

  return {
    log: {
      level: 'warn',
      timestamp: true,
    },
    inbounds: templates.map(buildSingBoxInbound),
    outbounds: [
      {
        type: 'direct',
        tag: 'direct',
      },
    ],
  }
}

function buildBootstrapNotes(node: NodeRecord, kind: ReleaseKind): string[] {
  const notes = [
    'The agent always applies files under /etc/newnodeshub/runtime.',
    'Create a local systemd unit named newnodeshub-runtime.service if you want automatic process restarts.',
  ]
  if (node.installWarp) {
    notes.push('This node requests WARP-enabled bootstrap steps.')
  }
  if (node.installArgo) {
    notes.push('This node requests Argo or tunnel-related bootstrap steps.')
  }
  if (kind === 'bootstrap') {
    notes.push('Bootstrap revision changed. Re-run local bootstrap hooks before marking the node ready.')
  }
  return notes
}

export function listTemplatePresets(): TemplatePreset[] {
  return TEMPLATE_PRESETS.map((item) => ({
    ...item,
    defaults: { ...item.defaults },
  }))
}

function cloneBinaryPlan(plan: RuntimeBinaryPlan): RuntimeBinaryPlan {
  return {
    ...plan,
  }
}

export function renderReleaseArtifact(context: RenderContext, runtimeCatalog: RuntimeCatalog): ReleaseArtifact {
  const engine = ensureSingleEngine(context.templates)
  const normalizedTemplates = context.templates.map((template) => normalizeTemplate(context.node, template))
  const runtimeConfig = buildRuntimeConfig(engine, normalizedTemplates)
  const entryConfigPath = `runtime/${engine}.json`
  const binaryPlan = cloneBinaryPlan(runtimeCatalog[engine])

  return {
    schema: 'newnodeshub-release-v2',
    releaseId: context.releaseId,
    nodeId: context.node.id,
    revision: context.revision,
    kind: context.kind,
    configRevision: context.configRevision,
    bootstrapRevision: context.bootstrapRevision,
    summary: context.summary,
    message: context.message,
    createdAt: context.createdAt,
    node: {
      id: context.node.id,
      name: context.node.name,
      nodeType: context.node.nodeType,
      region: context.node.region,
      tags: [...context.node.tags],
      primaryDomain: context.node.primaryDomain,
      backupDomain: context.node.backupDomain,
      entryIp: context.node.entryIp,
      installWarp: context.node.installWarp,
      installArgo: context.node.installArgo,
    },
    templates: context.templates.map((template) => ({
      id: template.id,
      name: template.name,
      engine: template.engine,
      protocol: template.protocol,
      transport: template.transport,
      tlsMode: template.tlsMode,
      defaults: { ...template.defaults },
    })),
    runtime: {
      engine,
      binary: binaryPlan,
      entryConfigPath,
      files: [
        {
          path: entryConfigPath,
          contentType: 'application/json',
          content: JSON.stringify(runtimeConfig, null, 2),
        },
        {
          path: 'runtime/release.json',
          contentType: 'application/json',
          content: JSON.stringify(
            {
              releaseId: context.releaseId,
              revision: context.revision,
              kind: context.kind,
              configRevision: context.configRevision,
              bootstrapRevision: context.bootstrapRevision,
              message: context.message,
              summary: context.summary,
              createdAt: context.createdAt,
            },
            null,
            2,
          ),
        },
      ],
    },
    bootstrap: {
      serviceName: 'newnodeshub-agent',
      runtimeServiceName: 'newnodeshub-runtime',
      installWarp: context.node.installWarp,
      installArgo: context.node.installArgo,
      mode: context.kind === 'bootstrap' ? 'bootstrap-required' : 'runtime-only',
      notes: buildBootstrapNotes(context.node, context.kind),
    },
    subscriptionEndpoints: normalizedTemplates.map((template) => buildSubscriptionEntry(context.node, template)),
  }
}

export function parseReleaseArtifact(payload: string): ReleaseArtifact | null {
  try {
    const parsed = JSON.parse(payload) as Partial<ReleaseArtifact> | null
    if (!parsed || parsed.schema !== 'newnodeshub-release-v2') return null
    if (!Array.isArray(parsed.subscriptionEndpoints) || !parsed.runtime || !Array.isArray(parsed.runtime.files)) {
      return null
    }
    return parsed as ReleaseArtifact
  } catch {
    return null
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const item of bytes) binary += String.fromCharCode(item)
  return btoa(binary)
}

export function renderSubscriptionDocument(
  payload: Omit<PublicSubscriptionDocument, 'format'>,
  format: SubscriptionDocumentFormat,
): { body: string; contentType: string } {
  const plain = payload.entries.map((item) => item.uri).join('\n')
  if (format === 'json') {
    return {
      body: JSON.stringify({ ...payload, format }, null, 2),
      contentType: 'application/json; charset=utf-8',
    }
  }
  if (format === 'plain') {
    return {
      body: plain,
      contentType: 'text/plain; charset=utf-8',
    }
  }
  return {
    body: encodeBase64(plain),
    contentType: 'text/plain; charset=utf-8',
  }
}
