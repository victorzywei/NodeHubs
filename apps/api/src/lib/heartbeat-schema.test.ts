import { describe, expect, it } from 'vitest'
import { heartbeatSchema } from '@contracts/index'

describe('heartbeat schema', () => {
  it('accepts legacy agents that send a null warpReserved field', () => {
    const parsed = heartbeatSchema.safeParse({
      nodeId: 'node_1',
      bytesInTotal: 0,
      bytesOutTotal: 0,
      currentConnections: 0,
      cpuUsagePercent: null,
      memoryUsagePercent: null,
      warpStatus: 'not_installed',
      warpIpv6: '',
      warpEndpoint: '',
      warpPrivateKey: '',
      warpReserved: null,
      argoStatus: 'running',
      argoDomain: 'example.trycloudflare.com',
      storageTotalBytes: 1,
      storageUsedBytes: 1,
      storageUsagePercent: 100,
      protocolRuntimeVersion: '',
    })

    expect(parsed.success).toBe(true)
  })
})
