import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { APP_VERSION } from './lib/constants'
import type { AppServices } from './lib/app-types'
import type { SqlAdapter, SqlValue } from './lib/db'
import { buildRuntimeCatalog } from './services/runtime-catalog'
import { MinioArtifactStore } from './storage/minio-store'

let cachedServices: AppServices | null = null

function resolveDbPath(): string {
  return process.env.SQLITE_FILE || resolve(process.cwd(), 'apps/api/storage/dev.db')
}

function applyMigrations(db: DatabaseSync): void {
  const migrationPath = resolve(process.cwd(), 'apps/api/migrations/0001_init.sql')
  const sqlText = readFileSync(migrationPath, 'utf8')
  db.exec(sqlText)
}

function normalizeParams(params: SqlValue[] = []): Array<string | number | null> {
  return params.map((value) => (typeof value === 'boolean' ? Number(value) : value))
}

function createSqliteAdapter(db: DatabaseSync): SqlAdapter {
  return {
    exec(sqlText) {
      db.exec(sqlText)
    },
    async run(sqlText, params = []) {
      db.prepare(sqlText).run(...normalizeParams(params))
    },
    async get(sqlText, params = []) {
      return ((db.prepare(sqlText).get(...normalizeParams(params)) as Record<string, unknown> | undefined) ?? null) as never
    },
    async all(sqlText, params = []) {
      return (((db.prepare(sqlText).all(...normalizeParams(params)) as Record<string, unknown>[]) ?? []) as never)
    },
  }
}

export function getNodeServices(): AppServices {
  if (cachedServices) return cachedServices

  const dbPath = resolveDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL;')
  applyMigrations(sqlite)
  const artifacts = new MinioArtifactStore(
    process.env.MINIO_BUCKET || 'newnodeshub',
    {
      endpoint: process.env.MINIO_ENDPOINT || 'http://127.0.0.1:9000',
      region: process.env.MINIO_REGION || 'auto',
      accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    },
  )

  cachedServices = {
    appVersion: APP_VERSION,
    mode: 'docker',
    dbDriver: 'sqlite',
    artifactDriver: 'minio',
    adminKey: process.env.ADMIN_KEY || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3000'}`,
    db: createSqliteAdapter(sqlite),
    artifacts,
    runtimeCatalog: buildRuntimeCatalog({
      singBoxVersion: process.env.SINGBOX_VERSION,
      xrayVersion: process.env.XRAY_VERSION,
      singBoxReleaseBaseUrl: process.env.SINGBOX_RELEASE_BASE_URL,
      xrayReleaseBaseUrl: process.env.XRAY_RELEASE_BASE_URL,
    }),
  }

  return cachedServices
}
