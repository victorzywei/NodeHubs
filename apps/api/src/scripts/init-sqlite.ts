import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from '../lib/node-sqlite'
import { resolveApiMigrationsDir, resolveApiStoragePath } from '../lib/runtime-paths'

const dbPath = process.env.SQLITE_FILE || resolveApiStoragePath('dev.db')
const migrationDir = resolveApiMigrationsDir()

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
for (const migrationFile of readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b))) {
  const sqlText = readFileSync(resolve(migrationDir, migrationFile), 'utf8')
  const statements = sqlText.split(';').map((statement) => statement.trim()).filter(Boolean)
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

console.log(`Initialized SQLite database at ${dbPath}`)
