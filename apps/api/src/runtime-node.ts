import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_VERSION } from './lib/constants'
import type { AppServices } from './lib/app-types'
import type { SqlAdapter, SqlValue } from './lib/db'
import { applySqliteMigrations } from './lib/migrations'
import { DatabaseSync, type DatabaseSyncInstance } from './lib/node-sqlite'
import { resolveApiMigrationsDir, resolveApiStoragePath } from './lib/runtime-paths'
import { FileArtifactStore } from './storage/file-store'

let cachedServices: AppServices | null = null

function resolveDbPath(): string {
  return process.env.SQLITE_FILE || resolveApiStoragePath('dev.db')
}

function resolveArtifactsDir(): string {
  return process.env.ARTIFACTS_DIR || resolveApiStoragePath('artifacts')
}

function applyMigrations(db: DatabaseSyncInstance): void {
  applySqliteMigrations(db, resolveApiMigrationsDir())
}

function normalizeParams(params: SqlValue[] = []): Array<string | number | null> {
  return params.map((value) => (typeof value === 'boolean' ? Number(value) : value))
}

function createSqliteAdapter(db: DatabaseSyncInstance): SqlAdapter {
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
  const artifacts = new FileArtifactStore(resolveArtifactsDir())

  cachedServices = {
    appVersion: APP_VERSION,
    mode: 'docker',
    dbDriver: 'sqlite',
    artifactDriver: 'local',
    adminKey: process.env.ADMIN_KEY || '',
    panel: process.env.PANEL_PASSWORD
      ? {
        password: process.env.PANEL_PASSWORD,
        sessionSecret: process.env.PANEL_SESSION_SECRET || process.env.PANEL_PASSWORD,
      }
      : null,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3000'}`,
    db: createSqliteAdapter(sqlite),
    artifacts,
  }

  return cachedServices
}
