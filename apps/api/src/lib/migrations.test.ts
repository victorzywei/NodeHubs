import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from './node-sqlite'
import { applySqliteMigrations } from './migrations'

const cleanupPaths: string[] = []

describe('sqlite migrations', () => {
  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop()
      if (target) {
        try {
          rmSync(target, { recursive: true, force: true })
        } catch {
          // Ignore cleanup failures in tests.
        }
      }
    }
  })

  it('applies each migration file only once', () => {
    const migrationDir = mkdtempSync(join(tmpdir(), 'nodehubsapi-migrations-'))
    cleanupPaths.push(migrationDir)

    writeFileSync(
      join(migrationDir, '0001_init.sql'),
      'CREATE TABLE test_items (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
      'utf8',
    )
    writeFileSync(
      join(migrationDir, '0002_seed.sql'),
      "INSERT INTO test_items (id, name) VALUES ('one', 'first');",
      'utf8',
    )

    const db = new DatabaseSync(':memory:')

    applySqliteMigrations(db, migrationDir)
    applySqliteMigrations(db, migrationDir)

    const items = db.prepare('SELECT id, name FROM test_items ORDER BY id ASC').all() as Array<{
      id: string
      name: string
    }>
    const applied = db.prepare('SELECT filename FROM schema_migrations ORDER BY filename ASC').all() as Array<{
      filename: string
    }>

    expect(items).toEqual([{ id: 'one', name: 'first' }])
    expect(applied.map((row) => row.filename)).toEqual(['0001_init.sql', '0002_seed.sql'])
  })
})
