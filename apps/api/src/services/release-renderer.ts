import type {
  BootstrapOptions,
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
import { hydrateTemplatePreset, repairTemplateRecord } from './template-defaults'

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
  bootstrapOptions: BootstrapOptions
}

type NormalizedTemplate = {
  id: string
  name: string
  engine: TemplateRecord['engine']
  protocol: string
  transport: string
  tlsMode: TemplateRecord['tlsMode']
  warpExit: boolean
  warpRouteMode: TemplateRecord['warpRouteMode']
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
const DEFAULT_WARP_SERVER = 'engage.cloudflareclient.com'
const DEFAULT_WARP_SERVER_PORT = 2408
const DEFAULT_WARP_PEER_PUBLIC_KEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='
const DEFAULT_WARP_LOCAL_ADDRESS_IPV4 = '172.16.0.2/32'
const DEFAULT_WARP_LOCAL_ADDRESS_IPV6 = '2606:4700:110:8d8d:1845:c39f:2dd5:a03a/128'

const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'preset-hysteria2',
    name: 'Hysteria2',
    engine: 'sing-box',
    protocol: 'hysteria2',
    transport: 'hysteria2',
    tlsMode: 'tls',
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23485,
      password: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23486,
      method: '2022-blake3-aes-128-gcm',
      password: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23491,
      path: '/ws',
      host: '',
      sni: '',
      uuid: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23490,
      uuid: '',
      flow: 'xtls-rprx-vision',
      sni: 'www.cloudflare.com',
      realityPublicKey: '',
      realityPrivateKey: '',
      realityShortId: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23487,
      password: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23488,
      serviceName: 'grpc',
      password: '',
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
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 23489,
      path: '/ws',
      host: '',
      sni: '',
      uuid: '',
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

type ResolvedWarpRoute = {
  ipCidrs: string[]
  server: string
  serverPort: number
  localAddress: string[]
  privateKey: string
  peerPublicKey: string
  systemInterface: boolean
  mtu: number
  reserved: number[]
}

function readStringByKeys(source: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return fallback
}

function readNumberByKeys(source: Record<string, unknown>, keys: string[], fallback: number): number {
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

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function readBooleanByKeys(source: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return readBoolean(source[key], fallback)
    }
  }
  return fallback
}

function toPortNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const port = Math.trunc(parsed)
  if (port < 1 || port > 65535) return fallback
  return port
}

function normalizeV6Cidr(value: string, fallback: string): string {
  const raw = value.trim()
  if (!raw) return fallback
  return raw.includes('/') ? raw : `${raw}/128`
}

function parseHostPort(value: string, fallbackHost: string, fallbackPort: number): { host: string; port: number } {
  const raw = value.trim()
  if (!raw) return { host: fallbackHost, port: fallbackPort }

  const bracketMatch = raw.match(/^\[(.+)\]:(\d+)$/)
  if (bracketMatch) {
    return {
      host: bracketMatch[1] || fallbackHost,
      port: toPortNumber(bracketMatch[2], fallbackPort),
    }
  }

  const separator = raw.lastIndexOf(':')
  if (separator <= 0 || separator >= raw.length - 1) {
    return { host: raw, port: fallbackPort }
  }

  const host = raw.slice(0, separator)
  const portText = raw.slice(separator + 1)
  if (!host || !/^\d+$/.test(portText)) {
    return { host: raw, port: fallbackPort }
  }

  return { host, port: toPortNumber(portText, fallbackPort) }
}

function normalizeReserved(value: unknown, fallback: number[]): number[] {
  const normalizeArray = (input: unknown[]): number[] | null => {
    if (input.length !== 3) return null
    const output = input.map((item) => Number(item))
    if (!output.every((item) => Number.isFinite(item))) return null
    return output.map((item) => Math.max(0, Math.min(255, Math.trunc(item))))
  }

  if (Array.isArray(value)) {
    const normalized = normalizeArray(value)
    if (normalized) return normalized
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = normalizeArray(value.split(',').map((item) => item.trim()))
    if (normalized) return normalized
  }

  return fallback
}

function resolveWarpRouteCidrs(mode: TemplateRecord['warpRouteMode']): string[] {
  if (mode === 'ipv4') return ['0.0.0.0/0']
  if (mode === 'ipv6') return ['::/0']
  return ['0.0.0.0/0', '::/0']
}

function isIpv4Address(value: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false
  return value.split('.').every((part) => {
    const parsed = Number(part)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255
  })
}

function isIpv6Address(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:]+$/.test(value)
}

function buildSingBoxWarpEndpointBypassRule(server: string): Record<string, unknown> | null {
  if (!server) return null
  if (isIpv4Address(server)) return { ip_cidr: [`${server}/32`], outbound: 'direct' }
  if (isIpv6Address(server)) return { ip_cidr: [`${server}/128`], outbound: 'direct' }
  return { domain: [server], outbound: 'direct' }
}

function buildXrayWarpEndpointBypassRule(server: string): Record<string, unknown> | null {
  if (!server) return null
  if (isIpv4Address(server)) return { type: 'field', ip: [`${server}/32`], outboundTag: 'direct' }
  if (isIpv6Address(server)) return { type: 'field', ip: [`${server}/128`], outboundTag: 'direct' }
  return { type: 'field', domain: [`full:${server}`], outboundTag: 'direct' }
}

function resolveInboundTagsByWarp(templates: NormalizedTemplate[]): { warpTags: string[]; directTags: string[] } {
  return templates.reduce<{ warpTags: string[]; directTags: string[] }>(
    (result, template, index) => {
      const tag = `in-${index + 1}`
      if (template.warpExit) result.warpTags.push(tag)
      else result.directTags.push(tag)
      return result
    },
    {
      warpTags: [],
      directTags: [],
    },
  )
}

function resolveWarpRoute(node: NodeRecord, templates: NormalizedTemplate[]): ResolvedWarpRoute | null {
  const primaryTemplate = templates.find((template) => template.warpExit)
  if (!primaryTemplate) return null
  const defaults = primaryTemplate.defaults || {}

  const endpointFallback = parseHostPort(node.warpEndpoint || '', DEFAULT_WARP_SERVER, DEFAULT_WARP_SERVER_PORT)
  const fallbackReserved = normalizeReserved(node.warpReserved, [0, 0, 0])
  const nodeV6 = normalizeV6Cidr(node.warpIpv6 || '', DEFAULT_WARP_LOCAL_ADDRESS_IPV6)

  const privateKey = readStringByKeys(defaults, ['warp_private_key', 'private_key'], node.warpPrivateKey || '')
  if (!privateKey) {
    throw new Error(`Template ${primaryTemplate.name} enabled WARP exit but no WARP private key is available`)
  }

  const server = readStringByKeys(defaults, ['warp_server', 'server'], endpointFallback.host || DEFAULT_WARP_SERVER)
  const serverPort = toPortNumber(
    readNumberByKeys(defaults, ['warp_server_port', 'server_port'], endpointFallback.port || DEFAULT_WARP_SERVER_PORT),
    endpointFallback.port || DEFAULT_WARP_SERVER_PORT,
  )
  const peerPublicKey = readStringByKeys(defaults, ['warp_peer_public_key', 'peer_public_key'], DEFAULT_WARP_PEER_PUBLIC_KEY)
  const systemInterface = readBooleanByKeys(defaults, ['warp_system_interface', 'system_interface'], false)
  const mtu = Math.max(576, Math.min(65535, Math.trunc(readNumberByKeys(defaults, ['warp_mtu', 'mtu'], 1280))))
  const reserved = normalizeReserved(defaults.warp_reserved, fallbackReserved)

  const localAddressV4 = readStringByKeys(defaults, ['warp_local_address_ipv4', 'local_address_ipv4'], DEFAULT_WARP_LOCAL_ADDRESS_IPV4)
  const localAddressV6 = normalizeV6Cidr(
    readStringByKeys(defaults, ['warp_local_address_ipv6', 'local_address_ipv6'], nodeV6),
    DEFAULT_WARP_LOCAL_ADDRESS_IPV6,
  )

  return {
    ipCidrs: resolveWarpRouteCidrs(primaryTemplate.warpRouteMode),
    server,
    serverPort,
    localAddress: [localAddressV4, localAddressV6].filter(Boolean),
    privateKey,
    peerPublicKey,
    systemInterface,
    mtu,
    reserved,
  }
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

function defaultTemplateHost(node: NodeRecord, server: string): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoTunnelDomain || node.primaryDomain || server
  }
  return node.primaryDomain || node.backupDomain || server
}

function defaultTemplateSni(node: NodeRecord, server: string): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoTunnelDomain || node.primaryDomain || server
  }
  return node.primaryDomain || node.backupDomain || server
}

function normalizeTemplate(node: NodeRecord, template: TemplateRecord): NormalizedTemplate {
  const repairedTemplate = repairTemplateRecord(template)
  ensureProtocolSupport(repairedTemplate)
  ensureTemplateCompatibility(repairedTemplate)
  const defaults = repairedTemplate.defaults || {}
  const server = readString(defaults, 'server', defaultTemplateServer(node))
  if (!server) {
    throw new Error(`Node ${node.name} does not have a reachable domain or entry IP for template ${repairedTemplate.name}`)
  }

  const protocol = repairedTemplate.protocol.toLowerCase()
  const transport = repairedTemplate.transport.toLowerCase()
  const tlsMode = repairedTemplate.tlsMode
  const warpExit = repairedTemplate.warpExit === true || readBoolean(defaults.warp_exit, false)
  const warpRouteModeRaw = readString(defaults, 'warp_route_mode', repairedTemplate.warpRouteMode || 'all')
  const warpRouteMode: TemplateRecord['warpRouteMode'] = warpRouteModeRaw === 'ipv4' || warpRouteModeRaw === 'ipv6' ? warpRouteModeRaw : 'all'
  const listenPort = readNumber(defaults, ['serverPort', 'port'], defaultPort(repairedTemplate))
  const host = readString(defaults, 'host', defaultTemplateHost(node, server))
  const sni = readString(defaults, 'sni', defaultTemplateSni(node, host || server))
  const normalized: NormalizedTemplate = {
    id: repairedTemplate.id,
    name: repairedTemplate.name,
    engine: repairedTemplate.engine,
    protocol,
    transport,
    tlsMode,
    warpExit,
    warpRouteMode,
    server,
    port: node.networkType === 'noPublicIp' ? 443 : listenPort,
    listenPort,
    host,
    sni,
    path: normalizePath(readString(defaults, 'path', `/connect/${repairedTemplate.id.slice(-6)}`)),
    serviceName: readString(defaults, 'serviceName', `grpc-${repairedTemplate.id.slice(-6)}`),
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
    warpExit: template.warpExit,
    warpRouteMode: template.warpRouteMode,
    label: `${node.name} ${template.name}`,
    server: template.server,
    port: template.port,
    uri: buildSubscriptionUri(node, template),
  }
}

function buildRuntimeConfig(
  engine: TemplateRecord['engine'],
  templates: NormalizedTemplate[],
  node: NodeRecord,
): Record<string, unknown> {
  if (engine === 'xray') {
    const outbounds: Array<Record<string, unknown>> = [
      {
        protocol: 'freedom',
        tag: 'direct',
      },
    ]
    const routing: Record<string, unknown> = {
      domainStrategy: 'AsIs',
      rules: [],
    }

    const warp = resolveWarpRoute(node, templates)
    if (warp) {
      const inboundTags = resolveInboundTagsByWarp(templates)
      const rules = routing.rules as Array<Record<string, unknown>>
      const endpointBypassRule = buildXrayWarpEndpointBypassRule(warp.server)
      if (endpointBypassRule) rules.push(endpointBypassRule)

      outbounds.push({
        tag: 'x-warp-out',
        protocol: 'wireguard',
        settings: {
          secretKey: warp.privateKey,
          address: warp.localAddress,
          peers: [
            {
              publicKey: warp.peerPublicKey,
              allowedIPs: ['0.0.0.0/0', '::/0'],
              endpoint: `${warp.server}:${warp.serverPort}`,
            },
          ],
          reserved: warp.reserved,
          mtu: warp.mtu,
          kernelMode: warp.systemInterface,
        },
      })
      outbounds.push({
        tag: 'warp-out',
        protocol: 'freedom',
        settings: {
          domainStrategy: 'ForceIPv6v4',
        },
        proxySettings: {
          tag: 'x-warp-out',
        },
      })
      routing.domainStrategy = 'IPOnDemand'
      if (inboundTags.warpTags.length > 0) {
        rules.push({
          type: 'field',
          inboundTag: inboundTags.warpTags,
          ip: warp.ipCidrs,
          network: 'tcp,udp',
          outboundTag: 'warp-out',
        })
      } else {
        rules.push({
          type: 'field',
          ip: warp.ipCidrs,
          network: 'tcp,udp',
          outboundTag: 'warp-out',
        })
      }
      if (inboundTags.directTags.length > 0) {
        rules.push({
          type: 'field',
          inboundTag: inboundTags.directTags,
          outboundTag: 'direct',
        })
      }
    }

    return {
      log: {
        loglevel: 'warning',
      },
      inbounds: templates.map(buildXrayInbound),
      outbounds,
      routing,
    }
  }

  const outbounds: Array<Record<string, unknown>> = [
    {
      type: 'direct',
      tag: 'direct',
    },
  ]
  const route: Record<string, unknown> = {
    final: 'direct',
  }
  const warp = resolveWarpRoute(node, templates)
  if (warp) {
    const inboundTags = resolveInboundTagsByWarp(templates)
    const rules: Array<Record<string, unknown>> = []
    const endpointBypassRule = buildSingBoxWarpEndpointBypassRule(warp.server)
    if (endpointBypassRule) rules.push(endpointBypassRule)

    outbounds.push({
      type: 'wireguard',
      tag: 'warp-out',
      system: warp.systemInterface,
      mtu: warp.mtu,
      address: warp.localAddress,
      private_key: warp.privateKey,
      peers: [
        {
          address: warp.server,
          port: warp.serverPort,
          public_key: warp.peerPublicKey,
          allowed_ips: ['0.0.0.0/0', '::/0'],
          persistent_keepalive_interval: 30,
          reserved: warp.reserved,
        },
      ],
    })
    if (inboundTags.warpTags.length > 0) {
      rules.push({
        inbound: inboundTags.warpTags,
        ip_cidr: warp.ipCidrs,
        outbound: 'warp-out',
      })
    } else {
      rules.push({
        ip_cidr: warp.ipCidrs,
        outbound: 'warp-out',
      })
    }
    if (inboundTags.directTags.length > 0) {
      rules.push({
        inbound: inboundTags.directTags,
        outbound: 'direct',
      })
    }
    route.rules = rules
  }

  return {
    log: {
      level: 'warn',
      timestamp: true,
    },
    inbounds: templates.map(buildSingBoxInbound),
    outbounds,
    route,
  }
}

function buildBootstrapRuntimeBinaries(
  runtimeCatalog: RuntimeCatalog,
  bootstrapOptions: BootstrapOptions,
): RuntimeBinaryPlan[] {
  const plans: RuntimeBinaryPlan[] = []
  if (bootstrapOptions.installSingBox) {
    plans.push(cloneBinaryPlan(runtimeCatalog['sing-box']))
  }
  if (bootstrapOptions.installXray) {
    plans.push(cloneBinaryPlan(runtimeCatalog.xray))
  }
  return plans
}

function buildBootstrapNotes(node: NodeRecord, kind: ReleaseKind, bootstrapOptions: BootstrapOptions): string[] {
  const notes = [
    'The agent always applies files under /etc/nodehubsapi/runtime.',
    'Runtime services use engine-scoped systemd units: nodehubsapi-runtime-sing-box.service and nodehubsapi-runtime-xray.service.',
    'Deploy commands always install the agent and perform mandatory network bootstrap based on the node network type.',
  ]
  if (node.networkType === 'public') {
    notes.push('Public-IP nodes bootstrap TLS certificates during agent installation.')
  } else {
    notes.push('No-public-IP nodes bootstrap Argo during agent installation.')
  }
  const actions = [
    bootstrapOptions.installWarp ? 'WARP' : '',
    bootstrapOptions.installSingBox ? 'sing-box' : '',
    bootstrapOptions.installXray ? 'xray' : '',
  ].filter(Boolean)
  if (actions.length > 0) {
    notes.push(`Selected bootstrap actions: ${actions.join(', ')}.`)
  }
  if (bootstrapOptions.installWarp) {
    notes.push(bootstrapOptions.warpLicenseKey ? 'Bootstrap carries an inline WARP License Key.' : 'Bootstrap installs WARP without a License Key.')
  }
  notes.push(`Heartbeat interval: ${bootstrapOptions.heartbeatIntervalSeconds}s.`)
  notes.push(`Version pull interval: ${bootstrapOptions.versionPullIntervalSeconds}s.`)
  if (kind === 'bootstrap') {
    notes.push('Bootstrap revision changed. Re-run local bootstrap hooks before marking the node ready.')
  }
  return notes
}

export function listTemplatePresets(): TemplatePreset[] {
  return TEMPLATE_PRESETS.map((item) => hydrateTemplatePreset(item))
}

function cloneBinaryPlan(plan: RuntimeBinaryPlan): RuntimeBinaryPlan {
  return {
    ...plan,
  }
}

function groupTemplatesByEngine(templates: NormalizedTemplate[]): Record<TemplateRecord['engine'], NormalizedTemplate[]> {
  return templates.reduce<Record<TemplateRecord['engine'], NormalizedTemplate[]>>(
    (groups, template) => {
      if (!groups[template.engine]) groups[template.engine] = []
      groups[template.engine].push(template)
      return groups
    },
    {
      'sing-box': [],
      xray: [],
    },
  )
}

export function renderReleaseArtifact(context: RenderContext, runtimeCatalog: RuntimeCatalog): ReleaseArtifact {
  const normalizedTemplates = context.templates.map((template) => normalizeTemplate(context.node, template))
  const groupedTemplates = groupTemplatesByEngine(normalizedTemplates)
  const bootstrapRuntimeBinaries = buildBootstrapRuntimeBinaries(runtimeCatalog, context.bootstrapOptions)
  const runtimes = (Object.keys(groupedTemplates) as Array<TemplateRecord['engine']>)
    .filter((engine) => groupedTemplates[engine].length > 0)
    .map((engine) => {
      const runtimeConfig = buildRuntimeConfig(engine, groupedTemplates[engine], context.node)
      const entryConfigPath = `runtime/${engine}.json`
      return {
        engine,
        binary: cloneBinaryPlan(runtimeCatalog[engine]),
        entryConfigPath,
        files: [
          {
            path: entryConfigPath,
            contentType: 'application/json' as const,
            content: JSON.stringify(runtimeConfig, null, 2),
          },
        ],
      }
    })

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
      cfDnsToken: context.node.cfDnsToken,
      argoTunnelToken: context.node.argoTunnelToken,
      argoTunnelDomain: context.node.argoTunnelDomain,
      argoTunnelPort: context.node.argoTunnelPort,
    },
    templates: context.templates.map((template) => ({
      id: template.id,
      name: template.name,
      engine: template.engine,
      protocol: template.protocol,
      transport: template.transport,
      tlsMode: template.tlsMode,
      warpExit: template.warpExit,
      warpRouteMode: template.warpRouteMode,
      defaults: { ...template.defaults },
    })),
    runtimes,
    bootstrap: {
      serviceName: 'nodehubsapi-agent',
      runtimeServiceName: 'nodehubsapi-runtime',
      installWarp: context.bootstrapOptions.installWarp,
      warpLicenseKey: context.bootstrapOptions.warpLicenseKey,
      heartbeatIntervalSeconds: context.bootstrapOptions.heartbeatIntervalSeconds,
      versionPullIntervalSeconds: context.bootstrapOptions.versionPullIntervalSeconds,
      installSingBox: context.bootstrapOptions.installSingBox,
      installXray: context.bootstrapOptions.installXray,
      runtimeBinaries: bootstrapRuntimeBinaries,
      mode: context.kind === 'bootstrap' ? 'bootstrap-required' : 'runtime-only',
      notes: buildBootstrapNotes(context.node, context.kind, context.bootstrapOptions),
    },
    subscriptionEndpoints: normalizedTemplates.map((template) => buildSubscriptionEntry(context.node, template)),
  }
}

export function parseReleaseArtifact(payload: string): ReleaseArtifact | null {
  try {
    const parsed = JSON.parse(payload) as Partial<ReleaseArtifact> | null
    if (!parsed || parsed.schema !== 'nodehubsapi-release-v2') return null
    if (!Array.isArray(parsed.subscriptionEndpoints) || !Array.isArray(parsed.runtimes)) {
      return null
    }
    if (parsed.runtimes.some((runtime) => !runtime || !Array.isArray(runtime.files))) {
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
