import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { CreateNodeInput, CreateTemplateInput } from '@contracts/index'
import type { AppServices } from '../lib/app-types'
import type { SqlAdapter, SqlValue } from '../lib/db'
import type { ArtifactStore, StoredArtifact } from '../storage/types'
import {
  acknowledgeRelease,
  buildPublicSubscriptionDocument,
  createNode,
  createSubscription,
  createTemplate,
  deleteSubscription,
  getDesiredRelease,
  getNodeById,
  getNodeReleaseLog,
  publishNodeRelease,
  recordHeartbeat,
  updateNode,
  updateSubscription,
  updateTemplate,
} from './control-plane'
import { renderSubscriptionDocument } from './release-renderer'

function createSqliteAdapter(db: DatabaseSync): SqlAdapter {
  return {
    exec(sqlText) {
      db.exec(sqlText)
    },
    async run(sqlText: string, params: SqlValue[] = []) {
      db.prepare(sqlText).run(...params)
    },
    async get<T>(sqlText: string, params: SqlValue[] = []) {
      const row = db.prepare(sqlText).get(...params) as T | undefined
      return row ?? null
    },
    async all<T>(sqlText: string, params: SqlValue[] = []) {
      return (db.prepare(sqlText).all(...params) as T[]) ?? []
    },
  }
}

function applyMigrations(db: DatabaseSync): void {
  const migrationDir = resolve(process.cwd(), 'migrations')
  const migrationFiles = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const migrationFile of migrationFiles) {
    const sqlText = readFileSync(resolve(migrationDir, migrationFile), 'utf8')
    const statements = sqlText.split(';').map((item) => item.trim()).filter(Boolean)
    for (const statement of statements) {
      db.exec(`${statement};`)
    }
  }
}

class MemoryArtifactStore implements ArtifactStore {
  private readonly items = new Map<string, StoredArtifact>()

  async putJson(key: string, data: unknown) {
    const body = JSON.stringify(data)
    const etag = createHash('sha256').update(body).digest('hex')
    const item: StoredArtifact = {
      key,
      body,
      contentType: 'application/json',
      etag,
    }
    this.items.set(key, item)
    return { key, etag }
  }

  async get(key: string): Promise<StoredArtifact | null> {
    return this.items.get(key) ?? null
  }
}

function createServices(): AppServices {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return {
    appVersion: '0.1.13',
    mode: 'docker',
    dbDriver: 'sqlite',
    artifactDriver: 'minio',
    adminKey: 'admin',
    publicBaseUrl: 'https://control.example.com',
    db: createSqliteAdapter(db),
    artifacts: new MemoryArtifactStore(),
  }
}

function createNodeInput(overrides: Partial<CreateNodeInput> = {}): CreateNodeInput {
  return {
    name: 'Node A',
    nodeType: 'vps',
    region: 'ap-sg',
    tags: [],
    networkType: 'public',
    primaryDomain: 'edge.example.com',
    backupDomain: '',
    entryIp: '203.0.113.10',
    githubMirrorUrl: '',
    installWarp: false,
    warpLicenseKey: '',
    cfDnsToken: '',
    argoTunnelToken: '',
    argoTunnelDomain: '',
    argoTunnelPort: 2053,
    heartbeatIntervalSeconds: 15,
    versionPullIntervalSeconds: 15,
    ...overrides,
  }
}

function createValidTemplateInput(overrides: Partial<CreateTemplateInput> = {}): CreateTemplateInput {
  return {
    name: 'VLESS WS TLS',
    engine: 'xray',
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
    ...overrides,
  }
}

describe('control-plane release flow', () => {
  it('keeps runtime config revision stable when only install-time node settings change', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput())

    const updated = await updateNode(services, node.id, {
      installWarp: true,
      warpLicenseKey: 'warp-plus-key',
      heartbeatIntervalSeconds: 30,
      versionPullIntervalSeconds: 60,
    })

    expect(updated?.installWarp).toBe(true)
    expect(updated?.heartbeatIntervalSeconds).toBe(30)
    expect(updated?.versionPullIntervalSeconds).toBe(60)
    expect(updated?.configRevision).toBe(node.configRevision)
  })

  it('stops reconcile delivery after a failed template release without rolling desired revision back', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput())
    const template = await createTemplate(services, createValidTemplateInput())
    const release = await publishNodeRelease(services, node.id, [template.id], 'ship')

    expect(release?.status).toBe('pending')

    const pending = await getDesiredRelease(services, node.id)
    expect(pending?.release?.id).toBe(release?.id)

    await acknowledgeRelease(services, node.id, String(release?.id), 'failed', 'failed on host')

    const afterFailed = await getDesiredRelease(services, node.id)
    expect(afterFailed?.release).toBeNull()

    const latestNode = await getNodeById(services, node.id)
    expect(latestNode?.desiredReleaseRevision).toBe(release?.revision)
    expect(latestNode?.currentReleaseRevision).toBe(0)
    expect(latestNode?.currentReleaseStatus).toBe('failed')
  })

  it('stores apply logs once per status and overwrites on status transitions', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({ name: 'Node Logs', primaryDomain: 'logs.example.com' }))
    const template = await createTemplate(services, createValidTemplateInput())
    const release = await publishNodeRelease(services, node.id, [template.id], 'ship logs')

    await acknowledgeRelease(
      services,
      node.id,
      String(release?.id),
      'applying',
      'apply started',
      'step-1\nX-Agent-Token: secret-value',
    )
    await acknowledgeRelease(
      services,
      node.id,
      String(release?.id),
      'applying',
      'apply started again',
      'step-2 duplicate applying',
    )

    let stored = await getNodeReleaseLog(services, node.id, String(release?.id))
    expect(stored?.applyLogStatus).toBe('applying')
    expect(stored?.applyLog).toContain('step-2 duplicate applying')
    expect(stored?.applyLog).not.toContain('secret-value')
    expect(stored?.applyLog).not.toContain('step-1')

    await acknowledgeRelease(
      services,
      node.id,
      String(release?.id),
      'failed',
      'apply failed',
      'step-3 failed',
    )

    stored = await getNodeReleaseLog(services, node.id, String(release?.id))
    expect(stored?.applyLogStatus).toBe('failed')
    expect(stored?.applyLog).toContain('step-3 failed')
  })
})

describe('control-plane template validation', () => {
  it('rejects invalid template combinations in service layer create/update paths', async () => {
    const services = createServices()

    await expect(
      createTemplate(
        services,
        createValidTemplateInput({
          name: 'Invalid Hysteria2 on Xray',
          engine: 'xray',
          protocol: 'hysteria2',
          transport: 'hysteria2',
          tlsMode: 'tls',
          defaults: { password: 'replace-me' },
        }),
      ),
    ).rejects.toThrow(/sing-box/i)

    const existing = await createTemplate(services, createValidTemplateInput())
    await expect(
      updateTemplate(services, existing.id, {
        protocol: 'hysteria2',
        transport: 'hysteria2',
        tlsMode: 'tls',
      }),
    ).rejects.toThrow(/sing-box/i)
  })

  it('normalizes placeholder template defaults before persisting them', async () => {
    const services = createServices()

    const template = await createTemplate(
      services,
      createValidTemplateInput({
        name: 'SS2022 normalized',
        protocol: 'shadowsocks',
        transport: 'tcp',
        tlsMode: 'none',
        defaults: {
          serverPort: 8388,
          method: '2022-blake3-aes-128-gcm',
          password: 'replace-me-base64-key',
        },
      }),
    )

    expect(String(template.defaults.password || '')).not.toBe('replace-me-base64-key')
    expect(atob(String(template.defaults.password || '')).length).toBe(16)
  })
})

describe('heartbeat persistence', () => {
  it('stores warp runtime fields from heartbeat data', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({ name: 'Node Warp', primaryDomain: 'warp.example.com' }))

    const updated = await recordHeartbeat(services, {
      nodeId: node.id,
      bytesInTotal: 1,
      bytesOutTotal: 2,
      currentConnections: 3,
      cpuCoreCount: 8,
      cpuUsagePercent: 10,
      memoryTotalBytes: 16 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      memoryUsagePercent: 20,
      warpStatus: 'installed',
      warpIpv4: '172.16.0.2/32',
      warpIpv6: '2606:4700:110:8d8d:1845:c39f:2dd5:a03a',
      warpEndpoint: 'engage.cloudflareclient.com:2408',
      warpAccountType: 'Unlimited',
      warpTunnelProtocol: 'MASQUE',
      warpPrivateKey: 'private-key',
      warpReserved: [1, 2, 3],
      protocolRuntimeVersion: 'sing-box 1.13.0',
    })

    expect(updated?.warpIpv4).toBe('172.16.0.2/32')
    expect(updated?.warpAccountType).toBe('Unlimited')
    expect(updated?.warpTunnelProtocol).toBe('MASQUE')
    expect(updated?.warpPrivateKey).toBe('private-key')
    expect(updated?.warpReserved).toEqual([1, 2, 3])
    expect(updated?.cpuCoreCount).toBe(8)
  })
})

describe('subscription documents', () => {
  it('builds subscription entries from the latest healthy template release', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({ name: 'Node Sub', primaryDomain: 'edge-sub.example.com' }))
    const template = await createTemplate(services, createValidTemplateInput({
      defaults: {
        serverPort: 23491,
        path: '/ws',
        host: '',
        sni: '',
        uuid: '11111111-1111-4111-8111-111111111111',
      },
    }))
    const release = await publishNodeRelease(services, node.id, [template.id], 'ship runtime')
    await acknowledgeRelease(services, node.id, String(release?.id), 'healthy', 'runtime ok')

    const subscription = await createSubscription(services, {
      name: 'Main',
      enabled: true,
      visibleNodeIds: [node.id],
    })

    const document = await buildPublicSubscriptionDocument(services, subscription.token)
    expect(document?.entries.length).toBe(1)
    expect(document?.entries[0]?.server).toBe('edge-sub.example.com')
    expect(document?.entries[0]?.sni).toBe('edge-sub.example.com')

    const plain = renderSubscriptionDocument(document!, 'plain')
    expect(plain.body).toContain('sni=edge-sub.example.com')
  })

  it('serves subscription entries directly from artifact snapshots', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({ name: 'Node Snapshot', primaryDomain: 'edge-snapshot.example.com' }))
    const template = await createTemplate(services, createValidTemplateInput({
      defaults: {
        serverPort: 23491,
        path: '/ws',
        host: 'cdn.snapshot.example.com',
        sni: 'edge-snapshot.example.com',
        uuid: '11111111-1111-4111-8111-111111111111',
      },
    }))
    const release = await publishNodeRelease(services, node.id, [template.id], 'ship runtime snapshot')
    await acknowledgeRelease(services, node.id, String(release?.id), 'healthy', 'runtime ok')

    const releaseRow = await services.db.get<{ artifact_key: string }>(
      'SELECT artifact_key FROM releases WHERE id = ?',
      [String(release?.id)],
    )
    const storedArtifact = await services.artifacts.get(String(releaseRow?.artifact_key))
    const parsedArtifact = JSON.parse(String(storedArtifact?.body || '{}')) as {
      templates: unknown[]
      subscriptionEndpoints: unknown[]
    }
    parsedArtifact.templates = []
    await services.artifacts.putJson(String(releaseRow?.artifact_key), parsedArtifact)

    const subscription = await createSubscription(services, {
      name: 'Snapshot',
      enabled: true,
      visibleNodeIds: [node.id],
    })

    const document = await buildPublicSubscriptionDocument(services, subscription.token)
    expect(document?.entries.length).toBe(1)
    expect(document?.entries[0]?.server).toBe('edge-snapshot.example.com')
    expect(document?.entries[0]?.host).toBe('cdn.snapshot.example.com')
  })

  it('re-renders subscription domains from the latest node heartbeat state', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({
      name: 'Node Argo',
      networkType: 'noPublicIp',
      primaryDomain: '',
      backupDomain: '',
      entryIp: '',
      argoTunnelDomain: 'old-argo-domain.trycloudflare.com',
    }))
    const template = await createTemplate(services, createValidTemplateInput({
      name: 'VMess Argo',
      protocol: 'vmess',
      defaults: {
        serverPort: 23489,
        path: '/ws',
        host: '',
        sni: '',
        uuid: '11111111-1111-4111-8111-111111111111',
        alterId: 0,
      },
    }))
    const release = await publishNodeRelease(services, node.id, [template.id], 'ship runtime argo')
    await acknowledgeRelease(services, node.id, String(release?.id), 'healthy', 'runtime ok')

    await recordHeartbeat(services, {
      nodeId: node.id,
      bytesInTotal: 1,
      bytesOutTotal: 2,
      currentConnections: 3,
      cpuUsagePercent: 10,
      memoryUsagePercent: 20,
      argoStatus: 'running',
      argoDomain: 'new-argo-domain.trycloudflare.com',
      protocolRuntimeVersion: 'xray 26.1.23',
    })

    const subscription = await createSubscription(services, {
      name: 'Argo',
      enabled: true,
      visibleNodeIds: [node.id],
    })

    const document = await buildPublicSubscriptionDocument(services, subscription.token)
    expect(document?.entries.length).toBe(1)
    expect(document?.entries[0]?.server).toBe('new-argo-domain.trycloudflare.com')
    expect(document?.entries[0]?.host).toBe('new-argo-domain.trycloudflare.com')
    expect(document?.entries[0]?.sni).toBe('new-argo-domain.trycloudflare.com')

    const plain = renderSubscriptionDocument(document!, 'plain')
    const vmessPayload = JSON.parse(atob(plain.body.replace('vmess://', ''))) as {
      add: string
      host: string
      sni: string
    }
    expect(vmessPayload.add).toBe('new-argo-domain.trycloudflare.com')
    expect(vmessPayload.host).toBe('new-argo-domain.trycloudflare.com')
    expect(vmessPayload.sni).toBe('new-argo-domain.trycloudflare.com')
  })

  it('updates and deletes subscriptions', async () => {
    const services = createServices()
    const node = await createNode(services, createNodeInput({ name: 'Node Visible', primaryDomain: 'edge-visible.example.com' }))
    const subscription = await createSubscription(services, {
      name: 'Before',
      enabled: true,
      visibleNodeIds: [],
    })

    const updated = await updateSubscription(services, subscription.id, {
      name: 'After',
      enabled: false,
      visibleNodeIds: [node.id, 'missing'],
    })

    expect(updated?.name).toBe('After')
    expect(updated?.enabled).toBe(false)
    expect(updated?.visibleNodeIds).toEqual([node.id])

    const deleted = await deleteSubscription(services, subscription.id)
    expect(deleted).toBe(true)
  })
})
