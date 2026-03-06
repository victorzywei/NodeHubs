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
    primaryDomain: 'edge.example.com',
    backupDomain: '',
    entryIp: '203.0.113.1',
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

    expect(artifact.runtime.engine).toBe('sing-box')
    expect(artifact.runtime.binary.version).toBe(runtimeCatalog['sing-box'].version)
    expect(artifact.runtime.files[0]?.path).toBe('runtime/sing-box.json')
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
})
