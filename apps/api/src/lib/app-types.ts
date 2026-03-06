import type { ArtifactStore } from '../storage/types'
import type { SqlAdapter } from './db'
import type { RuntimeCatalog } from '../services/runtime-catalog'

export interface AppServices {
  appVersion: string
  mode: 'cloudflare' | 'docker'
  dbDriver: 'd1' | 'sqlite'
  artifactDriver: 'r2' | 'minio'
  adminKey: string
  publicBaseUrl: string
  db: SqlAdapter
  artifacts: ArtifactStore
  runtimeCatalog: RuntimeCatalog
}
