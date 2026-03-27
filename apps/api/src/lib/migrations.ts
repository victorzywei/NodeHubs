import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSyncInstance } from './node-sqlite'

export function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

export function applySqliteMigrations(db: DatabaseSyncInstance, migrationDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedRows = db.prepare(
    'SELECT filename FROM schema_migrations ORDER BY filename ASC',
  ).all() as Array<{ filename?: unknown }>

  const applied = new Set(
    appliedRows
      .map((row) => String(row.filename || '').trim())
      .filter(Boolean),
  )

  const migrationFiles = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) continue

    const migrationPath = resolve(migrationDir, migrationFile)
    const sqlText = readFileSync(migrationPath, 'utf8')
    const statements = splitSqlStatements(sqlText)

    db.exec('BEGIN')
    try {
      for (const statement of statements) {
        db.exec(`${statement};`)
      }
      db.prepare(
        'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
      ).run(migrationFile, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
