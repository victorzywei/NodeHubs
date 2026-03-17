import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { sha256Hex } from '../lib/utils'
import type { ArtifactStore, PutArtifactResult, StoredArtifact } from './types'

function resolveArtifactPath(baseDir: string, key: string): string {
  const segments = key.split(/[\\/]+/).filter(Boolean)
  const filePath = resolve(baseDir, ...segments)
  const relativePath = relative(baseDir, filePath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Invalid artifact key: ${key}`)
  }
  return filePath
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly baseDir: string) {
    mkdirSync(this.baseDir, { recursive: true })
  }

  async putJson(key: string, data: unknown): Promise<PutArtifactResult> {
    const body = JSON.stringify(data, null, 2)
    const etag = await sha256Hex(body)
    const filePath = resolveArtifactPath(this.baseDir, key)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, body, 'utf8')
    return { key, etag }
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const filePath = resolveArtifactPath(this.baseDir, key)
    if (!existsSync(filePath)) return null

    const body = readFileSync(filePath, 'utf8')
    return {
      key,
      body,
      contentType: 'application/json; charset=utf-8',
      etag: await sha256Hex(body),
    }
  }
}
