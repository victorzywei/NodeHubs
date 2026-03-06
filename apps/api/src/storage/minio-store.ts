import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { sha256Hex } from '../lib/utils'
import type { ArtifactStore, PutArtifactResult, StoredArtifact } from './types'

async function bodyToText(body: unknown): Promise<string> {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof Readable) {
    const chunks: Uint8Array[] = []
    for await (const chunk of body) {
      if (typeof chunk === 'string') {
        chunks.push(new TextEncoder().encode(chunk))
        continue
      }
      if (chunk instanceof Uint8Array) {
        chunks.push(chunk)
      }
    }
    const total = chunks.reduce((sum, item) => sum + item.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return new TextDecoder().decode(out)
  }
  return ''
}

export class MinioArtifactStore implements ArtifactStore {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    options: {
      endpoint: string
      region: string
      accessKeyId: string
      secretAccessKey: string
    },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      forcePathStyle: true,
    })
  }

  async putJson(key: string, data: unknown): Promise<PutArtifactResult> {
    const body = JSON.stringify(data, null, 2)
    const etag = await sha256Hex(body)
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
      Metadata: {
        sha256: etag,
      },
    }))
    return { key, etag }
  }

  async get(key: string): Promise<StoredArtifact | null> {
    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }))
      return {
        key,
        body: await bodyToText(output.Body),
        contentType: output.ContentType || 'application/json; charset=utf-8',
        etag: output.Metadata?.sha256 || '',
      }
    } catch {
      return null
    }
  }
}
