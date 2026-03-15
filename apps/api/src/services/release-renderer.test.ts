import { describe, expect, it } from 'vitest'
import { DEFAULT_WARP_LOCAL_PROXY_PORT, type NodeRecord, type TemplateRecord } from '@contracts/index'
import { listTemplatePresets, parseReleaseArtifact, renderReleaseArtifact, renderSubscriptionDocument } from './release-renderer'

function createNode(): NodeRecord {
  return {
    id: 'node_1',
    name: 'Tokyo A',
    nodeType: 'vps',
    region: 'ap-northeast',
    tags: ['prod'],
    networkType: 'public',
    primaryDomain: 'edge.example.com',
    backupDomain: '',
    entryIp: '203.0.113.1',
    workerDomain: '',
    githubMirrorUrl: '',
    installWarp: false,
    warpLicenseKey: '',
    cfDnsToken: '',
    argoTunnelToken: '',
    argoTunnelDomain: '',
    argoTunnelPort: 2053,
    configRevision: 2,
    desiredReleaseRevision: 2,
    currentReleaseRevision: 1,
    currentReleaseStatus: 'healthy',
    lastSeenAt: null,
    heartbeatIntervalSeconds: 15,
    versionPullIntervalSeconds: 15,
    cpuUsagePercent: null,
    memoryUsagePercent: null,
    bytesInTotal: 0,
    bytesOutTotal: 0,
    currentConnections: 0,
    protocolRuntimeVersion: '',
    updatedAt: '2026-03-06T00:00:00.000Z',
    createdAt: '2026-03-06T00:00:00.000Z',
  }
}

function createNoPublicIpNode(): NodeRecord {
  return {
    ...createNode(),
    networkType: 'noPublicIp',
    primaryDomain: '',
    backupDomain: '',
    entryIp: '',
    argoTunnelDomain: 'tunnel.example.com',
    argoTunnelPort: 2053,
  }
}

function createTemplate(): TemplateRecord {
  return {
    id: 'tpl_1',
    name: 'VLESS edge',
    targetType: 'vps',
    engine: 'sing-box',
    protocol: 'vless',
    transport: 'ws',
    tlsMode: 'tls',
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 443,
      path: '/ws',
      host: 'cdn.example.com',
      sni: 'edge.example.com',
      uuid: '11111111-1111-4111-8111-111111111111',
    },
    notes: '',
    updatedAt: '2026-03-06T00:00:00.000Z',
    createdAt: '2026-03-06T00:00:00.000Z',
  }
}

function createWireguardTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl_wg',
    name: 'WireGuard',
    targetType: 'vps',
    engine: 'xray',
    protocol: 'wireguard',
    transport: 'wireguard',
    tlsMode: 'none',
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 51820,
      serverPrivateKey: 'server-private-key',
      serverPublicKey: 'server-public-key',
      clientPrivateKey: 'client-private-key',
      clientPublicKey: 'client-public-key',
      serverAddress: '10.66.0.1/24',
      clientAddress: '10.66.0.2/32',
      peerAllowedIps: ['10.66.0.2/32'],
      clientAllowedIps: ['0.0.0.0/0', '::/0'],
      dns: ['1.1.1.1', '8.8.8.8'],
      mtu: 1408,
      persistentKeepalive: 25,
    },
    notes: '',
    updatedAt: '2026-03-06T00:00:00.000Z',
    createdAt: '2026-03-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('release renderer', () => {
  it('renders release artifacts with runtime files and subscription entries', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_1',
      revision: 2,
      kind: 'runtime',
      configRevision: 2,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
    })

    expect(artifact.runtimes.length).toBe(1)
    expect(artifact.runtimes[0]?.engine).toBe('sing-box')
    expect(artifact.runtimes[0]?.files[0]?.path).toBe('runtime/sing-box.json')
    expect(artifact.subscriptionEndpoints[0]?.host).toBe('cdn.example.com')
    expect(artifact.subscriptionEndpoints[0]?.sni).toBe('edge.example.com')
    expect(artifact.subscriptionEndpoints[0]?.uri).toBeUndefined()
    expect(parseReleaseArtifact(JSON.stringify(artifact)))?.toMatchObject({
      schema: 'nodehubsapi-release-v2',
      releaseId: 'rel_1',
    })
  })

  it('uses the fixed argo origin port for no-public-ip nodes', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_argo_sb',
      revision: 3,
      kind: 'runtime',
      configRevision: 3,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'argo sing-box',
      summary: 'template update',
      node: createNoPublicIpNode(),
      templates: [createTemplate()],
    })

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      inbounds?: Array<Record<string, unknown>>
    }
    const inbound = runtimeConfig.inbounds?.[0]

    expect(artifact.subscriptionEndpoints[0]?.port).toBe(443)
    expect(inbound?.listen_port).toBe(2053)
    expect(inbound?.tls).toBeUndefined()
  })

  it('renders base64 and plain subscription documents', () => {
    const entry = renderReleaseArtifact({
      releaseId: 'rel_2',
      revision: 3,
      kind: 'runtime',
      configRevision: 3,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: '',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
    }).subscriptionEndpoints

    const plain = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'plain',
    )
    const base64 = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'base64',
    )

    expect(plain.body).toContain('vless://')
    expect(base64.body).not.toContain('vless://')
  })

  it('renders structured subscription documents with tls host and sni fields', () => {
    const entry = renderReleaseArtifact({
      releaseId: 'rel_3',
      revision: 4,
      kind: 'runtime',
      configRevision: 4,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: '',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
    }).subscriptionEndpoints

    const clash = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'clash',
    )
    const singbox = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'singbox',
    )

    expect(clash.body).toContain('"servername":"edge.example.com"')
    expect(clash.body).toContain('"Host":"cdn.example.com"')
    expect(singbox.body).toContain('"server_name": "edge.example.com"')
    expect(singbox.body).toContain('"Host": "cdn.example.com"')
  })

  it('exposes a small template catalog', () => {
    const presets = listTemplatePresets()
    expect(presets.length).toBeGreaterThan(0)
    expect(presets.find((item) => item.id === 'preset-hysteria2')?.defaults.serverPort).toBe(23485)
    expect(presets.find((item) => item.id === 'preset-vless-ws-tls')?.defaults.serverPort).toBe(23491)
    expect(presets.find((item) => item.id === 'preset-wireguard')?.defaults.dns).toEqual(['1.1.1.1', '8.8.8.8'])
  })

  it('renders grouped runtime plans for mixed engines', () => {
    const xrayTemplate: TemplateRecord = {
      ...createTemplate(),
      id: 'tpl_xray',
      name: 'Trojan xray',
      engine: 'xray',
      protocol: 'trojan',
      transport: 'tcp',
      tlsMode: 'tls',
      defaults: {
        serverPort: 443,
        password: 'replace-me',
        sni: 'edge.example.com',
      },
    }

    const artifact = renderReleaseArtifact({
      releaseId: 'rel_mix',
      revision: 5,
      kind: 'runtime',
      configRevision: 5,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'mix',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate(), xrayTemplate],
    })

    const engines = artifact.runtimes.map((runtime) => runtime.engine).sort()
    expect(engines).toEqual(['sing-box', 'xray'])
  })

  it('renders sing-box warp exit traffic through the local WARP SOCKS proxy', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_warp',
      revision: 6,
      kind: 'runtime',
      configRevision: 6,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'warp enabled',
      summary: 'template update',
      node: createNode(),
      templates: [
        {
          ...createTemplate(),
          warpExit: true,
          warpRouteMode: 'ipv4',
        },
      ],
    })

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      route?: { rules?: Array<Record<string, unknown>> }
    }
    const warpOutbound = (runtimeConfig.outbounds || []).find((item) => String(item.tag || '') === 'warp-out')
    expect(runtimeConfig.route?.rules?.some((rule) => JSON.stringify(rule).includes('warp-out'))).toBe(true)
    expect(warpOutbound).toMatchObject({
      type: 'socks',
      server: '127.0.0.1',
      server_port: DEFAULT_WARP_LOCAL_PROXY_PORT,
      version: '5',
    })
  })

  it('renders xray warp exit traffic through the local WARP SOCKS proxy', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_warp_xray',
      revision: 7,
      kind: 'runtime',
      configRevision: 7,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'warp enabled for xray',
      summary: 'template update',
      node: createNode(),
      templates: [
        {
          ...createTemplate(),
          id: 'tpl_warp_xray',
          name: 'Trojan warp',
          engine: 'xray',
          protocol: 'trojan',
          transport: 'tcp',
          tlsMode: 'tls',
          warpExit: true,
          warpRouteMode: 'ipv4',
          defaults: {
            serverPort: 443,
            password: 'replace-me',
            sni: 'edge.example.com',
          },
        },
      ],
    })

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      routing?: { rules?: Array<Record<string, unknown>> }
    }
    const warpOutbound = (runtimeConfig.outbounds || []).find((item) => String(item.tag || '') === 'warp-out')
    expect(runtimeConfig.routing?.rules).toContainEqual({
      type: 'field',
      inboundTag: ['in-1'],
      outboundTag: 'warp-out',
    })
    expect(warpOutbound).toMatchObject({
      protocol: 'socks',
      targetStrategy: 'ForceIPv4',
      settings: {
        address: '127.0.0.1',
        port: DEFAULT_WARP_LOCAL_PROXY_PORT,
      },
    })
  })

  it('renders xray wireguard runtime configs for inbound clients', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_wg_xray',
      revision: 8,
      kind: 'runtime',
      configRevision: 8,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'wireguard xray',
      summary: 'template update',
      node: createNode(),
      templates: [createWireguardTemplate()],
    })

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      inbounds?: Array<Record<string, unknown>>
    }
    const inbound = runtimeConfig.inbounds?.[0]

    expect(artifact.runtimes[0]?.engine).toBe('xray')
    expect(inbound).toMatchObject({
      protocol: 'wireguard',
      port: 51820,
      settings: {
        secretKey: 'server-private-key',
        peers: [
          {
            publicKey: 'client-public-key',
            allowedIPs: ['10.66.0.2/32'],
          },
        ],
        mtu: 1408,
      },
    })
  })

  it('renders sing-box wireguard subscriptions with endpoint config', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_wg_sb',
      revision: 9,
      kind: 'runtime',
      configRevision: 9,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'wireguard sing-box',
      summary: 'template update',
      node: createNode(),
      templates: [createWireguardTemplate({ engine: 'sing-box' })],
    })

    const singbox = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_wg',
        name: 'WireGuard',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: artifact.subscriptionEndpoints,
      },
      'singbox',
    )

    const parsed = JSON.parse(singbox.body) as {
      dns?: { servers?: Array<Record<string, unknown>>; final?: string }
      endpoints?: Array<Record<string, unknown>>
      outbounds?: Array<Record<string, unknown>>
    }

    expect(parsed.endpoints?.[0]).toMatchObject({
      type: 'wireguard',
      address: ['10.66.0.2/32'],
      private_key: 'client-private-key',
      peers: [
        {
          address: 'edge.example.com',
          port: 51820,
          public_key: 'server-public-key',
          allowed_ips: ['0.0.0.0/0', '::/0'],
          persistent_keepalive_interval: 25,
        },
      ],
      mtu: 1408,
    })
    expect(parsed.dns?.final).toBe('dns-1')
    expect(parsed.dns?.servers).toEqual([
      { type: 'udp', tag: 'dns-1', server: '1.1.1.1' },
      { type: 'udp', tag: 'dns-2', server: '8.8.8.8' },
    ])
    expect((parsed.outbounds || []).some((outbound) => String(outbound.type || '') === 'wireguard')).toBe(false)
  })
})
