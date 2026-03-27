import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applySqliteMigrations } from '../lib/migrations'
import { DatabaseSync } from '../lib/node-sqlite'
import { resolveApiMigrationsDir, resolveApiStoragePath } from '../lib/runtime-paths'

const dbPath = process.env.SQLITE_FILE || resolveApiStoragePath('dev.db')
const migrationDir = resolveApiMigrationsDir()

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
applySqliteMigrations(db, migrationDir)

console.log(`Initialized SQLite database at ${dbPath}`)
