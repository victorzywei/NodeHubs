import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.env.SQLITE_FILE || resolve(process.cwd(), 'apps/api/storage/dev.db')
const migrationPath = resolve(process.cwd(), 'apps/api/migrations/0001_init.sql')

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec(readFileSync(migrationPath, 'utf8'))

console.log(`Initialized SQLite database at ${dbPath}`)
