import { z } from 'zod'

function validateTemplateCombination(
  input: {
    engine?: 'sing-box' | 'xray'
    protocol?: string
    transport?: string
    tlsMode?: 'none' | 'tls' | 'reality'
  },
  ctx: z.RefinementCtx,
) {
  if (!input.engine || !input.protocol || !input.transport || !input.tlsMode) {
    return
  }
  const protocol = input.protocol.trim().toLowerCase()
  const transport = input.transport.trim().toLowerCase()

  if (protocol === 'hysteria2') {
    if (input.engine !== 'sing-box') {
      ctx.addIssue({
        code: 'custom',
        path: ['engine'],
        message: 'Hysteria2 templates require the sing-box engine',
      })
    }
    if (transport !== 'hysteria2') {
      ctx.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'Hysteria2 templates must use the hysteria2 transport',
      })
    }
    if (input.tlsMode !== 'tls') {
      ctx.addIssue({
        code: 'custom',
        path: ['tlsMode'],
        message: 'Hysteria2 templates must use TLS mode',
      })
    }
  }

  if (transport === 'hysteria2' && protocol !== 'hysteria2') {
    ctx.addIssue({
      code: 'custom',
      path: ['transport'],
      message: 'The hysteria2 transport can only be used with the hysteria2 protocol',
    })
  }

  if (protocol === 'shadowsocks') {
    if (input.tlsMode !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['tlsMode'],
        message: 'Shadowsocks templates must use no TLS mode',
      })
    }
    if (transport !== 'tcp') {
      ctx.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'Shadowsocks templates must use the tcp transport',
      })
    }
  }

  if (input.tlsMode === 'reality') {
    if (protocol !== 'vless') {
      ctx.addIssue({
        code: 'custom',
        path: ['protocol'],
        message: 'Reality mode is only supported for VLESS templates',
      })
    }
    if (transport !== 'tcp') {
      ctx.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'Reality mode requires the tcp transport',
      })
    }
  }
}

export const nodeKindSchema = z.enum(['vps', 'edge'])

const nodeSchemaBase = z.object({
  name: z.string().trim().min(1).max(120),
  nodeType: nodeKindSchema,
  region: z.string().trim().max(120).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  networkType: z.enum(['public', 'noPublicIp']).default('public'),
  primaryDomain: z.string().trim().max(255).default(''),
  backupDomain: z.string().trim().max(255).default(''),
  entryIp: z.string().trim().max(255).default(''),
  githubMirrorUrl: z.string().trim().max(500).default(''),
  cfDnsToken: z.string().trim().max(500).default(''),
  argoTunnelToken: z.string().trim().max(500).default(''),
  argoTunnelDomain: z.string().trim().max(255).default(''),
  argoTunnelPort: z.number().int().min(1).max(65535).default(2053),
})

export const createNodeSchema = nodeSchemaBase.superRefine((input, ctx) => {
  if (input.networkType === 'public' && !input.primaryDomain.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['primaryDomain'],
      message: 'Public-IP nodes require a primary domain for certificate bootstrap',
    })
  }
})

export const updateNodeSchema = nodeSchemaBase.partial().extend({
  bytesInTotal: z.number().nonnegative().optional(),
  bytesOutTotal: z.number().nonnegative().optional(),
  currentConnections: z.number().int().nonnegative().optional(),
  cpuUsagePercent: z.number().min(0).max(100).nullable().optional(),
  memoryUsagePercent: z.number().min(0).max(100).nullable().optional(),
  warpStatus: z.string().trim().max(120).optional(),
  warpIpv6: z.string().trim().max(255).optional(),
  warpEndpoint: z.string().trim().max(255).optional(),
  warpPrivateKey: z.string().trim().max(255).optional(),
  warpReserved: z.array(z.number().int().min(0).max(255)).length(3).optional(),
  argoStatus: z.string().trim().max(120).optional(),
  argoDomain: z.string().trim().max(255).optional(),
  storageTotalBytes: z.number().nonnegative().optional(),
  storageUsedBytes: z.number().nonnegative().optional(),
  storageUsagePercent: z.number().min(0).max(100).nullable().optional(),
  protocolRuntimeVersion: z.string().trim().max(64).optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
})

const templateSchemaBase = z.object({
  name: z.string().trim().min(1).max(120),
  engine: z.enum(['sing-box', 'xray']),
  protocol: z.string().trim().min(1).max(80),
  transport: z.string().trim().min(1).max(80),
  tlsMode: z.enum(['none', 'tls', 'reality']),
  warpExit: z.boolean().default(false),
  warpRouteMode: z.enum(['all', 'ipv4', 'ipv6']).default('all'),
  defaults: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(1000).default(''),
})

export const createTemplateSchema = templateSchemaBase.superRefine(validateTemplateCombination)

export const updateTemplateSchema = templateSchemaBase.partial().superRefine(validateTemplateCombination)

export const createSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  visibleNodeIds: z.array(z.string().trim().min(1)).default([]),
})

export const updateSubscriptionSchema = createSubscriptionSchema.partial()

export const subscriptionDocumentFormatSchema = z.enum(['plain', 'base64', 'json', 'v2ray', 'clash', 'singbox'])

export const bootstrapOptionsSchema = z.object({
  installWarp: z.boolean().default(false),
  warpLicenseKey: z.string().trim().max(255).default(''),
  heartbeatIntervalSeconds: z.number().int().min(5).max(3600).default(15),
  versionPullIntervalSeconds: z.number().int().min(5).max(3600).default(15),
  installSingBox: z.boolean().default(false),
  installXray: z.boolean().default(false),
})

export const publishNodeSchema = z.object({
  kind: z.enum(['runtime', 'bootstrap']).default('runtime'),
  templateIds: z.array(z.string().trim().min(1)).default([]),
  message: z.string().trim().max(1000).default(''),
  bootstrapOptions: bootstrapOptionsSchema.default({
    installWarp: false,
    warpLicenseKey: '',
    heartbeatIntervalSeconds: 15,
    versionPullIntervalSeconds: 15,
    installSingBox: false,
    installXray: false,
  }),
}).superRefine((input, ctx) => {
  if (input.kind === 'runtime' && input.templateIds.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['templateIds'],
      message: 'Runtime releases require at least one template',
    })
  }
})

export const heartbeatSchema = z.object({
  nodeId: z.string().trim().min(1),
  bytesInTotal: z.number().nonnegative(),
  bytesOutTotal: z.number().nonnegative(),
  currentConnections: z.number().int().nonnegative(),
  heartbeatIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  versionPullIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  cpuUsagePercent: z.number().min(0).max(100).nullable().default(null),
  memoryUsagePercent: z.number().min(0).max(100).nullable().default(null),
  warpStatus: z.string().trim().max(120).optional(),
  warpIpv6: z.string().trim().max(255).optional(),
  warpEndpoint: z.string().trim().max(255).optional(),
  warpPrivateKey: z.string().trim().max(255).optional(),
  warpReserved: z.array(z.number().int().min(0).max(255)).length(3).optional(),
  argoStatus: z.string().trim().max(120).optional(),
  argoDomain: z.string().trim().max(255).optional(),
  storageTotalBytes: z.number().nonnegative().optional(),
  storageUsedBytes: z.number().nonnegative().optional(),
  storageUsagePercent: z.number().min(0).max(100).nullable().optional(),
  protocolRuntimeVersion: z.string().trim().max(64).default(''),
})

export type CreateNodeInput = z.infer<typeof createNodeSchema>
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>
export type PublishNodeInput = z.infer<typeof publishNodeSchema>
export type HeartbeatInput = z.infer<typeof heartbeatSchema>
export type SubscriptionDocumentFormatInput = z.infer<typeof subscriptionDocumentFormatSchema>
