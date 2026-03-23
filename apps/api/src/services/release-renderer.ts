import { DEFAULT_WARP_LOCAL_PROXY_PORT } from '@contracts/index'
import type {
  NodeRecord,
  PublicSubscriptionDocument,
  ReleaseArtifact,
  ReleaseKind,
  SubscriptionDocumentFormat,
  SubscriptionEndpoint,
  TemplatePreset,
  TemplateRecord,
} from '@contracts/index'
import { readNumber, readString, readStringArray } from '../lib/utils'
import {
  DEFAULT_REALITY_FINGERPRINT,
  DEFAULT_REALITY_FLOW,
  DEFAULT_WIREGUARD_CLIENT_ADDRESS,
  DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS,
  DEFAULT_WIREGUARD_DNS,
  DEFAULT_WIREGUARD_MTU,
  DEFAULT_WIREGUARD_PORT,
  DEFAULT_WIREGUARD_SERVER_ADDRESS,
} from './template-constants'
import { hydrateTemplatePreset, repairTemplateRecord } from './template-defaults'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

type RenderContext = {
  releaseId: string
  revision: number
  kind: ReleaseKind
  configRevision: number
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
  fingerprint: string
  alterId: number
  upMbps: number
  downMbps: number
  realityPrivateKey: string
  realityPublicKey: string
  realityShortId: string
  certPath: string
  keyPath: string
  wireguardServerPrivateKey: string
  wireguardServerPublicKey: string
  wireguardClientPrivateKey: string
  wireguardClientPublicKey: string
  wireguardPresharedKey: string
  wireguardServerAddress: string
  wireguardClientAddress: string
  wireguardPeerAllowedIps: string[]
  wireguardClientAllowedIps: string[]
  wireguardDns: string[]
  wireguardMtu: number
  wireguardPersistentKeepalive: number
  defaults: Record<string, unknown>
}

const SUPPORTED_PROTOCOLS = new Set(['vless', 'trojan', 'shadowsocks', 'vmess', 'hysteria2', 'wireguard'])
const SUPPORTED_TRANSPORTS = new Set(['ws', 'grpc', 'tcp', 'hysteria2', 'xhttp', 'wireguard'])
const WARP_LOCAL_PROXY_HOST = '127.0.0.1'

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
      sni: '',
      fingerprint: 'chrome',
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
  {
    id: 'preset-wireguard',
    name: 'WireGuard',
    engine: 'xray',
    protocol: 'wireguard',
    transport: 'wireguard',
    tlsMode: 'none',
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: DEFAULT_WIREGUARD_PORT,
      serverAddress: DEFAULT_WIREGUARD_SERVER_ADDRESS,
      clientAddress: DEFAULT_WIREGUARD_CLIENT_ADDRESS,
      peerAllowedIps: [DEFAULT_WIREGUARD_CLIENT_ADDRESS],
      clientAllowedIps: DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS,
      dns: DEFAULT_WIREGUARD_DNS,
      mtu: DEFAULT_WIREGUARD_MTU,
      serverPrivateKey: '',
      serverPublicKey: '',
      clientPrivateKey: '',
      clientPublicKey: '',
      presharedKey: '',
    },
    notes: 'WireGuard UDP tunnel，默认客户端全局路由到隧道并下发公共 DNS。Xray v1.8.6+ 原生支持 WireGuard inbound，也兼容 sing-box endpoints。',
  },
]



function normalizePath(value: string): string {
  if (!value) return '/'
  return value.startsWith('/') ? value : `/${value}`
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

function resolveWarpRouteCidrs(mode: TemplateRecord['warpRouteMode']): string[] {
  if (mode === 'ipv4') return ['0.0.0.0/0']
  if (mode === 'ipv6') return ['::/0']
  return ['0.0.0.0/0', '::/0']
}

function resolveXrayWarpTargetStrategy(mode: TemplateRecord['warpRouteMode']): 'AsIs' | 'ForceIPv4' | 'ForceIPv6' {
  if (mode === 'ipv4') return 'ForceIPv4'
  if (mode === 'ipv6') return 'ForceIPv6'
  return 'AsIs'
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

type ResolvedWarpRoute = {
  routeMode: TemplateRecord['warpRouteMode']
  ipCidrs: string[]
  proxyHost: string
  proxyPort: number
}

function resolveWarpRoute(templates: NormalizedTemplate[]): ResolvedWarpRoute | null {
  const primaryTemplate = templates.find((template) => template.warpExit)
  if (!primaryTemplate) return null
  return {
    routeMode: primaryTemplate.warpRouteMode,
    ipCidrs: resolveWarpRouteCidrs(primaryTemplate.warpRouteMode),
    proxyHost: WARP_LOCAL_PROXY_HOST,
    proxyPort: DEFAULT_WARP_LOCAL_PROXY_PORT,
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

  if (protocol === 'wireguard') {
    if (transport !== 'wireguard') {
      throw new Error(`Template ${template.name} must use the wireguard transport`)
    }
    if (template.tlsMode !== 'none') {
      throw new Error(`Template ${template.name} must disable TLS for wireguard`)
    }
  }

  if (transport === 'hysteria2' && protocol !== 'hysteria2') {
    throw new Error(`Template ${template.name} can only use the hysteria2 transport with the hysteria2 protocol`)
  }

  if (transport === 'wireguard' && protocol !== 'wireguard') {
    throw new Error(`Template ${template.name} can only use the wireguard transport with the wireguard protocol`)
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

export function assertTemplateRuntimeSupport(
  template: Pick<TemplateRecord, 'name' | 'engine' | 'protocol' | 'transport' | 'tlsMode'>,
): void {
  ensureProtocolSupport(template as TemplateRecord)
  ensureTemplateCompatibility(template as TemplateRecord)
}

function defaultPort(template: TemplateRecord): number {
  if (template.protocol.trim().toLowerCase() === 'wireguard') return DEFAULT_WIREGUARD_PORT
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
    return node.argoDomain || node.argoTunnelDomain || node.primaryDomain || node.backupDomain || node.entryIp
  }
  return node.primaryDomain || node.entryIp || node.backupDomain || node.argoTunnelDomain
}

function defaultTemplateHost(node: NodeRecord, server: string): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoDomain || node.argoTunnelDomain || node.primaryDomain || server
  }
  return node.primaryDomain || node.backupDomain || server
}

function defaultTemplateSni(node: NodeRecord, server: string): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoDomain || node.argoTunnelDomain || node.primaryDomain || server
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
  if (protocol === 'wireguard' && node.networkType === 'noPublicIp') {
    throw new Error(`Template ${repairedTemplate.name} requires a public IP node for wireguard`)
  }
  const warpExit = repairedTemplate.warpExit === true || readBoolean(defaults.warp_exit, false)
  const warpRouteModeRaw = readString(defaults, 'warp_route_mode', repairedTemplate.warpRouteMode || 'all')
  const warpRouteMode: TemplateRecord['warpRouteMode'] = warpRouteModeRaw === 'ipv4' || warpRouteModeRaw === 'ipv6' ? warpRouteModeRaw : 'all'
  const templateListenPort = readNumber(defaults, ['serverPort', 'port'], defaultPort(repairedTemplate))
  const listenPort = node.networkType === 'noPublicIp'
    ? Number(node.argoTunnelPort || 2053)
    : templateListenPort
  const host = readString(defaults, 'host', defaultTemplateHost(node, server))
  const sni = readString(defaults, 'sni', defaultTemplateSni(node, host || server))
  const wireguardServerPrivateKey = readString(defaults, 'serverPrivateKey')
  const wireguardServerPublicKey = readString(defaults, 'serverPublicKey')
  const wireguardClientPrivateKey = readString(defaults, 'clientPrivateKey')
  const wireguardClientPublicKey = readString(defaults, 'clientPublicKey')
  const wireguardPresharedKey = readString(defaults, 'presharedKey')
  const wireguardServerAddress = readString(defaults, 'serverAddress', DEFAULT_WIREGUARD_SERVER_ADDRESS)
  const wireguardClientAddress = readString(defaults, 'clientAddress', DEFAULT_WIREGUARD_CLIENT_ADDRESS)
  const wireguardPeerAllowedIps = readStringArray(defaults, 'peerAllowedIps', wireguardClientAddress ? [wireguardClientAddress] : [])
  const wireguardClientAllowedIps = readStringArray(defaults, 'clientAllowedIps', DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS)
  const wireguardDns = readStringArray(defaults, 'dns', DEFAULT_WIREGUARD_DNS)
  const wireguardMtu = readNumber(defaults, ['mtu'], DEFAULT_WIREGUARD_MTU)
  const wireguardPersistentKeepalive = readNumber(defaults, ['persistentKeepalive'], 0)
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
    flow: readString(defaults, 'flow', tlsMode === 'reality' ? DEFAULT_REALITY_FLOW : ''),
    fingerprint: readString(defaults, 'fingerprint', tlsMode === 'reality' ? DEFAULT_REALITY_FINGERPRINT : ''),
    alterId: readNumber(defaults, ['alterId'], 0),
    upMbps: readNumber(defaults, ['upMbps'], 100),
    downMbps: readNumber(defaults, ['downMbps'], 100),
    realityPrivateKey: readString(defaults, 'realityPrivateKey'),
    realityPublicKey: readString(defaults, 'realityPublicKey'),
    realityShortId: readString(defaults, 'realityShortId'),
    certPath: readString(defaults, 'certPath', '/etc/nodehubsapi/certs/server.crt'),
    keyPath: readString(defaults, 'keyPath', '/etc/nodehubsapi/certs/server.key'),
    wireguardServerPrivateKey,
    wireguardServerPublicKey,
    wireguardClientPrivateKey,
    wireguardClientPublicKey,
    wireguardPresharedKey,
    wireguardServerAddress,
    wireguardClientAddress,
    wireguardPeerAllowedIps,
    wireguardClientAllowedIps,
    wireguardDns,
    wireguardMtu: wireguardMtu > 0 ? wireguardMtu : DEFAULT_WIREGUARD_MTU,
    wireguardPersistentKeepalive: wireguardPersistentKeepalive > 0 ? wireguardPersistentKeepalive : 0,
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
  if (protocol === 'wireguard') {
    normalized.wireguardServerPrivateKey = ensureField(normalized.wireguardServerPrivateKey, 'serverPrivateKey', template.name)
    normalized.wireguardServerPublicKey = ensureField(normalized.wireguardServerPublicKey, 'serverPublicKey', template.name)
    normalized.wireguardClientPrivateKey = ensureField(normalized.wireguardClientPrivateKey, 'clientPrivateKey', template.name)
    normalized.wireguardClientPublicKey = ensureField(normalized.wireguardClientPublicKey, 'clientPublicKey', template.name)
    normalized.wireguardServerAddress = ensureField(normalized.wireguardServerAddress, 'serverAddress', template.name)
    normalized.wireguardClientAddress = ensureField(normalized.wireguardClientAddress, 'clientAddress', template.name)
    if (normalized.wireguardPeerAllowedIps.length === 0) {
      normalized.wireguardPeerAllowedIps = [normalized.wireguardClientAddress]
    }
    if (normalized.wireguardClientAllowedIps.length === 0) {
      normalized.wireguardClientAllowedIps = DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS
    }
  }
  if (tlsMode === 'reality') {
    normalized.realityPublicKey = ensureField(normalized.realityPublicKey, 'realityPublicKey', template.name)
    normalized.realityPrivateKey = ensureField(normalized.realityPrivateKey, 'realityPrivateKey', template.name)
    normalized.realityShortId = ensureField(normalized.realityShortId, 'realityShortId', template.name)
    normalized.sni = ensureField(normalized.sni, 'sni', template.name)
    normalized.flow = normalized.flow || DEFAULT_REALITY_FLOW
    normalized.fingerprint = normalized.fingerprint || DEFAULT_REALITY_FINGERPRINT
  }

  return normalized
}

function shouldIgnoreNodeInboundTls(node: NodeRecord, template: NormalizedTemplate): boolean {
  return node.networkType === 'noPublicIp' && template.tlsMode === 'tls'
}

function buildSingBoxInbound(node: NodeRecord, template: NormalizedTemplate, index: number) {
  if (template.protocol === 'wireguard') {
    throw new Error(`Template ${template.name} must be rendered as a wireguard endpoint`)
  }
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
        alterId: template.alterId,
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
    inbound.up_mbps = template.upMbps
    inbound.down_mbps = template.downMbps
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

  const ignoreTls = shouldIgnoreNodeInboundTls(node, template)

  if (template.protocol === 'hysteria2') {
    inbound.tls = {
      enabled: true,
      server_name: template.sni || template.server,
      certificate_path: template.certPath,
      key_path: template.keyPath,
    }
  } else if (template.tlsMode === 'tls' && !ignoreTls) {
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

function buildSingBoxEndpoint(template: NormalizedTemplate, index: number) {
  const endpoint: Record<string, unknown> = {
    type: 'wireguard',
    tag: `in-${index + 1}`,
    address: [template.wireguardServerAddress],
    private_key: template.wireguardServerPrivateKey,
    listen_port: template.listenPort,
    peers: [
      {
        public_key: template.wireguardClientPublicKey,
        allowed_ips: template.wireguardPeerAllowedIps,
        ...(template.wireguardPresharedKey ? { pre_shared_key: template.wireguardPresharedKey } : {}),
        ...(template.wireguardPersistentKeepalive > 0
          ? { persistent_keepalive_interval: template.wireguardPersistentKeepalive }
          : {}),
      },
    ],
  }

  if (template.wireguardMtu > 0) {
    endpoint.mtu = template.wireguardMtu
  }

  return endpoint
}

function buildXrayInbound(node: NodeRecord, template: NormalizedTemplate, index: number) {
  if (template.protocol === 'hysteria2') {
    throw new Error(`Template ${template.name} cannot be rendered with the xray engine`)
  }
  if (template.protocol === 'wireguard') {
    // Xray v1.8.6+ supports native WireGuard inbound
    const inbound: Record<string, unknown> = {
      tag: `in-${index + 1}`,
      port: template.listenPort,
      listen: '0.0.0.0',
      protocol: 'wireguard',
      settings: {
        secretKey: template.wireguardServerPrivateKey,
        peers: [
          {
            publicKey: template.wireguardClientPublicKey,
            allowedIPs: template.wireguardPeerAllowedIps,
          },
        ],
        mtu: template.wireguardMtu > 0 ? template.wireguardMtu : DEFAULT_WIREGUARD_MTU,
      },
    }
    return inbound
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
          alterId: template.alterId,
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
  const ignoreTls = shouldIgnoreNodeInboundTls(node, template)

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

  if (template.tlsMode === 'tls' && !ignoreTls) {
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
    host: template.host || undefined,
    sni: template.sni || undefined,
    path: template.path || undefined,
    serviceName: template.serviceName || undefined,
    uuid: template.uuid || undefined,
    password: template.password || undefined,
    method: template.method || undefined,
    flow: template.flow || undefined,
    fingerprint: template.fingerprint || undefined,
    alterId: template.alterId,
    realityPublicKey: template.realityPublicKey || undefined,
    realityShortId: template.realityShortId || undefined,
    upMbps: template.protocol === 'hysteria2' ? template.upMbps : undefined,
    downMbps: template.protocol === 'hysteria2' ? template.downMbps : undefined,
    wireguard: template.protocol === 'wireguard'
      ? {
          privateKey: template.wireguardClientPrivateKey,
          publicKey: template.wireguardClientPublicKey || undefined,
          peerPublicKey: template.wireguardServerPublicKey,
          preSharedKey: template.wireguardPresharedKey || undefined,
          address: template.wireguardClientAddress,
          allowedIps: template.wireguardClientAllowedIps,
          dns: template.wireguardDns.length > 0 ? template.wireguardDns : undefined,
          mtu: template.wireguardMtu > 0 ? template.wireguardMtu : undefined,
          persistentKeepalive: template.wireguardPersistentKeepalive > 0 ? template.wireguardPersistentKeepalive : undefined,
        }
      : undefined,
  }
}

function buildSubscriptionUriFromEntry(entry: ResolvedSubscriptionEntry): string {
  if (entry.protocol === 'wireguard') {
    return ''
  }
  const label = encodeURIComponentSafe(entry.label)
  const params = new URLSearchParams()
  params.set('type', entry.transport)
  if (entry.protocol === 'vless') {
    params.set('encryption', 'none')
    if (entry.flow) params.set('flow', entry.flow)
  }
  if (entry.transport === 'ws' || entry.transport === 'xhttp') {
    params.set('path', entry.path)
    if (entry.host) params.set('host', entry.host)
  }
  if (entry.transport === 'grpc') {
    params.set('serviceName', entry.serviceName)
  }
  if (entry.tlsMode === 'tls' || entry.protocol === 'hysteria2') {
    params.set('security', 'tls')
    if (entry.sni) params.set('sni', entry.sni)
  } else if (entry.tlsMode === 'reality') {
    params.set('security', 'reality')
    params.set('sni', entry.sni)
    params.set('pbk', entry.realityPublicKey)
    params.set('sid', entry.realityShortId)
    params.set('fp', entry.fingerprint || DEFAULT_REALITY_FINGERPRINT)
  } else {
    params.set('security', 'none')
  }

  if (entry.protocol === 'vless') {
    return `vless://${entry.uuid}@${entry.server}:${entry.port}?${params.toString()}#${label}`
  }
  if (entry.protocol === 'vmess') {
    const vmessConfig = {
      v: '2',
      ps: entry.label,
      add: entry.server,
      port: String(entry.port),
      id: entry.uuid,
      aid: String(entry.alterId),
      net: entry.transport,
      type: 'none',
      host: entry.host || '',
      path: entry.path || '',
      tls: entry.tlsMode === 'tls' ? 'tls' : '',
      sni: entry.sni || '',
    }
    return `vmess://${btoa(JSON.stringify(vmessConfig))}`
  }
  if (entry.protocol === 'trojan') {
    return `trojan://${entry.password}@${entry.server}:${entry.port}?${params.toString()}#${label}`
  }
  if (entry.protocol === 'hysteria2') {
    return `hysteria2://${entry.password}@${entry.server}:${entry.port}?${params.toString()}#${label}`
  }
  const credentials = btoa(`${entry.method}:${entry.password}`)
  return `ss://${credentials}@${entry.server}:${entry.port}#${label}`
}

export function buildSubscriptionEntries(node: NodeRecord, templates: TemplateRecord[]): SubscriptionEndpoint[] {
  return templates.map((template) => buildSubscriptionEntry(node, normalizeTemplate(node, template)))
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

    const warp = resolveWarpRoute(templates)
    if (warp) {
      const inboundTags = resolveInboundTagsByWarp(templates)
      const rules = routing.rules as Array<Record<string, unknown>>

      outbounds.push({
        tag: 'warp-out',
        protocol: 'socks',
        targetStrategy: resolveXrayWarpTargetStrategy(warp.routeMode),
        settings: {
          address: warp.proxyHost,
          port: warp.proxyPort,
        },
      })
      if (inboundTags.warpTags.length > 0) {
        rules.push({
          type: 'field',
          inboundTag: inboundTags.warpTags,
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
      inbounds: templates.map((template, index) => buildXrayInbound(node, template, index)),
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
  const inbounds: Array<Record<string, unknown>> = []
  const endpoints: Array<Record<string, unknown>> = []
  templates.forEach((template, index) => {
    if (template.protocol === 'wireguard') {
      endpoints.push(buildSingBoxEndpoint(template, index))
    } else {
      inbounds.push(buildSingBoxInbound(node, template, index))
    }
  })
  const warp = resolveWarpRoute(templates)
  if (warp) {
    const inboundTags = resolveInboundTagsByWarp(templates)
    const rules: Array<Record<string, unknown>> = []

    outbounds.push({
      type: 'socks',
      tag: 'warp-out',
      server: warp.proxyHost,
      server_port: warp.proxyPort,
      version: '5',
    })
    if (inboundTags.warpTags.length > 0) {
      rules.push({
        inbound: inboundTags.warpTags,
        outbound: 'warp-out',
        ...(warp.routeMode === 'all' ? {} : { ip_cidr: warp.ipCidrs }),
      })
    } else if (warp.routeMode !== 'all') {
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
    inbounds,
    ...(endpoints.length > 0 ? { endpoints } : {}),
    outbounds,
    route,
  }
}

export function listTemplatePresets(): TemplatePreset[] {
  return TEMPLATE_PRESETS.map((item) => hydrateTemplatePreset(item))
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

export function renderReleaseArtifact(context: RenderContext): ReleaseArtifact {
  const runtimeTemplates = context.templates
  const normalizedTemplates = runtimeTemplates.map((template) => normalizeTemplate(context.node, template))
  const groupedTemplates = groupTemplatesByEngine(normalizedTemplates)
  const runtimes = (Object.keys(groupedTemplates) as Array<TemplateRecord['engine']>)
    .filter((engine) => groupedTemplates[engine].length > 0)
    .map((engine) => {
      const runtimeConfig = buildRuntimeConfig(engine, groupedTemplates[engine], context.node)
      const entryConfigPath = `runtime/${engine}.json`
      return {
        engine,
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
    templates: runtimeTemplates.map((template) => ({
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

function decodeBase64(value: string): string {
  try {
    const binary = atob(value.replace(/\s+/g, ''))
    const bytes = Uint8Array.from(binary, (item) => item.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function splitUniqueLines(value: string): string[] {
  return Array.from(new Set(
    String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function mergeUniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

function readShareLinkLines(format: SubscriptionDocumentFormat, body: string): string[] {
  if (format === 'plain') return splitUniqueLines(body)
  if (format === 'base64' || format === 'v2ray') return splitUniqueLines(decodeBase64(body))
  return []
}

function parseJsonDocument(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function parseClashDocument(body: string): Record<string, unknown> | null {
  try {
    const parsed = parseYaml(body) as Record<string, unknown> | null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function mergeClashGroups(groups: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()
  for (const group of groups) {
    const name = String(group.name || '').trim() || JSON.stringify(group)
    if (!merged.has(name)) {
      merged.set(name, { ...group })
      continue
    }
    const current = merged.get(name)!
    const nextProxies = mergeUniqueByKey(
      [
        ...((Array.isArray(current.proxies) ? current.proxies : []) as unknown[]),
        ...((Array.isArray(group.proxies) ? group.proxies : []) as unknown[]),
      ],
      (item) => String(item),
    )
    merged.set(name, {
      ...current,
      ...group,
      proxies: nextProxies,
    })
  }
  return Array.from(merged.values())
}

function mergeClashBodies(localBody: string, upstreamBodies: string[]): string {
  const documents = [localBody, ...upstreamBodies]
    .map(parseClashDocument)
    .filter((item): item is Record<string, unknown> => Boolean(item))
  if (documents.length === 0) return localBody
  const base = { ...documents[0] }
  const proxies = mergeUniqueByKey(
    documents.flatMap((doc) => (Array.isArray(doc.proxies) ? doc.proxies : []) as Array<Record<string, unknown>>),
    (item) => String(item.name || JSON.stringify(item)),
  )
  const groups = mergeClashGroups(
    documents.flatMap((doc) => (Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : []) as Array<Record<string, unknown>>),
  )
  const rules = mergeUniqueByKey(
    documents.flatMap((doc) => (Array.isArray(doc.rules) ? doc.rules : []) as string[]),
    (item) => String(item),
  )
  return stringifyYaml({
    ...base,
    proxies,
    'proxy-groups': groups,
    rules,
  })
}

function mergeSingboxBodies(localBody: string, upstreamBodies: string[]): string {
  const documents = [localBody, ...upstreamBodies]
    .map(parseJsonDocument)
    .filter((item): item is Record<string, unknown> => Boolean(item))
  if (documents.length === 0) return localBody
  const base = { ...documents[0] }
  const endpoints = mergeUniqueByKey(
    documents.flatMap((doc) => (Array.isArray(doc.endpoints) ? doc.endpoints : []) as Array<Record<string, unknown>>),
    (item) => String(item.tag || JSON.stringify(item)),
  )
  const outbounds = mergeUniqueByKey(
    documents.flatMap((doc) => (Array.isArray(doc.outbounds) ? doc.outbounds : []) as Array<Record<string, unknown>>),
    (item) => String(item.tag || JSON.stringify(item)),
  )
  const dnsServers = mergeUniqueByKey(
    documents.flatMap((doc) => {
      const dns = doc.dns
      if (!dns || typeof dns !== 'object') return []
      return (Array.isArray((dns as { servers?: unknown[] }).servers) ? (dns as { servers?: unknown[] }).servers : []) as Array<Record<string, unknown>>
    }),
    (item) => String(item.tag || item.server || JSON.stringify(item)),
  )
  const nextDns = dnsServers.length > 0
    ? {
        ...(base.dns && typeof base.dns === 'object' ? (base.dns as Record<string, unknown>) : {}),
        servers: dnsServers,
      }
    : base.dns
  const result: Record<string, unknown> = {
    ...base,
    outbounds,
  }
  if (endpoints.length > 0) result.endpoints = endpoints
  if (nextDns) result.dns = nextDns
  return JSON.stringify(result, null, 2)
}

function mergeJsonBodies(localBody: string, upstreamBodies: string[]): string {
  const localDocument = parseJsonDocument(localBody)
  if (!localDocument) return localBody
  const localEntries = Array.isArray(localDocument.entries) ? localDocument.entries : []
  const upstreamEntries = upstreamBodies.flatMap((body) => {
    const parsed = parseJsonDocument(body)
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  })
  return JSON.stringify({
    ...localDocument,
    entries: [...localEntries, ...upstreamEntries],
  }, null, 2)
}

function mergeWireguardBodies(localBody: string, upstreamBodies: string[]): string {
  const blocks = mergeUniqueByKey(
    [localBody, ...upstreamBodies]
      .map((body) => String(body || '').trim())
      .filter(Boolean),
    (item) => item,
  )
  return blocks.join('\n\n')
}

export function mergeRenderedSubscriptionDocument(
  localDocument: { body: string; contentType: string },
  upstreamDocuments: Array<{ format: SubscriptionDocumentFormat; body: string }>,
  format: SubscriptionDocumentFormat,
): { body: string; contentType: string } {
  if (upstreamDocuments.length === 0) return localDocument

  if (format === 'plain' || format === 'base64' || format === 'v2ray') {
    const mergedLines = mergeUniqueByKey(
      [
        ...readShareLinkLines(format, localDocument.body),
        ...upstreamDocuments.flatMap((document) => readShareLinkLines(document.format, document.body)),
      ],
      (item) => item,
    )
    const plain = mergedLines.join('\n')
    return {
      body: format === 'plain' ? plain : encodeBase64(plain),
      contentType: 'text/plain; charset=utf-8',
    }
  }

  if (format === 'wireguard') {
    return {
      body: mergeWireguardBodies(localDocument.body, upstreamDocuments.map((document) => document.body)),
      contentType: localDocument.contentType,
    }
  }

  if (format === 'clash') {
    return {
      body: mergeClashBodies(localDocument.body, upstreamDocuments.map((document) => document.body)),
      contentType: localDocument.contentType,
    }
  }

  if (format === 'singbox') {
    return {
      body: mergeSingboxBodies(localDocument.body, upstreamDocuments.map((document) => document.body)),
      contentType: localDocument.contentType,
    }
  }

  if (format === 'json') {
    return {
      body: mergeJsonBodies(localDocument.body, upstreamDocuments.map((document) => document.body)),
      contentType: localDocument.contentType,
    }
  }

  return localDocument
}

type ResolvedSubscriptionEntry = SubscriptionEndpoint & {
  host: string
  sni: string
  path: string
  serviceName: string
  uuid: string
  password: string
  method: string
  flow: string
  fingerprint: string
  alterId: number
  realityPublicKey: string
  realityShortId: string
  upMbps: number
  downMbps: number
  wireguard?: {
    privateKey: string
    publicKey: string
    peerPublicKey: string
    preSharedKey: string
    address: string
    allowedIps: string[]
    dns: string[]
    mtu: number
    persistentKeepalive: number
  }
}

function normalizeEntryArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean)
    return items.length > 0 ? items : fallback
  }
  if (typeof value === 'string') {
    const items = value.split(',').map((item) => item.trim()).filter(Boolean)
    return items.length > 0 ? items : fallback
  }
  return fallback
}

function resolveSubscriptionEntry(entry: SubscriptionEndpoint): ResolvedSubscriptionEntry {
  const protocol = String(entry.protocol || '').trim().toLowerCase()
  const transport = String(entry.transport || 'tcp').trim().toLowerCase() || 'tcp'
  const server = String(entry.server || '').trim()
  const host = String(entry.host || '').trim()
  const path = String(entry.path || '').trim()
  const resolvedHost = host || ((transport === 'ws' || transport === 'xhttp') ? server : '')
  const tlsMode = (entry.tlsMode || 'none') as ResolvedSubscriptionEntry['tlsMode']
  const sni = String(entry.sni || '').trim() || ((tlsMode !== 'none' || protocol === 'hysteria2') ? (resolvedHost || server) : '')
  const serviceName = String(entry.serviceName || '').trim() || (transport === 'grpc' ? 'grpc' : '')
  const flow = String(entry.flow || '').trim() || (tlsMode === 'reality' && protocol === 'vless' ? DEFAULT_REALITY_FLOW : '')
  const fingerprint = String(entry.fingerprint || '').trim() || (tlsMode === 'reality' ? DEFAULT_REALITY_FINGERPRINT : '')
  const wireguard = entry.wireguard
    ? {
        privateKey: String(entry.wireguard.privateKey || '').trim(),
        publicKey: String(entry.wireguard.publicKey || '').trim(),
        peerPublicKey: String(entry.wireguard.peerPublicKey || '').trim(),
        preSharedKey: String(entry.wireguard.preSharedKey || '').trim(),
        address: String(entry.wireguard.address || '').trim(),
        allowedIps: normalizeEntryArray(entry.wireguard.allowedIps, DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS),
        dns: normalizeEntryArray(entry.wireguard.dns, []),
        mtu: Number(entry.wireguard.mtu || 0),
        persistentKeepalive: Number(entry.wireguard.persistentKeepalive || 0),
      }
    : undefined

  return {
    ...entry,
    protocol,
    transport,
    tlsMode,
    server,
    port: Number(entry.port || 0),
    host: resolvedHost,
    sni,
    path: path || ((transport === 'ws' || transport === 'xhttp') ? '/' : ''),
    serviceName,
    uuid: String(entry.uuid || '').trim(),
    password: String(entry.password || '').trim(),
    method: String(entry.method || '').trim(),
    flow,
    fingerprint,
    alterId: Number(entry.alterId ?? 0),
    realityPublicKey: String(entry.realityPublicKey || '').trim(),
    realityShortId: String(entry.realityShortId || '').trim(),
    upMbps: Number(entry.upMbps || 0),
    downMbps: Number(entry.downMbps || 0),
    wireguard,
  }
}

function buildClashProxy(entry: ResolvedSubscriptionEntry): Record<string, unknown> {
  const proxy: Record<string, unknown> = {
    name: entry.label,
    server: entry.server,
    port: entry.port,
  }

  if (entry.protocol === 'vless') {
    proxy.type = 'vless'
    proxy.uuid = entry.uuid
    proxy.cipher = 'none'
    proxy.network = entry.transport
    if (entry.flow) proxy.flow = entry.flow
  } else if (entry.protocol === 'vmess') {
    proxy.type = 'vmess'
    proxy.uuid = entry.uuid
    proxy.alterId = entry.alterId
    proxy.cipher = 'auto'
    proxy.network = entry.transport
  } else if (entry.protocol === 'trojan') {
    proxy.type = 'trojan'
    proxy.password = entry.password
    proxy.network = entry.transport
  } else if (entry.protocol === 'shadowsocks') {
    proxy.type = 'ss'
    proxy.cipher = entry.method
    proxy.password = entry.password
    proxy.udp = true
  } else if (entry.protocol === 'hysteria2') {
    proxy.type = 'hysteria2'
    proxy.password = entry.password
  }

  if (entry.protocol === 'hysteria2' || entry.tlsMode !== 'none') {
    proxy.tls = true
    proxy.servername = entry.sni || entry.server
    proxy['skip-cert-verify'] = false
  }

  if (entry.transport === 'ws') {
    proxy.network = 'ws'
    proxy['ws-opts'] = {
      path: entry.path || '/',
      headers: entry.host ? { Host: entry.host } : undefined,
    }
  } else if (entry.transport === 'xhttp') {
    proxy.network = 'http'
    proxy['http-opts'] = {
      path: [entry.path || '/'],
      headers: entry.host ? { Host: [entry.host] } : undefined,
    }
  } else if (entry.transport === 'grpc') {
    proxy.network = 'grpc'
    proxy['grpc-opts'] = {
      'grpc-service-name': entry.serviceName || 'grpc',
    }
  }

  if (entry.tlsMode === 'reality') {
    proxy['client-fingerprint'] = entry.fingerprint || DEFAULT_REALITY_FINGERPRINT
    proxy['reality-opts'] = {
      'public-key': entry.realityPublicKey,
      'short-id': entry.realityShortId,
    }
  }

  if (entry.protocol === 'hysteria2') {
    if (entry.upMbps > 0) proxy['up-mbps'] = entry.upMbps
    if (entry.downMbps > 0) proxy['down-mbps'] = entry.downMbps
  }

  return proxy
}

function buildSingboxOutbound(entry: ResolvedSubscriptionEntry): Record<string, unknown> {
  if (entry.protocol === 'wireguard') {
    throw new Error('WireGuard entries must be rendered as sing-box endpoints')
  }

  const outbound: Record<string, unknown> = {
    tag: entry.label,
    type: entry.protocol,
    server: entry.server,
    server_port: entry.port,
  }

  if (entry.protocol === 'vless') {
    outbound.uuid = entry.uuid
    if (entry.flow) outbound.flow = entry.flow
  } else if (entry.protocol === 'vmess') {
    outbound.uuid = entry.uuid
    outbound.alter_id = entry.alterId
  } else if (entry.protocol === 'trojan' || entry.protocol === 'hysteria2') {
    outbound.password = entry.password
  } else if (entry.protocol === 'shadowsocks') {
    outbound.method = entry.method
    outbound.password = entry.password
  }

  if (entry.protocol === 'hysteria2') {
    if (entry.upMbps > 0) outbound.up_mbps = entry.upMbps
    if (entry.downMbps > 0) outbound.down_mbps = entry.downMbps
  }

  if (entry.transport === 'ws') {
    outbound.transport = {
      type: 'ws',
      path: entry.path || '/',
      headers: entry.host ? { Host: entry.host } : undefined,
    }
  } else if (entry.transport === 'grpc') {
    outbound.transport = {
      type: 'grpc',
      service_name: entry.serviceName || 'grpc',
    }
  } else if (entry.transport === 'xhttp') {
    outbound.transport = {
      type: 'http',
      path: entry.path || '/',
      headers: entry.host ? { Host: entry.host } : undefined,
    }
  }

  if (entry.protocol === 'hysteria2' || entry.tlsMode !== 'none') {
    outbound.tls = {
      enabled: true,
      server_name: entry.sni || entry.server,
      insecure: false,
    }
  }

  if (entry.tlsMode === 'reality') {
    outbound.tls = {
      enabled: true,
      server_name: entry.sni || entry.server,
      insecure: false,
      utls: {
        enabled: true,
        fingerprint: entry.fingerprint || DEFAULT_REALITY_FINGERPRINT,
      },
      reality: {
        enabled: true,
        public_key: entry.realityPublicKey,
        short_id: entry.realityShortId,
      },
    }
  }

  return outbound
}

function buildSingboxEndpoint(entry: ResolvedSubscriptionEntry): Record<string, unknown> | null {
  if (entry.protocol !== 'wireguard' || !entry.wireguard) return null
  const wireguard = entry.wireguard
  const allowedIps = wireguard.allowedIps.length > 0 ? wireguard.allowedIps : DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS
  const endpoint: Record<string, unknown> = {
    type: 'wireguard',
    tag: entry.label,
    address: [wireguard.address],
    private_key: wireguard.privateKey,
    peers: [
      {
        address: entry.server,
        port: entry.port,
        public_key: wireguard.peerPublicKey,
        allowed_ips: allowedIps,
        ...(wireguard.preSharedKey ? { pre_shared_key: wireguard.preSharedKey } : {}),
        ...(wireguard.persistentKeepalive > 0
          ? { persistent_keepalive_interval: wireguard.persistentKeepalive }
          : {}),
      },
    ],
  }

  if (wireguard.mtu > 0) {
    endpoint.mtu = wireguard.mtu
  }

  return endpoint
}

function buildWireguardConfig(entry: ResolvedSubscriptionEntry): string | null {
  if (entry.protocol !== 'wireguard' || !entry.wireguard) return null
  const wg = entry.wireguard
  const lines: string[] = [
    '[Interface]',
    `PrivateKey = ${wg.privateKey}`,
    `Address = ${wg.address}`,
  ]

  if (wg.dns.length > 0) lines.push(`DNS = ${wg.dns.join(', ')}`)
  if (wg.mtu > 0) lines.push(`MTU = ${wg.mtu}`)

  lines.push('', '[Peer]', `PublicKey = ${wg.peerPublicKey}`)
  if (wg.preSharedKey) lines.push(`PresharedKey = ${wg.preSharedKey}`)
  lines.push(`Endpoint = ${entry.server}:${entry.port}`)
  const allowedIps = wg.allowedIps.length > 0 ? wg.allowedIps : DEFAULT_WIREGUARD_CLIENT_ALLOWED_IPS
  lines.push(`AllowedIPs = ${allowedIps.join(', ')}`)
  if (wg.persistentKeepalive > 0) lines.push(`PersistentKeepalive = ${wg.persistentKeepalive}`)

  return lines.join('\n')
}


function buildSingboxDnsConfig(entries: ResolvedSubscriptionEntry[]): Record<string, unknown> | null {
  const servers = Array.from(new Set(
    entries.flatMap((entry) => entry.protocol === 'wireguard' && entry.wireguard
      ? entry.wireguard.dns.filter((item) => item.trim().length > 0)
      : []),
  ))
  if (servers.length === 0) return null
  return {
    servers: servers.map((server, index) => ({
      type: 'udp',
      tag: `dns-${index + 1}`,
      server,
    })),
    final: 'dns-1',
  }
}

export function renderSubscriptionDocument(
  payload: Omit<PublicSubscriptionDocument, 'format'>,
  format: SubscriptionDocumentFormat,
): { body: string; contentType: string } {
  const resolvedEntries = payload.entries.map((entry) => resolveSubscriptionEntry(entry))
  const uriEntries = resolvedEntries.filter((entry) => entry.protocol !== 'wireguard')
  const uriEntriesWithUri = uriEntries.map((entry) => ({ ...entry, uri: buildSubscriptionUriFromEntry(entry) }))
  const jsonEntries = resolvedEntries.map((entry) => entry.protocol === 'wireguard'
    ? entry
    : { ...entry, uri: buildSubscriptionUriFromEntry(entry) })
  const plain = uriEntriesWithUri.map((item) => item.uri).filter(Boolean).join('\n')
  if (format === 'json') {
    return {
      body: JSON.stringify({ ...payload, format, entries: jsonEntries }, null, 2),
      contentType: 'application/json; charset=utf-8',
    }
  }
  if (format === 'plain') {
    return {
      body: plain,
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'wireguard') {
    const configs = resolvedEntries
      .filter((entry) => entry.protocol === 'wireguard')
      .map((entry) => {
        const config = buildWireguardConfig(entry)
        return config ? `# ${entry.label}\n${config}` : ''
      })
      .filter(Boolean)
    return {
      body: configs.join('\n\n'),
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
    const proxies = uriEntries.map(buildClashProxy)
    const clashConfig = {
      proxies,
      'proxy-groups': [
        {
          name: 'NodeHub',
          type: 'select',
          proxies: uriEntries.map((entry) => entry.label),
        },
      ],
      rules: ['MATCH,NodeHub'],
    }
    let yaml = 'proxies:\n'
    for (const p of proxies) {
      yaml += `  - ${JSON.stringify(p)}\n`
    }
    yaml += 'proxy-groups:\n'
    yaml += `  - ${JSON.stringify(clashConfig['proxy-groups'][0])}\n`
    yaml += 'rules:\n'
    yaml += '  - MATCH,NodeHub\n'
    return {
      body: yaml,
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  // singbox format: JSON outbound config
  if (format === 'singbox') {
    const endpoints = resolvedEntries.map(buildSingboxEndpoint).filter((item): item is Record<string, unknown> => Boolean(item))
    const outbounds = resolvedEntries
      .filter((entry) => entry.protocol !== 'wireguard')
      .map(buildSingboxOutbound)
    const dns = buildSingboxDnsConfig(resolvedEntries)
    const singboxConfig = {
      ...(dns ? { dns } : {}),
      ...(endpoints.length > 0 ? { endpoints } : {}),
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
