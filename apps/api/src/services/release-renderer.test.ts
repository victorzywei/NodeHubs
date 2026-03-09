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
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
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
    }, buildRuntimeCatalog())

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
    }, buildRuntimeCatalog()).subscriptionEndpoints

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
    }, buildRuntimeCatalog()).subscriptionEndpoints

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
    }, buildRuntimeCatalog())

    const engines = artifact.runtimes.map((runtime) => runtime.engine).sort()
    expect(engines).toEqual(['sing-box', 'xray'])
  })

  it('binds warp exit traffic to the CloudflareWARP interface', () => {
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
    }, buildRuntimeCatalog())

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      route?: { rules?: Array<Record<string, unknown>> }
    }
    const warpOutbound = (runtimeConfig.outbounds || []).find((item) => String(item.tag || '') === 'warp-out')
    expect(runtimeConfig.route?.rules?.some((rule) => JSON.stringify(rule).includes('0.0.0.0/0'))).toBe(true)
    expect(warpOutbound).toMatchObject({
      type: 'direct',
      bind_interface: 'CloudflareWARP',
    })
  })
})
