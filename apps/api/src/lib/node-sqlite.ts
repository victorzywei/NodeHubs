import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'

type NodeSqliteModule = {
  DatabaseSync: typeof NodeDatabaseSync
}

type ProcessWithBuiltinModule = NodeJS.Process & {
  getBuiltinModule?: (id: string) => unknown
}

export type DatabaseSyncInstance = NodeDatabaseSync

export function getNodeSqliteModule(): NodeSqliteModule {
  const builtinLoader = (process as ProcessWithBuiltinModule).getBuiltinModule
  if (typeof builtinLoader === 'function') {
    const sqliteModule = builtinLoader('node:sqlite') as Partial<NodeSqliteModule> | undefined
    if (sqliteModule?.DatabaseSync) {
      return sqliteModule as NodeSqliteModule
    }
  }
  throw new Error('node:sqlite is unavailable. Use Node.js 22.5+ or newer.')
}

export const DatabaseSync = getNodeSqliteModule().DatabaseSync
