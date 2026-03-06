import { sha256Hex } from '../lib/utils'
import type { ArtifactStore, PutArtifactResult, StoredArtifact } from './types'

export class R2ArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: R2Bucket) {}

  async putJson(key: string, data: unknown): Promise<PutArtifactResult> {
    const body = JSON.stringify(data, null, 2)
    const etag = await sha256Hex(body)
    await this.bucket.put(key, body, {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
      },
      customMetadata: {
        sha256: etag,
      },
    })
    return { key, etag }
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const object = await this.bucket.get(key)
    if (!object) return null
    return {
      key,
      body: await object.text(),
      contentType: object.httpMetadata?.contentType || 'application/json; charset=utf-8',
      etag: object.customMetadata?.sha256 || object.httpEtag || '',
    }
  }
}
