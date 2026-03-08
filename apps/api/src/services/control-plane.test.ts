import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { CreateTemplateInput } from '@contracts/index'
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
  updateSubscription,
  updateTemplate,
} from './control-plane'
import { renderSubscriptionDocument } from './release-renderer'
import { buildRuntimeCatalog } from './runtime-catalog'

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
      try {
        db.exec(`${statement};`)
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        if (!message.includes('duplicate column name')) {
          throw error
        }
      }
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
    runtimeCatalog: buildRuntimeCatalog(),
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
  it('stops reconcile delivery after a failed release without rolling desired revision back', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node A',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge.example.com',
      backupDomain: '',
      entryIp: '203.0.113.10',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
    const template = await createTemplate(services, createValidTemplateInput())
    const release = await publishNodeRelease(
      services,
      node.id,
      'runtime',
      [template.id],
      {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
      'ship',
    )
    expect(release).toBeTruthy()
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

  it('allows bootstrap releases that only change heartbeat and pull schedules', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node B',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge2.example.com',
      backupDomain: '',
      entryIp: '203.0.113.11',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

    const release = await publishNodeRelease(
      services,
      node.id,
      'bootstrap',
      [],
      {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 30,
        versionPullIntervalSeconds: 90,
        installSingBox: false,
        installXray: false,
      },
      'tune schedules',
    )

    expect(release).toBeTruthy()
    expect(release?.summary).toContain('heartbeat=30s,pull=90s')
  })

  it('rejects bootstrap releases that include protocol templates', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node B2',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge-bootstrap.example.com',
      backupDomain: '',
      entryIp: '203.0.113.21',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
    const template = await createTemplate(services, createValidTemplateInput())

    await expect(
      publishNodeRelease(
        services,
        node.id,
        'bootstrap',
        [template.id],
        {
          installWarp: false,
          warpLicenseKey: '',
          heartbeatIntervalSeconds: 30,
          versionPullIntervalSeconds: 90,
          installSingBox: false,
          installXray: false,
        },
        'invalid bootstrap',
      ),
    ).rejects.toThrow(/do not accept protocol templates/i)
  })

  it('stores apply logs once per status and overwrites on status transitions', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node C',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge3.example.com',
      backupDomain: '',
      entryIp: '203.0.113.12',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
    const template = await createTemplate(services, createValidTemplateInput())
    const release = await publishNodeRelease(
      services,
      node.id,
      'runtime',
      [template.id],
      {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
      'ship logs',
    )

    expect(release).toBeTruthy()

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
    expect(stored?.applyLog).toContain('step-1')
    expect(stored?.applyLog).not.toContain('secret-value')
    expect(stored?.applyLog).not.toContain('step-2 duplicate applying')

    await acknowledgeRelease(
      services,
      node.id,
      String(release?.id),
      'failed',
      'apply failed',
      'step-3 failed',
    )
    await acknowledgeRelease(
      services,
      node.id,
      String(release?.id),
      'failed',
      'apply failed again',
      'step-4 duplicate failed',
    )

    stored = await getNodeReleaseLog(services, node.id, String(release?.id))
    expect(stored?.applyLogStatus).toBe('failed')
    expect(stored?.applyLog).toContain('step-3 failed')
    expect(stored?.applyLog).not.toContain('step-4 duplicate failed')
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

  it('normalizes reality defaults before persisting', async () => {
    const services = createServices()

    const template = await createTemplate(
      services,
      createValidTemplateInput({
        name: 'Reality normalized',
        protocol: 'vless',
        transport: 'tcp',
        tlsMode: 'reality',
        defaults: {
          serverPort: 23490,
          uuid: '11111111-1111-4111-8111-111111111111',
          sni: '',
          flow: '',
          fingerprint: '',
          realityPrivateKey: 'replace-me',
          realityPublicKey: 'replace-me',
          realityShortId: '',
        },
      }),
    )

    expect(String(template.defaults.flow || '')).toBe('xtls-rprx-vision')
    expect(String(template.defaults.fingerprint || '')).toBe('chrome')
    expect(String(template.defaults.sni || '')).not.toBe('')
    expect(String(template.defaults.realityShortId || '')).toMatch(/^[0-9a-f]{2,32}$/i)
  })
})

describe('heartbeat persistence', () => {
  it('stores warp runtime fields from heartbeat data', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node Warp',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'warp.example.com',
      backupDomain: '',
      entryIp: '203.0.113.30',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

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
    expect(updated?.memoryTotalBytes).toBe(16 * 1024 * 1024 * 1024)
    expect(updated?.memoryUsedBytes).toBe(4 * 1024 * 1024 * 1024)
  })
})

describe('subscription documents', () => {
  it('builds subscription entries from the latest healthy runtime release even after bootstrap', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node D',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge4.example.com',
      backupDomain: '',
      entryIp: '203.0.113.13',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
    const template = await createTemplate(services, createValidTemplateInput({
      defaults: {
        serverPort: 23491,
        path: '/ws',
        host: '',
        sni: '',
        uuid: '11111111-1111-4111-8111-111111111111',
      },
    }))
    const runtimeRelease = await publishNodeRelease(
      services,
      node.id,
      'runtime',
      [template.id],
      {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
      'ship runtime',
    )
    expect(runtimeRelease).toBeTruthy()
    await acknowledgeRelease(services, node.id, String(runtimeRelease?.id), 'healthy', 'runtime ok')

    const bootstrapRelease = await publishNodeRelease(
      services,
      node.id,
      'bootstrap',
      [],
      {
        installWarp: true,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 20,
        versionPullIntervalSeconds: 30,
        installSingBox: false,
        installXray: false,
      },
      'bootstrap only',
    )
    expect(bootstrapRelease).toBeTruthy()
    await acknowledgeRelease(services, node.id, String(bootstrapRelease?.id), 'healthy', 'bootstrap ok')

    const subscription = await createSubscription(services, {
      name: 'Main',
      enabled: true,
      visibleNodeIds: [node.id],
    })

    const document = await buildPublicSubscriptionDocument(services, subscription.token)
    expect(document).toBeTruthy()
    expect(document?.entries.length).toBe(1)
    expect(document?.entries[0]?.server).toBe('edge4.example.com')
    expect(document?.entries[0]?.sni).toBe('edge4.example.com')
    expect(document?.entries[0]?.uri).toBeUndefined()
    const plain = renderSubscriptionDocument(document!, 'plain')
    expect(plain.body).toContain('sni=edge4.example.com')
  })

  it('serves subscription entries directly from artifact snapshots', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node Snapshot',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge-snapshot.example.com',
      backupDomain: '',
      entryIp: '203.0.113.21',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
    const template = await createTemplate(services, createValidTemplateInput({
      defaults: {
        serverPort: 23491,
        path: '/ws',
        host: 'cdn.snapshot.example.com',
        sni: 'edge-snapshot.example.com',
        uuid: '11111111-1111-4111-8111-111111111111',
      },
    }))
    const runtimeRelease = await publishNodeRelease(
      services,
      node.id,
      'runtime',
      [template.id],
      {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
      'ship runtime snapshot',
    )
    expect(runtimeRelease).toBeTruthy()
    await acknowledgeRelease(services, node.id, String(runtimeRelease?.id), 'healthy', 'runtime ok')

    const releaseRow = await services.db.get<{ artifact_key: string }>(
      'SELECT artifact_key FROM releases WHERE id = ?',
      [String(runtimeRelease?.id)],
    )
    expect(releaseRow?.artifact_key).toBeTruthy()
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
    expect(document?.entries[0]?.uri).toBeUndefined()
    const plain = renderSubscriptionDocument(document!, 'plain')
    expect(plain.body).toContain('edge-snapshot.example.com')
  })

  it('updates and deletes subscriptions', async () => {
    const services = createServices()
    const node = await createNode(services, {
      name: 'Node E',
      nodeType: 'vps',
      region: 'ap-sg',
      tags: [],
      networkType: 'public',
      primaryDomain: 'edge5.example.com',
      backupDomain: '',
      entryIp: '203.0.113.14',
      githubMirrorUrl: '',
      cfDnsToken: '',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })
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
