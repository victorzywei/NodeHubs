export interface StoredArtifact {
  key: string
  body: string
  contentType: string
  etag: string
}

export interface PutArtifactResult {
  key: string
  etag: string
}

export interface ArtifactStore {
  putJson(key: string, data: unknown): Promise<PutArtifactResult>
  get(key: string): Promise<StoredArtifact | null>
}
