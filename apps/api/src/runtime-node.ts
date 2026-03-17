import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_VERSION } from './lib/constants'
import type { AppServices } from './lib/app-types'
import type { SqlAdapter, SqlValue } from './lib/db'
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

function shouldIgnoreMigrationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('duplicate column name')
}

function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function applyMigrations(db: DatabaseSyncInstance): void {
  const migrationDir = resolveApiMigrationsDir()
  const migrationFiles = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const migrationFile of migrationFiles) {
    const migrationPath = resolve(migrationDir, migrationFile)
    const sqlText = readFileSync(migrationPath, 'utf8')
    const statements = splitSqlStatements(sqlText)
    for (const statement of statements) {
      try {
        db.exec(`${statement};`)
      } catch (error) {
        if (shouldIgnoreMigrationError(error)) continue
        throw error
      }
    }
  }
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
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3000'}`,
    db: createSqliteAdapter(sqlite),
    artifacts,
  }

  return cachedServices
}
