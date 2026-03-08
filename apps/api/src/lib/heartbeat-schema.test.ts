import { describe, expect, it } from 'vitest'
import { heartbeatSchema } from '@contracts/index'

describe('heartbeat schema', () => {
  it('accepts legacy agents that send a null warpReserved field', () => {
    const parsed = heartbeatSchema.safeParse({
      nodeId: 'node_1',
      bytesInTotal: 0,
      bytesOutTotal: 0,
      currentConnections: 0,
      cpuCoreCount: 8,
      cpuUsagePercent: null,
      memoryTotalBytes: 16,
      memoryUsedBytes: 8,
      memoryUsagePercent: null,
      warpStatus: 'not_installed',
      warpIpv4: '172.16.0.2/32',
      warpIpv6: '',
      warpEndpoint: '',
      warpAccountType: 'Unlimited',
      warpTunnelProtocol: 'MASQUE',
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
