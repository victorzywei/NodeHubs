import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { CreateTemplateInput } from '@contracts/index'
import type { AppServices } from '../lib/app-types'
import type { SqlAdapter, SqlValue } from '../lib/db'
import type { ArtifactStore, StoredArtifact } from '../storage/types'
import { acknowledgeRelease, createNode, createTemplate, getDesiredRelease, getNodeById, getNodeReleaseLog, publishNodeRelease, updateTemplate } from './control-plane'
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
    appVersion: '0.1.10',
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
  it('stops reconcile delivery after a failed release and rolls desired revision back', async () => {
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
    expect(latestNode?.desiredReleaseRevision).toBe(latestNode?.currentReleaseRevision)
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
})
