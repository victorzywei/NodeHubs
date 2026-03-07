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
    installWarp: false,
    installArgo: false,
    configRevision: 2,
    bootstrapRevision: 1,
    desiredReleaseRevision: 2,
    currentReleaseRevision: 1,
    currentReleaseStatus: 'healthy',
    lastSeenAt: null,
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
    }, runtimeCatalog)

    expect(artifact.runtimes.length).toBe(1)
    expect(artifact.runtimes[0]?.engine).toBe('sing-box')
    expect(artifact.runtimes[0]?.binary.version).toBe(runtimeCatalog['sing-box'].version)
    expect(artifact.runtimes[0]?.files[0]?.path).toBe('runtime/sing-box.json')
    expect(artifact.subscriptionEndpoints[0]?.uri).toContain('vless://11111111-1111-4111-8111-111111111111@edge.example.com:443')
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

  it('exposes a small template catalog', () => {
    expect(listTemplatePresets().length).toBeGreaterThan(0)
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
      node: {
        ...createNode(),
        warpPrivateKey: 'private-key-from-report',
        warpIpv6: '2606:4700:110:8d8d:1845:c39f:2dd5:a03a',
        warpEndpoint: 'engage.cloudflareclient.com:2408',
        warpReserved: [1, 2, 3],
      },
      templates: [
        {
          ...createTemplate(),
          warpExit: true,
          warpRouteMode: 'ipv4',
        },
      ],
    }, runtimeCatalog)

    const runtimeConfig = JSON.parse(artifact.runtimes[0]?.files[0]?.content || '{}') as {
      outbounds?: Array<Record<string, unknown>>
      route?: { rules?: Array<Record<string, unknown>> }
    }
    const tags = (runtimeConfig.outbounds || []).map((item) => String(item.tag || ''))
    expect(tags).toContain('warp-out')
    expect(runtimeConfig.route?.rules?.some((rule) => JSON.stringify(rule).includes('0.0.0.0/0'))).toBe(true)
  })
})
