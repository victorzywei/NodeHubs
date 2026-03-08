import { describe, expect, it } from 'vitest'
import type { NodeRecord, TemplateRecord } from '@contracts/index'
import { listTemplatePresets, parseReleaseArtifact, renderReleaseArtifact, renderSubscriptionDocument } from './release-renderer'
import { buildRuntimeCatalog } from './runtime-catalog'

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
    githubMirrorUrl: '',
    warpLicenseKey: '',
    cfDnsToken: '',
    argoTunnelToken: '',
    argoTunnelDomain: '',
    argoTunnelPort: 2053,
    configRevision: 2,
    bootstrapRevision: 1,
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

function createTemplate(): TemplateRecord {
  return {
    id: 'tpl_1',
    name: 'VLESS edge',
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

describe('release renderer', () => {
  it('renders release artifacts with runtime files and subscription entries', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_1',
      revision: 2,
      kind: 'runtime',
      configRevision: 2,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate()],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    expect(artifact.runtimes.length).toBe(1)
    expect(artifact.runtimes[0]?.engine).toBe('sing-box')
    expect(artifact.runtimes[0]?.binary.version).toBe(runtimeCatalog['sing-box'].version)
    expect(artifact.runtimes[0]?.files[0]?.path).toBe('runtime/sing-box.json')
    expect(artifact.subscriptionEndpoints[0]?.host).toBe('cdn.example.com')
    expect(artifact.subscriptionEndpoints[0]?.sni).toBe('edge.example.com')
    expect(artifact.subscriptionEndpoints[0]?.uri).toBeUndefined()
    expect(parseReleaseArtifact(JSON.stringify(artifact)))?.toMatchObject({
      schema: 'nodehubsapi-release-v2',
      releaseId: 'rel_1',
    })
  })

  it('renders base64 and plain subscription documents', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const entry = renderReleaseArtifact({
      releaseId: 'rel_2',
      revision: 3,
      kind: 'runtime',
      configRevision: 3,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: '',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate()],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog).subscriptionEndpoints

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
    const runtimeCatalog = buildRuntimeCatalog()
    const entry = renderReleaseArtifact({
      releaseId: 'rel_3',
      revision: 4,
      kind: 'runtime',
      configRevision: 4,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: '',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate()],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog).subscriptionEndpoints

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
    expect(clash.body).toContain('MATCH,NodeHub')
    expect(singbox.body).toContain('"server_name": "edge.example.com"')
    expect(singbox.body).toContain('"Host": "cdn.example.com"')
    expect(singbox.body).toContain('"path": "/ws"')
  })

  it('renders structured subscription documents from snapshot fields instead of reparsing uri', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const entry = renderReleaseArtifact({
      releaseId: 'rel_3b',
      revision: 4,
      kind: 'runtime',
      configRevision: 4,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: '',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate()],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog).subscriptionEndpoints.map((item) => ({
      ...item,
      uri: 'vless://broken@example.invalid:1?type=tcp&security=none#broken',
    }))

    const clash = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'clash',
    )
    const plain = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_1',
        name: 'Default',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: entry,
      },
      'plain',
    )

    expect(clash.body).toContain('"servername":"edge.example.com"')
    expect(clash.body).not.toContain('example.invalid')
    expect(plain.body).toContain('edge.example.com:443')
    expect(plain.body).not.toContain('example.invalid')
  })

  it('exposes a small template catalog', () => {
    const presets = listTemplatePresets()
    expect(presets.length).toBeGreaterThan(0)
    expect(presets.find((item) => item.id === 'preset-hysteria2')?.defaults.serverPort).toBe(23485)
    expect(presets.find((item) => item.id === 'preset-ss2022')?.defaults.serverPort).toBe(23486)
    expect(presets.find((item) => item.id === 'preset-trojan-tcp-tls')?.defaults.serverPort).toBe(23487)
    expect(presets.find((item) => item.id === 'preset-trojan-grpc-tls')?.defaults.serverPort).toBe(23488)
    expect(presets.find((item) => item.id === 'preset-vmess-tls-ws')?.defaults.serverPort).toBe(23489)
    expect(presets.find((item) => item.id === 'preset-vless-reality-tcp')?.defaults.serverPort).toBe(23490)
    expect(presets.find((item) => item.id === 'preset-vless-ws-tls')?.defaults.serverPort).toBe(23491)
  })

  it('rejects incompatible engine and protocol combinations', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const invalidTemplate: TemplateRecord = {
      ...createTemplate(),
      engine: 'xray',
      protocol: 'hysteria2',
      transport: 'hysteria2',
      tlsMode: 'tls',
      defaults: {
        ...createTemplate().defaults,
        password: 'replace-me',
      },
    }

    expect(() => renderReleaseArtifact({
      releaseId: 'rel_invalid',
      revision: 4,
      kind: 'runtime',
      configRevision: 4,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'invalid',
      summary: 'runtime update',
      node: createNode(),
      templates: [invalidTemplate],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)).toThrow(/requires sing-box/i)
  })

  it('renders grouped runtime plans for mixed engines', () => {
    const runtimeCatalog = buildRuntimeCatalog()
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
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'mix',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate(), xrayTemplate],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    const engines = artifact.runtimes.map((runtime) => runtime.engine).sort()
    expect(engines).toEqual(['sing-box', 'xray'])
  })

  it('injects warp outbound routing when warp exit is enabled on a template', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_warp',
      revision: 6,
      kind: 'runtime',
      configRevision: 6,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'warp enabled',
      summary: 'runtime update',
      node: createNode(),
      templates: [
        {
          ...createTemplate(),
          warpExit: true,
          warpRouteMode: 'ipv4',
          defaults: {
            ...createTemplate().defaults,
            warp_server: 'engage.cloudflareclient.com',
            warp_server_port: 2408,
            warp_local_address_ipv4: '172.16.0.2/32',
            warp_local_address_ipv6: '2606:4700:110:8d8d:1845:c39f:2dd5:a03a/128',
            warp_private_key: 'template-private-key',
            warp_peer_public_key: 'template-peer-key',
            warp_system_interface: 'false',
            warp_mtu: 1280,
            reserved: '7,8,9',
          },
        },
      ],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      route?: { rules?: Array<Record<string, unknown>> }
    }
    const tags = (runtimeConfig.outbounds || []).map((item) => String(item.tag || ''))
    const warpOutbound = (runtimeConfig.outbounds || []).find((item) => String(item.tag || '') === 'warp-out')
    expect(tags).toContain('warp-out')
    expect(runtimeConfig.route?.rules?.some((rule) => JSON.stringify(rule).includes('0.0.0.0/0'))).toBe(true)
    expect(warpOutbound).toMatchObject({
      type: 'wireguard',
      system: false,
      mtu: 1280,
      address: ['172.16.0.2/32', '2606:4700:110:8d8d:1845:c39f:2dd5:a03a/128'],
    })
    expect((warpOutbound?.peers as Array<Record<string, unknown>> | undefined)?.[0]).toMatchObject({
      address: 'engage.cloudflareclient.com',
      port: 2408,
      public_key: 'template-peer-key',
      reserved: [7, 8, 9],
    })
  })

  it('fills reality flow and fingerprint defaults in runtime and subscription outputs', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_reality',
      revision: 7,
      kind: 'runtime',
      configRevision: 7,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'reality defaults',
      summary: 'runtime update',
      node: createNode(),
      templates: [
        {
          ...createTemplate(),
          id: 'tpl_reality',
          name: 'Reality xray',
          engine: 'xray',
          protocol: 'vless',
          transport: 'tcp',
          tlsMode: 'reality',
          defaults: {
            serverPort: 23490,
            uuid: '11111111-1111-4111-8111-111111111111',
            sni: '',
            flow: '',
            fingerprint: '',
            realityPublicKey: 'pubkey-value',
            realityPrivateKey: 'privkey-value',
            realityShortId: '7c92f9ef2ca25e5a',
          },
        },
      ],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    const entry = artifact.subscriptionEndpoints[0]
    expect(entry?.flow).toBe('xtls-rprx-vision')
    expect(entry?.fingerprint).toBe('chrome')
    expect(entry?.uri).toBeUndefined()

    const plain = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_reality',
        name: 'Reality',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: artifact.subscriptionEndpoints,
      },
      'plain',
    )
    expect(plain.body).toContain('flow=xtls-rprx-vision')
    expect(plain.body).toContain('fp=chrome')

    const clash = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_reality',
        name: 'Reality',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: artifact.subscriptionEndpoints,
      },
      'clash',
    )
    expect(clash.body).toContain('"client-fingerprint":"chrome"')

    const singbox = renderSubscriptionDocument(
      {
        subscriptionId: 'sub_reality',
        name: 'Reality',
        generatedAt: '2026-03-06T00:00:00.000Z',
        entries: artifact.subscriptionEndpoints,
      },
      'singbox',
    )
    expect(singbox.body).toContain('"fingerprint": "chrome"')
    expect(artifact.runtimes[0]?.files[0]?.content).toContain('"flow": "xtls-rprx-vision"')
  })

  it('adds bootstrap runtime binaries when requested', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_bootstrap',
      revision: 7,
      kind: 'bootstrap',
      configRevision: 6,
      bootstrapRevision: 2,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'bootstrap binaries',
      summary: 'bootstrap update',
      node: createNode(),
      templates: [],
      bootstrapOptions: {
        installWarp: true,
        warpLicenseKey: 'warp-license-inline',
        heartbeatIntervalSeconds: 20,
        versionPullIntervalSeconds: 45,
        installSingBox: true,
        installXray: true,
      },
    }, runtimeCatalog)

    expect(artifact.bootstrap.installWarp).toBe(true)
    expect(artifact.bootstrap.warpLicenseKey).toBe('warp-license-inline')
    expect(artifact.bootstrap.heartbeatIntervalSeconds).toBe(20)
    expect(artifact.bootstrap.versionPullIntervalSeconds).toBe(45)
    expect(artifact.bootstrap.installSingBox).toBe(true)
    expect(artifact.bootstrap.installXray).toBe(true)
    expect(artifact.bootstrap.runtimeBinaries.map((item) => item.engine).sort()).toEqual(['sing-box', 'xray'])
    expect(artifact.bootstrap.notes.some((note) => note.includes('uses sing-box to generate the WireGuard keypair'))).toBe(true)
  })

  it('renders xray warp exit as a direct wireguard outbound', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_xray_warp',
      revision: 9,
      kind: 'runtime',
      configRevision: 9,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'xray warp enabled',
      summary: 'runtime update',
      node: {
        ...createNode(),
        warpEndpoint: 'engage.cloudflareclient.com:2408',
        warpIpv6: '2606:4700:d0::a29f:c006',
        warpPrivateKey: 'template-private-key',
        warpReserved: [7, 8, 9],
      },
      templates: [
        {
          ...createTemplate(),
          id: 'tpl_xray_warp',
          engine: 'xray',
          warpExit: true,
          warpRouteMode: 'all',
          defaults: {
            ...createTemplate().defaults,
            warp_server: 'engage.cloudflareclient.com',
            warp_server_port: 2408,
            warp_private_key: 'template-private-key',
            warp_peer_public_key: 'template-peer-key',
            warp_system_interface: 'false',
            warp_mtu: 1280,
            reserved: '7,8,9',
          },
        },
      ],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      routing?: { rules?: Array<Record<string, unknown>>; domainStrategy?: string }
    }
    const outbounds = runtimeConfig.outbounds || []
    const warpOutbound = outbounds.find((item) => String(item.tag || '') === 'warp-out')

    expect(outbounds.some((item) => String(item.tag || '') === 'x-warp-out')).toBe(false)
    expect(warpOutbound).toMatchObject({
      tag: 'warp-out',
      protocol: 'wireguard',
      settings: {
        secretKey: 'template-private-key',
        address: ['172.16.0.2/32', '2606:4700:d0::a29f:c006/128'],
        reserved: [7, 8, 9],
        mtu: 1280,
        kernelMode: false,
        domainStrategy: 'ForceIPv6v4',
      },
    })
    expect((warpOutbound?.settings as { peers?: Array<Record<string, unknown>> } | undefined)?.peers?.[0]).toMatchObject({
      publicKey: 'template-peer-key',
      endpoint: 'engage.cloudflareclient.com:2408',
      allowedIPs: ['0.0.0.0/0', '::/0'],
    })
    expect(runtimeConfig.routing?.domainStrategy).toBe('IPOnDemand')
    expect(runtimeConfig.routing?.rules?.some((rule) => JSON.stringify(rule).includes('"outboundTag":"warp-out"'))).toBe(true)
  })

  it('repairs placeholder secrets before rendering xray shadowsocks 2022 configs', () => {
    const runtimeCatalog = buildRuntimeCatalog()
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_ss2022',
      revision: 8,
      kind: 'runtime',
      configRevision: 8,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'repair invalid password',
      summary: 'runtime update',
      node: createNode(),
      templates: [
        {
          ...createTemplate(),
          id: 'tpl_ss2022',
          name: 'SS2022 xray',
          engine: 'xray',
          protocol: 'shadowsocks',
          transport: 'tcp',
          tlsMode: 'none',
          defaults: {
            serverPort: 8388,
            method: '2022-blake3-aes-128-gcm',
            password: 'replace-me-base64-key',
          },
        },
      ],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, runtimeCatalog)

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      inbounds?: Array<{ settings?: { password?: string } }>
    }
    const password = String(runtimeConfig.inbounds?.[0]?.settings?.password || '')

    expect(password).not.toBe('replace-me-base64-key')
    expect(atob(password).length).toBe(16)
  })
})

