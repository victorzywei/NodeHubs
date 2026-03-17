import { describe, expect, it } from 'vitest'
import { DatabaseSync } from './node-sqlite'

describe('node sqlite loader', () => {
  it('loads DatabaseSync from the Node builtin module', () => {
    expect(typeof DatabaseSync).toBe('function')
  })
})
