import { describe, expect, it } from 'vitest'
import { createId, parseJsonObject, sha256Hex } from './utils'

describe('utils', () => {
  it('creates prefixed ids', () => {
    expect(createId('node')).toMatch(/^node_[a-f0-9]{16}$/)
  })

  it('parses json objects with fallback', () => {
    expect(parseJsonObject('{"ok":true}', { ok: false })).toEqual({ ok: true })
    expect(parseJsonObject('{oops}', { ok: false })).toEqual({ ok: false })
  })

  it('hashes strings deterministically', async () => {
    await expect(sha256Hex('nodehubsapi')).resolves.toHaveLength(64)
    await expect(sha256Hex('nodehubsapi')).resolves.toBe(await sha256Hex('nodehubsapi'))
  })
})
