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
  listenPort: number
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

const SUPPORTED_PROTOCOLS = new Set(['vless', 'trojan', 'shadowsocks', 'vmess', 'hysteria2'])
const SUPPORTED_TRANSPORTS = new Set(['ws', 'grpc', 'tcp', 'h2', 'hysteria2', 'xhttp'])

const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'preset-hysteria2',
    name: 'Hysteria2',
    engine: 'sing-box',
    protocol: 'hysteria2',
    transport: 'hysteria2',
    tlsMode: 'tls',
    defaults: {
      serverPort: 443,
      password: 'replace-me',
      sni: '',
      upMbps: 100,
      downMbps: 100,
    },
    notes: '高性能 QUIC 协议，适合视频和游戏加速。支持 sing-box 引擎。',
  },
  {
    id: 'preset-ss2022',
    name: 'Shadowsocks 2022',
    engine: 'xray',
    protocol: 'shadowsocks',
    transport: 'tcp',
    tlsMode: 'none',
    defaults: {
      serverPort: 8388,
      method: '2022-blake3-aes-128-gcm',
      password: 'replace-me-base64-key',
    },
    notes: 'Shadowsocks 2022 协议，使用 AEAD-2022 加密，兼容 Xray / sing-box。',
  },
  {
    id: 'preset-vless-ws-tls',
    name: 'VLESS + WS + TLS',
    engine: 'xray',
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
    notes: 'CDN 友好的经典组合，适合反代部署。兼容 Xray / sing-box。',
  },
  {
    id: 'preset-vless-reality-tcp',
    name: 'VLESS + Reality + TCP',
    engine: 'xray',
    protocol: 'vless',
    transport: 'tcp',
    tlsMode: 'reality',
    defaults: {
      serverPort: 443,
      uuid: '00000000-0000-4000-8000-000000000002',
      flow: 'xtls-rprx-vision',
      sni: 'www.cloudflare.com',
      realityPublicKey: 'replace-me',
      realityPrivateKey: 'replace-me',
      realityShortId: '0123456789abcdef',
    },
    notes: 'Reality 免证书 TLS 伪装，抗检测能力强。兼容 Xray / sing-box。',
  },
  {
    id: 'preset-trojan-tcp-tls',
    name: 'Trojan + TCP + TLS',
    engine: 'xray',
    protocol: 'trojan',
    transport: 'tcp',
    tlsMode: 'tls',
    defaults: {
      serverPort: 443,
      password: 'replace-me',
      sni: '',
    },
    notes: '经典 Trojan 协议，需要有效 TLS 证书。兼容 Xray / sing-box。',
  },
  {
    id: 'preset-trojan-grpc-tls',
    name: 'Trojan + gRPC + TLS',
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
    notes: 'gRPC 多路复用传输，CDN 友好。兼容 Xray / sing-box。',
  },
  {
    id: 'preset-vmess-tls-ws',
    name: 'VMESS + TLS + WS',
    engine: 'xray',
    protocol: 'vmess',
    transport: 'ws',
    tlsMode: 'tls',
    defaults: {
      serverPort: 443,
      path: '/ws',
      host: '',
      sni: '',
      uuid: '00000000-0000-4000-8000-000000000003',
      alterId: 0,
    },
    notes: 'VMESS 经典 WebSocket 组合，CDN 可用。兼容 Xray / sing-box。',
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

function ensureTemplateCompatibility(template: TemplateRecord): void {
  const protocol = template.protocol.toLowerCase()
  const transport = template.transport.toLowerCase()

  if (protocol === 'hysteria2') {
    if (template.engine !== 'sing-box') {
      throw new Error(`Template ${template.name} requires sing-box for the hysteria2 protocol`)
    }
    if (transport !== 'hysteria2') {
      throw new Error(`Template ${template.name} must use the hysteria2 transport`)
    }
    if (template.tlsMode !== 'tls') {
      throw new Error(`Template ${template.name} must use TLS mode for hysteria2`)
    }
  }

  if (transport === 'hysteria2' && protocol !== 'hysteria2') {
    throw new Error(`Template ${template.name} can only use the hysteria2 transport with the hysteria2 protocol`)
  }

  if (protocol === 'shadowsocks') {
    if (template.tlsMode !== 'none') {
      throw new Error(`Template ${template.name} must disable TLS for shadowsocks`)
    }
    if (transport !== 'tcp') {
      throw new Error(`Template ${template.name} must use the tcp transport for shadowsocks`)
    }
  }

  if (template.tlsMode === 'reality') {
    if (protocol !== 'vless') {
      throw new Error(`Template ${template.name} can only use reality with the vless protocol`)
    }
    if (transport !== 'tcp') {
      throw new Error(`Template ${template.name} must use the tcp transport for reality`)
    }
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

function defaultTemplateServer(node: NodeRecord): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoTunnelDomain || node.primaryDomain || node.backupDomain || node.entryIp
  }
  return node.primaryDomain || node.entryIp || node.backupDomain || node.argoTunnelDomain
}

function normalizeTemplate(node: NodeRecord, template: TemplateRecord): NormalizedTemplate {
  ensureProtocolSupport(template)
  ensureTemplateCompatibility(template)
  const defaults = template.defaults || {}
  const server = readString(defaults, 'server', defaultTemplateServer(node))
  if (!server) {
    throw new Error(`Node ${node.name} does not have a reachable domain or entry IP for template ${template.name}`)
  }

  const protocol = template.protocol.toLowerCase()
  const transport = template.transport.toLowerCase()
  const tlsMode = template.tlsMode
  const listenPort = readNumber(defaults, ['serverPort', 'port'], defaultPort(template))
  const host = readString(defaults, 'host', node.primaryDomain || node.argoTunnelDomain || server)
  const sni = readString(defaults, 'sni', node.primaryDomain || node.argoTunnelDomain || host || server)
  const normalized: NormalizedTemplate = {
    id: template.id,
    name: template.name,
    engine: template.engine,
    protocol,
    transport,
    tlsMode,
    server,
    port: node.networkType === 'noPublicIp' ? 443 : listenPort,
    listenPort,
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
    certPath: readString(defaults, 'certPath', '/etc/nodehubsapi/certs/server.crt'),
    keyPath: readString(defaults, 'keyPath', '/etc/nodehubsapi/certs/server.key'),
    defaults,
  }

  if (protocol === 'vless' || protocol === 'vmess') {
    normalized.uuid = ensureField(normalized.uuid, 'uuid', template.name)
  }
  if (protocol === 'trojan' || protocol === 'hysteria2') {
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
  const protocol = template.protocol === 'shadowsocks' ? 'shadowsocks' : template.protocol
  const inbound: Record<string, unknown> = {
    type: protocol,
    tag: `in-${index + 1}`,
    listen: '::',
    listen_port: template.listenPort,
  }

  if (template.protocol === 'vless') {
    inbound.users = [
      {
        uuid: template.uuid,
        flow: template.flow || undefined,
      },
    ]
  } else if (template.protocol === 'vmess') {
    inbound.users = [
      {
        uuid: template.uuid,
        alterId: readNumber(template.defaults, ['alterId'], 0),
      },
    ]
  } else if (template.protocol === 'trojan') {
    inbound.users = [
      {
        password: template.password,
      },
    ]
  } else if (template.protocol === 'hysteria2') {
    inbound.users = [
      {
        password: template.password,
      },
    ]
    inbound.up_mbps = readNumber(template.defaults, ['upMbps'], 100)
    inbound.down_mbps = readNumber(template.defaults, ['downMbps'], 100)
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
  } else if (template.transport === 'xhttp') {
    inbound.transport = {
      type: 'http',
      path: template.path,
      headers: template.host ? { Host: template.host } : undefined,
    }
  }

  if (template.protocol === 'hysteria2') {
    inbound.tls = {
      enabled: true,
      server_name: template.sni || template.server,
      certificate_path: template.certPath,
      key_path: template.keyPath,
    }
  } else if (template.tlsMode === 'tls') {
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
  if (template.protocol === 'hysteria2') {
    throw new Error(`Template ${template.name} cannot be rendered with the xray engine`)
  }

  const inbound: Record<string, unknown> = {
    tag: `in-${index + 1}`,
    port: template.listenPort,
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
  } else if (template.protocol === 'vmess') {
    inbound.settings = {
      clients: [
        {
          id: template.uuid,
          alterId: readNumber(template.defaults, ['alterId'], 0),
        },
      ],
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
  } else if (template.transport === 'xhttp') {
    streamSettings.xhttpSettings = {
      path: template.path,
      host: template.host,
      mode: 'auto',
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
  if (template.transport === 'ws' || template.transport === 'xhttp') {
    params.set('path', template.path)
    if (template.host) params.set('host', template.host)
  }
  if (template.transport === 'grpc') {
    params.set('serviceName', template.serviceName)
  }
  if (template.tlsMode === 'tls' || template.protocol === 'hysteria2') {
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
  if (template.protocol === 'vmess') {
    const vmessConfig = {
      v: '2',
      ps: `${node.name} ${template.name}`,
      add: template.server,
      port: String(template.port),
      id: template.uuid,
      aid: String(readNumber(template.defaults, ['alterId'], 0)),
      net: template.transport,
      type: 'none',
      host: template.host || '',
      path: template.path || '',
      tls: template.tlsMode === 'tls' ? 'tls' : '',
      sni: template.sni || '',
    }
    return `vmess://${btoa(JSON.stringify(vmessConfig))}`
  }
  if (template.protocol === 'trojan') {
    return `trojan://${template.password}@${template.server}:${template.port}?${params.toString()}#${label}`
  }
  if (template.protocol === 'hysteria2') {
    return `hysteria2://${template.password}@${template.server}:${template.port}?${params.toString()}#${label}`
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
    'The agent always applies files under /etc/nodehubsapi/runtime.',
    'Create a local systemd unit named nodehubsapi-runtime.service if you want automatic process restarts.',
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
    schema: 'nodehubsapi-release-v2',
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
      networkType: context.node.networkType,
      primaryDomain: context.node.primaryDomain,
      backupDomain: context.node.backupDomain,
      entryIp: context.node.entryIp,
      githubMirrorUrl: context.node.githubMirrorUrl,
      warpLicenseKey: context.node.warpLicenseKey,
      cfDnsToken: context.node.cfDnsToken,
      argoTunnelToken: context.node.argoTunnelToken,
      argoTunnelDomain: context.node.argoTunnelDomain,
      argoTunnelPort: context.node.argoTunnelPort,
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
      serviceName: 'nodehubsapi-agent',
      runtimeServiceName: 'nodehubsapi-runtime',
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
    if (!parsed || parsed.schema !== 'nodehubsapi-release-v2') return null
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
  // v2ray format: base64 encoded share links (compatible with v2rayN, v2rayNG, etc.)
  if (format === 'v2ray') {
    return {
      body: encodeBase64(plain),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  // clash format: YAML proxy config
  if (format === 'clash') {
    const proxies = payload.entries.map((entry) => {
      const proxy: Record<string, unknown> = {
        name: entry.label,
        server: entry.server,
        port: entry.port,
      }
      if (entry.protocol === 'vless') {
        proxy.type = 'vless'
        proxy.uuid = '' // requires parsing from URI
        proxy.network = entry.transport
        proxy.tls = entry.tlsMode !== 'none'
      } else if (entry.protocol === 'vmess') {
        proxy.type = 'vmess'
        proxy.uuid = ''
        proxy.alterId = 0
        proxy.cipher = 'auto'
        proxy.network = entry.transport
        proxy.tls = entry.tlsMode !== 'none'
      } else if (entry.protocol === 'trojan') {
        proxy.type = 'trojan'
        proxy.password = ''
        proxy.network = entry.transport
      } else if (entry.protocol === 'shadowsocks') {
        proxy.type = 'ss'
        proxy.cipher = 'aes-128-gcm'
        proxy.password = ''
      } else if (entry.protocol === 'hysteria2') {
        proxy.type = 'hysteria2'
        proxy.password = ''
      }
      return proxy
    })
    const clashConfig = {
      proxies,
      'proxy-groups': [
        {
          name: 'NodeHub',
          type: 'select',
          proxies: payload.entries.map((e) => e.label),
        },
      ],
    }
    // Simple YAML serialization
    let yaml = 'proxies:\n'
    for (const p of proxies) {
      yaml += `  - ${JSON.stringify(p)}\n`
    }
    yaml += 'proxy-groups:\n'
    yaml += `  - ${JSON.stringify(clashConfig['proxy-groups'][0])}\n`
    return {
      body: yaml,
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  // singbox format: JSON outbound config
  if (format === 'singbox') {
    const outbounds = payload.entries.map((entry) => ({
      tag: entry.label,
      type: entry.protocol,
      server: entry.server,
      server_port: entry.port,
    }))
    const singboxConfig = {
      outbounds: [
        ...outbounds,
        { type: 'direct', tag: 'direct' },
        { type: 'block', tag: 'block' },
      ],
    }
    return {
      body: JSON.stringify(singboxConfig, null, 2),
      contentType: 'application/json; charset=utf-8',
    }
  }
  // default: base64
  return {
    body: encodeBase64(plain),
    contentType: 'text/plain; charset=utf-8',
  }
}
