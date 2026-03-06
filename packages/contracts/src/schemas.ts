import { z } from 'zod'

export const nodeKindSchema = z.enum(['vps', 'edge'])

export const createNodeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nodeType: nodeKindSchema,
  region: z.string().trim().max(120).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  networkType: z.enum(['public', 'noPublicIp']).default('public'),
  primaryDomain: z.string().trim().max(255).default(''),
  backupDomain: z.string().trim().max(255).default(''),
  entryIp: z.string().trim().max(255).default(''),
  githubMirrorUrl: z.string().trim().max(500).default(''),
  warpLicenseKey: z.string().trim().max(255).default(''),
  cfDnsToken: z.string().trim().max(500).default(''),
  argoTunnelToken: z.string().trim().max(500).default(''),
  argoTunnelDomain: z.string().trim().max(255).default(''),
  argoTunnelPort: z.number().int().min(1).max(65535).default(2053),
  installWarp: z.boolean().default(false),
  installArgo: z.boolean().default(false),
})

export const updateNodeSchema = createNodeSchema.partial().extend({
  bytesInTotal: z.number().nonnegative().optional(),
  bytesOutTotal: z.number().nonnegative().optional(),
  currentConnections: z.number().int().nonnegative().optional(),
  cpuUsagePercent: z.number().min(0).max(100).nullable().optional(),
  memoryUsagePercent: z.number().min(0).max(100).nullable().optional(),
  protocolRuntimeVersion: z.string().trim().max(64).optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
})

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  engine: z.enum(['sing-box', 'xray']),
  protocol: z.string().trim().min(1).max(80),
  transport: z.string().trim().min(1).max(80),
  tlsMode: z.enum(['none', 'tls', 'reality']),
  defaults: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(1000).default(''),
})

export const updateTemplateSchema = createTemplateSchema.partial()

export const createSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  visibleNodeIds: z.array(z.string().trim().min(1)).default([]),
})

export const subscriptionDocumentFormatSchema = z.enum(['plain', 'base64', 'json', 'v2ray', 'clash', 'singbox'])

export const publishNodeSchema = z.object({
  kind: z.enum(['runtime', 'bootstrap']).default('runtime'),
  templateIds: z.array(z.string().trim().min(1)).default([]),
  message: z.string().trim().max(1000).default(''),
})

export const heartbeatSchema = z.object({
  nodeId: z.string().trim().min(1),
  bytesInTotal: z.number().nonnegative(),
  bytesOutTotal: z.number().nonnegative(),
  currentConnections: z.number().int().nonnegative(),
  cpuUsagePercent: z.number().min(0).max(100).nullable().default(null),
  memoryUsagePercent: z.number().min(0).max(100).nullable().default(null),
  protocolRuntimeVersion: z.string().trim().max(64).default(''),
})

export type CreateNodeInput = z.infer<typeof createNodeSchema>
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>
export type PublishNodeInput = z.infer<typeof publishNodeSchema>
export type HeartbeatInput = z.infer<typeof heartbeatSchema>
export type SubscriptionDocumentFormatInput = z.infer<typeof subscriptionDocumentFormatSchema>
