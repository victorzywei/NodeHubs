import type { ArtifactStore } from '../storage/types'
import type { SqlAdapter } from './db'

export interface AppServices {
  appVersion: string
  mode: 'cloudflare' | 'docker'
  dbDriver: 'd1' | 'sqlite'
  artifactDriver: 'local' | 'r2'
  adminKey: string
  publicBaseUrl: string
  db: SqlAdapter
  artifacts: ArtifactStore
}
