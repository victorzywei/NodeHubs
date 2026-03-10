import { APP_VERSION } from './lib/constants'
import type { AppServices } from './lib/app-types'
import type { SqlAdapter } from './lib/db'
import { R2ArtifactStore } from './storage/r2-store'

export interface WorkerBindings {
  DB: D1Database
  ARTIFACTS: R2Bucket
  ASSETS?: Fetcher
  ADMIN_KEY: string
  PUBLIC_BASE_URL?: string
}

function createD1Adapter(db: D1Database): SqlAdapter {
  return {
    async exec(sqlText) {
      await db.exec(sqlText)
    },
    async run(sqlText, params = []) {
      await db.prepare(sqlText).bind(...params).run()
    },
    async get(sqlText, params = []) {
      const row = await db.prepare(sqlText).bind(...params).first<Record<string, unknown>>()
      return (row ?? null) as never
    },
    async all(sqlText, params = []) {
      const rows = await db.prepare(sqlText).bind(...params).all<Record<string, unknown>>()
      return ((rows.results ?? []) as never)
    },
  }
}

export function getWorkerServices(bindings: WorkerBindings, requestUrl: string): AppServices {
  return {
    appVersion: APP_VERSION,
    mode: 'cloudflare',
    dbDriver: 'd1',
    artifactDriver: 'r2',
    adminKey: String(bindings.ADMIN_KEY || ''),
    publicBaseUrl: String(bindings.PUBLIC_BASE_URL || new URL(requestUrl).origin),
    db: createD1Adapter(bindings.DB),
    artifacts: new R2ArtifactStore(bindings.ARTIFACTS),
  }
}
