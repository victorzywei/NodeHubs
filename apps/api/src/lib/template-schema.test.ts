import { describe, expect, it } from 'vitest'
import { createTemplateSchema, updateTemplateSchema } from '@contracts/index'

describe('template schema validation', () => {
  it('accepts valid full template payloads', () => {
    const parsed = createTemplateSchema.safeParse({
      name: 'VLESS Reality',
      engine: 'xray',
      protocol: 'vless',
      transport: 'tcp',
      tlsMode: 'reality',
      defaults: {},
      notes: '',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts wireguard templates on sing-box', () => {
    const parsed = createTemplateSchema.safeParse({
      name: 'WireGuard',
      engine: 'sing-box',
      protocol: 'wireguard',
      transport: 'wireguard',
      tlsMode: 'none',
      defaults: {},
      notes: '',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid combinations', () => {
    const parsed = createTemplateSchema.safeParse({
      name: 'Invalid',
      engine: 'xray',
      protocol: 'hysteria2',
      transport: 'hysteria2',
      tlsMode: 'tls',
      defaults: { password: 'replace-me' },
      notes: '',
    })
    expect(parsed.success).toBe(false)
  })

  it('allows partial update payloads without forcing unrelated fields', () => {
    const parsed = updateTemplateSchema.safeParse({
      notes: 'metadata only update',
    })
    expect(parsed.success).toBe(true)
  })
})
