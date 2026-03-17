import {
  createNodeSchema,
  isNodeOnline,
  createTemplateSchema,
} from '@contracts/index'
import type {
  CreateNodeInput,
  CreateSubscriptionInput,
  CreateTemplateInput,
  DashboardSummary,
  HeartbeatInput,
  ReleaseLogRecord,
  ReleaseArtifact,
  NodeRecord,
  PublicSubscriptionDocument,
  ReleaseKind,
  ReleasePreviewRecord,
  ReleaseRecord,
  ReleaseStatus,
  SubscriptionRecord,
  SystemStatus,
  TemplateRecord,
  TrafficSample,
  UpdateNodeInput,
  UpdateSubscriptionInput,
  UpdateTemplateInput,
} from '@contracts/index'
import type { AppServices } from '../lib/app-types'
import { APP_VERSION } from '../lib/constants'
import { createId, createToken, nowIso, parseJsonObject } from '../lib/utils'
import { buildSubscriptionEntries, parseReleaseArtifact, renderReleaseArtifact } from './release-renderer'
import { repairTemplateDefaults, repairTemplateRecord } from './template-defaults'

type NodeRow = {
  id: string
  agent_token: string
  name: string
  node_type: string
  region: string
  tags_json: string
  network_type: string
  primary_domain: string
  backup_domain: string
  entry_ip: string
  github_mirror_url: string
  warp_license_key: string
  cf_dns_token: string
  argo_tunnel_token: string
  argo_tunnel_domain: string
  argo_tunnel_port: number
  install_warp: number
  config_revision: number
  desired_release_revision: number
  current_release_revision: number
  current_release_status: string
  last_seen_at: string | null
  heartbeat_interval_seconds: number
  version_pull_interval_seconds: number
  cpu_usage_percent: number | null
  memory_usage_percent: number | null
  bytes_in_total: number
  bytes_out_total: number
  current_connections: number
  warp_status?: string
  warp_ipv4?: string
  warp_ipv6?: string
  warp_endpoint?: string
  warp_account_type?: string
  warp_tunnel_protocol?: string
  warp_private_key?: string
  warp_reserved_json?: string
  argo_status?: string
  argo_domain?: string
  permission_mode?: string
  sing_box_version?: string
  sing_box_status?: string
  xray_version?: string
  xray_status?: string
  storage_total_bytes?: number
  storage_used_bytes?: number
  storage_usage_percent?: number | null
  cpu_core_count?: number | null
  memory_total_bytes?: number
  memory_used_bytes?: number
  protocol_runtime_version: string
  created_at: string
  updated_at: string
}

type TemplateRow = {
  id: string
  name: string
  engine: string
  protocol: string
  transport: string
  tls_mode: string
  warp_exit: number
  warp_route_mode: string
  defaults_json: string
  notes: string
  created_at: string
  updated_at: string
}

type ReleaseRow = {
  id: string
  node_id: string
  kind: string
  revision: number
  status: string
  config_revision: number
  template_ids_json: string
  artifact_key: string
  artifact_sha256: string
  summary: string
  message: string
  apply_log: string
  apply_log_status: string
  apply_log_updated_at: string | null
  created_at: string
  updated_at: string
}

type SubscriptionRow = {
  id: string
  token: string
  name: string
  enabled: number
  visible_node_ids_json: string
  created_at: string
  updated_at: string
}

type CountRow = {
  value: number
}

type TotalsRow = {
  bytes_in: number
  bytes_out: number
}

const CONFIG_IMPACT_FIELDS = new Set([
  'name',
  'nodeType',
  'region',
  'tags',
  'networkType',
  'primaryDomain',
  'backupDomain',
  'entryIp',
  'githubMirrorUrl',
  'cfDnsToken',
  'argoTunnelToken',
  'argoTunnelDomain',
  'argoTunnelPort',
])
const MAX_APPLY_LOG_CHARS = 20000
const APPLY_LOG_REDACTIONS: Array<[RegExp, string]> = [
  [/(X-Agent-Token:\s*)([^\s'"]+)/gi, '$1[REDACTED]'],
  [/((?:AGENT_TOKEN|NODE_CF_DNS_TOKEN|CF_DNS_API_TOKEN|NODE_WARP_LICENSE_KEY|WARP_LICENSE_KEY|ARGO_TUNNEL_TOKEN)=)([^\r\n]+)/gi, '$1[REDACTED]'],
  [/((?:LicenseKey|CF_DNS_API_TOKEN|ARGO_TUNNEL_TOKEN)\s*[:=]\s*)([^\r\n]+)/gi, '$1[REDACTED]'],
]

function toBool(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1
}

function toNodeRecord(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    name: row.name,
    nodeType: row.node_type as NodeRecord['nodeType'],
    region: row.region,
    tags: parseJsonObject<string[]>(row.tags_json, []),
    networkType: (row.network_type as NodeRecord['networkType']) || 'public',
    primaryDomain: row.primary_domain,
    backupDomain: row.backup_domain,
    entryIp: row.entry_ip,
    githubMirrorUrl: row.github_mirror_url || '',
    installWarp: toBool(row.install_warp),
    warpLicenseKey: row.warp_license_key || '',
    cfDnsToken: row.cf_dns_token || '',
    argoTunnelToken: row.argo_tunnel_token || '',
    argoTunnelDomain: row.argo_tunnel_domain || '',
    argoTunnelPort: Number(row.argo_tunnel_port || 2053),
    configRevision: Number(row.config_revision || 1),
    desiredReleaseRevision: Number(row.desired_release_revision || 0),
    currentReleaseRevision: Number(row.current_release_revision || 0),
    currentReleaseStatus: String(row.current_release_status || 'idle') as NodeRecord['currentReleaseStatus'],
    lastSeenAt: row.last_seen_at,
    heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds || 15),
    versionPullIntervalSeconds: Number(row.version_pull_interval_seconds || 15),
    cpuUsagePercent: row.cpu_usage_percent === null ? null : Number(row.cpu_usage_percent),
    memoryUsagePercent: row.memory_usage_percent === null ? null : Number(row.memory_usage_percent),
    bytesInTotal: Number(row.bytes_in_total || 0),
    bytesOutTotal: Number(row.bytes_out_total || 0),
    currentConnections: Number(row.current_connections || 0),
    warpStatus: row.warp_status || '',
    warpIpv4: row.warp_ipv4 || '',
    warpIpv6: row.warp_ipv6 || '',
    warpEndpoint: row.warp_endpoint || '',
    warpAccountType: row.warp_account_type || '',
    warpTunnelProtocol: row.warp_tunnel_protocol || '',
    warpPrivateKey: row.warp_private_key || '',
    warpReserved: parseJsonObject<number[]>(row.warp_reserved_json || '[]', []),
    argoStatus: row.argo_status || '',
    argoDomain: row.argo_domain || '',
    permissionMode: row.permission_mode === 'root' || row.permission_mode === 'user' ? row.permission_mode : undefined,
    singBoxVersion: row.sing_box_version || '',
    singBoxStatus: row.sing_box_status || '',
    xrayVersion: row.xray_version || '',
    xrayStatus: row.xray_status || '',
    storageTotalBytes: Number(row.storage_total_bytes || 0),
    storageUsedBytes: Number(row.storage_used_bytes || 0),
    storageUsagePercent: row.storage_usage_percent === null || row.storage_usage_percent === undefined
      ? null
      : Number(row.storage_usage_percent),
    cpuCoreCount: row.cpu_core_count === null || row.cpu_core_count === undefined
      ? null
      : Number(row.cpu_core_count),
    memoryTotalBytes: Number(row.memory_total_bytes || 0),
    memoryUsedBytes: Number(row.memory_used_bytes || 0),
    protocolRuntimeVersion: row.protocol_runtime_version || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeIntervalSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(5, Math.min(3600, Math.trunc(parsed)))
}

function toTemplateRecord(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine as TemplateRecord['engine'],
    protocol: row.protocol,
    transport: row.transport,
    tlsMode: row.tls_mode as TemplateRecord['tlsMode'],
    warpExit: toBool(row.warp_exit),
    warpRouteMode: row.warp_route_mode === 'ipv4' || row.warp_route_mode === 'ipv6' ? row.warp_route_mode : 'all',
    defaults: parseJsonObject<Record<string, unknown>>(row.defaults_json, {}),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseTemplateInput(input: CreateTemplateInput): CreateTemplateInput {
  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'invalid template body')
  }
  return {
    ...parsed.data,
    defaults: repairTemplateDefaults(parsed.data),
  }
}

function parseNodeInput(input: CreateNodeInput): CreateNodeInput {
  const parsed = createNodeSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'invalid node body')
  }
  return parsed.data
}

function toReleaseRecord(row: ReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind as ReleaseKind,
    revision: Number(row.revision || 0),
    status: row.status as ReleaseStatus,
    configRevision: Number(row.config_revision || 0),
    templateIds: parseJsonObject<string[]>(row.template_ids_json, []),
    artifactKey: row.artifact_key,
    artifactSha256: row.artifact_sha256,
    summary: row.summary,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toReleaseLogRecord(row: ReleaseRow): ReleaseLogRecord {
  return {
    ...toReleaseRecord(row),
    applyLog: row.apply_log || '',
    applyLogStatus: (row.apply_log_status || '') as ReleaseLogRecord['applyLogStatus'],
    applyLogUpdatedAt: row.apply_log_updated_at,
  }
}

function sanitizeApplyLog(input: string): string {
  let value = String(input || '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  for (const [pattern, replacement] of APPLY_LOG_REDACTIONS) {
    value = value.replace(pattern, replacement)
  }
  if (value.length > MAX_APPLY_LOG_CHARS) {
    value = `${value.slice(0, MAX_APPLY_LOG_CHARS)}\n...[truncated]`
  }
  return value
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    enabled: toBool(row.enabled),
    visibleNodeIds: parseJsonObject<string[]>(row.visible_node_ids_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function summarizeRelease(templateIds: string[], message: string): string {
  const templates = templateIds.length > 0 ? `templates=${templateIds.join(',')}` : 'templates=none'
  return ['template update', templates, message || 'no-message'].join(' | ')
}

function determineNodeImpact(input: UpdateNodeInput): boolean {
  return Object.keys(input).some((key) => CONFIG_IMPACT_FIELDS.has(key))
}

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

async function normalizeVisibleNodeIds(services: AppServices, values: string[] | undefined): Promise<string[]> {
  const requestedIds = uniqueIds(values || [])
  if (requestedIds.length === 0) return []
  const rows = await Promise.all(requestedIds.map((nodeId) => getNodeRow(services, nodeId)))
  return requestedIds.filter((_, index) => Boolean(rows[index]))
}

async function getNodeRow(services: AppServices, nodeId: string): Promise<NodeRow | null> {
  return services.db.get<NodeRow>('SELECT * FROM nodes WHERE id = ?', [nodeId])
}

async function getTemplateRow(services: AppServices, templateId: string): Promise<TemplateRow | null> {
  return services.db.get<TemplateRow>('SELECT * FROM templates WHERE id = ?', [templateId])
}

async function getTemplateRows(services: AppServices, templateIds: string[]): Promise<TemplateRow[]> {
  const uniqueTemplateIds = uniqueIds(templateIds)
  const rows = await Promise.all(uniqueTemplateIds.map((templateId) => getTemplateRow(services, templateId)))
  return rows.filter((row): row is TemplateRow => Boolean(row))
}

async function getReleaseRow(services: AppServices, releaseId: string): Promise<ReleaseRow | null> {
  return services.db.get<ReleaseRow>('SELECT * FROM releases WHERE id = ?', [releaseId])
}

async function getSubscriptionRowByToken(services: AppServices, token: string): Promise<SubscriptionRow | null> {
  return services.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE token = ? AND enabled = 1', [token])
}

export async function listNodes(services: AppServices): Promise<NodeRecord[]> {
  const rows = await services.db.all<NodeRow>('SELECT * FROM nodes ORDER BY updated_at DESC')
  return rows.map(toNodeRecord)
}

export async function getNodeById(services: AppServices, nodeId: string): Promise<NodeRecord | null> {
  const row = await getNodeRow(services, nodeId)
  return row ? toNodeRecord(row) : null
}

export async function deleteNode(services: AppServices, nodeId: string): Promise<boolean> {
  const current = await getNodeRow(services, nodeId)
  if (!current) return false

  await services.db.run('DELETE FROM traffic_samples WHERE node_id = ?', [nodeId])
  await services.db.run('DELETE FROM releases WHERE node_id = ?', [nodeId])
  await services.db.run('DELETE FROM nodes WHERE id = ?', [nodeId])

  const subscriptions = await services.db.all<Pick<SubscriptionRow, 'id' | 'visible_node_ids_json'>>(
    'SELECT id, visible_node_ids_json FROM subscriptions',
  )
  const updatedAt = nowIso()
  for (const subscription of subscriptions) {
    const visibleNodeIds = parseJsonObject<string[]>(subscription.visible_node_ids_json, [])
    if (!visibleNodeIds.includes(nodeId)) continue
    const nextVisibleNodeIds = visibleNodeIds.filter((visibleNodeId) => visibleNodeId !== nodeId)
    await services.db.run(
      'UPDATE subscriptions SET visible_node_ids_json = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(nextVisibleNodeIds), updatedAt, subscription.id],
    )
  }

  return true
}

export async function createNode(services: AppServices, input: CreateNodeInput): Promise<NodeRecord> {
  const nextNode = parseNodeInput(input)
  const id = createId('node')
  const now = nowIso()
  const installWarp = nextNode.installWarp === true ? 1 : 0
  const warpLicenseKey = installWarp ? nextNode.warpLicenseKey.trim() : ''
  const heartbeatIntervalSeconds = normalizeIntervalSeconds(nextNode.heartbeatIntervalSeconds, 15)
  const versionPullIntervalSeconds = normalizeIntervalSeconds(nextNode.versionPullIntervalSeconds, 15)
  await services.db.run(
    `INSERT INTO nodes (
      id, agent_token, name, node_type, region, tags_json, network_type, primary_domain, backup_domain, entry_ip,
      github_mirror_url, warp_license_key, cf_dns_token, argo_tunnel_token, argo_tunnel_domain, argo_tunnel_port,
      install_warp, config_revision, desired_release_revision,
       current_release_revision, current_release_status, heartbeat_interval_seconds, version_pull_interval_seconds, bytes_in_total, bytes_out_total,
       current_connections, warp_status, warp_ipv4, warp_ipv6, warp_endpoint, warp_account_type, warp_tunnel_protocol, warp_private_key,
       warp_reserved_json, argo_status, argo_domain,
       storage_total_bytes, storage_used_bytes, storage_usage_percent, cpu_core_count, memory_total_bytes, memory_used_bytes,
       permission_mode, sing_box_version, sing_box_status, xray_version, xray_status, protocol_runtime_version, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )`,
    [
      id,
      createToken(),
      nextNode.name,
      nextNode.nodeType,
      nextNode.region,
      JSON.stringify(nextNode.tags),
      nextNode.networkType,
      nextNode.primaryDomain,
      nextNode.backupDomain,
      nextNode.entryIp,
      nextNode.githubMirrorUrl,
      warpLicenseKey,
      nextNode.cfDnsToken,
      nextNode.argoTunnelToken,
      nextNode.argoTunnelDomain,
      nextNode.argoTunnelPort,
      installWarp,
      1,
      0,
      0,
      'idle',
      heartbeatIntervalSeconds,
      versionPullIntervalSeconds,
      0,
      0,
      0,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '[]',
      '',
      '',
      0,
      0,
      null,
      null,
      0,
      0,
      '',
      '',
      '',
      '',
      '',
      '',
      now,
      now,
    ],
  )
  const row = await getNodeRow(services, id)
  if (!row) throw new Error('failed to create node')
  return toNodeRecord(row)
}

export async function updateNode(services: AppServices, nodeId: string, input: UpdateNodeInput): Promise<NodeRecord | null> {
  const current = await getNodeRow(services, nodeId)
  if (!current) return null

  const nextNode = parseNodeInput({
    name: input.name ?? current.name,
    nodeType: (input.nodeType ?? current.node_type) as CreateNodeInput['nodeType'],
    region: input.region ?? current.region,
    tags: input.tags ?? parseJsonObject<string[]>(current.tags_json, []),
    networkType: (input.networkType ?? current.network_type) as CreateNodeInput['networkType'],
    primaryDomain: input.primaryDomain ?? current.primary_domain,
    backupDomain: input.backupDomain ?? current.backup_domain,
    entryIp: input.entryIp ?? current.entry_ip,
    githubMirrorUrl: input.githubMirrorUrl ?? current.github_mirror_url,
    installWarp: input.installWarp ?? toBool(current.install_warp),
    warpLicenseKey: input.warpLicenseKey ?? current.warp_license_key,
    cfDnsToken: input.cfDnsToken ?? current.cf_dns_token,
    argoTunnelToken: input.argoTunnelToken ?? current.argo_tunnel_token,
    argoTunnelDomain: input.argoTunnelDomain ?? current.argo_tunnel_domain,
    argoTunnelPort: input.argoTunnelPort ?? current.argo_tunnel_port,
    heartbeatIntervalSeconds: input.heartbeatIntervalSeconds ?? current.heartbeat_interval_seconds,
    versionPullIntervalSeconds: input.versionPullIntervalSeconds ?? current.version_pull_interval_seconds,
  })
  const configChanged = determineNodeImpact(input)
  const nextConfigRevision = configChanged
    ? Number(current.config_revision || 1) + 1
    : Number(current.config_revision || 1)
  const installWarp = nextNode.installWarp === true ? 1 : 0
  const warpLicenseKey = installWarp ? nextNode.warpLicenseKey.trim() : ''
  const heartbeatIntervalSeconds = normalizeIntervalSeconds(nextNode.heartbeatIntervalSeconds, 15)
  const versionPullIntervalSeconds = normalizeIntervalSeconds(nextNode.versionPullIntervalSeconds, 15)

  await services.db.run(
    `UPDATE nodes
     SET name = ?, node_type = ?, region = ?, tags_json = ?, network_type = ?, primary_domain = ?, backup_domain = ?, entry_ip = ?,
         github_mirror_url = ?, warp_license_key = ?, cf_dns_token = ?, argo_tunnel_token = ?, argo_tunnel_domain = ?, argo_tunnel_port = ?,
         install_warp = ?, bytes_in_total = ?, bytes_out_total = ?, current_connections = ?,
         cpu_usage_percent = ?, memory_usage_percent = ?, warp_status = ?, warp_ipv4 = ?, warp_ipv6 = ?, warp_endpoint = ?,
         warp_account_type = ?, warp_tunnel_protocol = ?, warp_private_key = ?, warp_reserved_json = ?,
         argo_status = ?, argo_domain = ?, storage_total_bytes = ?, storage_used_bytes = ?, storage_usage_percent = ?,
         cpu_core_count = ?, memory_total_bytes = ?, memory_used_bytes = ?,
         protocol_runtime_version = ?, last_seen_at = ?, heartbeat_interval_seconds = ?, version_pull_interval_seconds = ?,
         config_revision = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextNode.name,
      nextNode.nodeType,
      nextNode.region,
      JSON.stringify(nextNode.tags),
      nextNode.networkType,
      nextNode.primaryDomain,
      nextNode.backupDomain,
      nextNode.entryIp,
      nextNode.githubMirrorUrl,
      warpLicenseKey,
      nextNode.cfDnsToken,
      nextNode.argoTunnelToken,
      nextNode.argoTunnelDomain,
      nextNode.argoTunnelPort,
      installWarp,
      input.bytesInTotal ?? current.bytes_in_total,
      input.bytesOutTotal ?? current.bytes_out_total,
      input.currentConnections ?? current.current_connections,
      input.cpuUsagePercent ?? current.cpu_usage_percent,
      input.memoryUsagePercent ?? current.memory_usage_percent,
      input.warpStatus ?? current.warp_status ?? '',
      input.warpIpv4 ?? current.warp_ipv4 ?? '',
      input.warpIpv6 ?? current.warp_ipv6 ?? '',
      input.warpEndpoint ?? current.warp_endpoint ?? '',
      input.warpAccountType ?? current.warp_account_type ?? '',
      input.warpTunnelProtocol ?? current.warp_tunnel_protocol ?? '',
      input.warpPrivateKey ?? current.warp_private_key ?? '',
      JSON.stringify(input.warpReserved ?? parseJsonObject<number[]>(current.warp_reserved_json || '[]', [])),
      input.argoStatus ?? current.argo_status ?? '',
      input.argoDomain ?? current.argo_domain ?? '',
      input.storageTotalBytes ?? current.storage_total_bytes ?? 0,
      input.storageUsedBytes ?? current.storage_used_bytes ?? 0,
      input.storageUsagePercent ?? current.storage_usage_percent ?? null,
      input.cpuCoreCount ?? current.cpu_core_count ?? null,
      input.memoryTotalBytes ?? current.memory_total_bytes ?? 0,
      input.memoryUsedBytes ?? current.memory_used_bytes ?? 0,
      input.protocolRuntimeVersion ?? current.protocol_runtime_version,
      input.lastSeenAt ?? current.last_seen_at,
      heartbeatIntervalSeconds,
      versionPullIntervalSeconds,
      nextConfigRevision,
      nowIso(),
      nodeId,
    ],
  )

  const row = await getNodeRow(services, nodeId)
  return row ? toNodeRecord(row) : null
}

export async function listTemplates(services: AppServices): Promise<TemplateRecord[]> {
  const rows = await services.db.all<TemplateRow>('SELECT * FROM templates ORDER BY created_at ASC')
  return rows.map(toTemplateRecord)
}

async function persistRepairedTemplates(
  services: AppServices,
  templateRows: TemplateRow[],
): Promise<TemplateRecord[]> {
  const repairedTemplates: TemplateRecord[] = []

  for (const row of templateRows) {
    const currentTemplate = toTemplateRecord(row)
    const repairedTemplate = repairTemplateRecord(currentTemplate)
    repairedTemplates.push(repairedTemplate)

    if (JSON.stringify(currentTemplate.defaults) === JSON.stringify(repairedTemplate.defaults)) {
      continue
    }

    await services.db.run(
      'UPDATE templates SET defaults_json = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(repairedTemplate.defaults), nowIso(), repairedTemplate.id],
    )
  }

  return repairedTemplates
}

export async function createTemplate(services: AppServices, input: CreateTemplateInput): Promise<TemplateRecord> {
  const nextTemplate = parseTemplateInput(input)
  const id = createId('tpl')
  const now = nowIso()
  await services.db.run(
    `INSERT INTO templates (
      id, name, engine, protocol, transport, tls_mode, warp_exit, warp_route_mode, defaults_json, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      nextTemplate.name,
      nextTemplate.engine,
      nextTemplate.protocol,
      nextTemplate.transport,
      nextTemplate.tlsMode,
      nextTemplate.warpExit ? 1 : 0,
      nextTemplate.warpRouteMode,
      JSON.stringify(nextTemplate.defaults),
      nextTemplate.notes,
      now,
      now,
    ],
  )
  const row = await getTemplateRow(services, id)
  if (!row) throw new Error('failed to create template')
  return toTemplateRecord(row)
}

export async function updateTemplate(services: AppServices, templateId: string, input: UpdateTemplateInput): Promise<TemplateRecord | null> {
  const current = await getTemplateRow(services, templateId)
  if (!current) return null
  const nextTemplate = parseTemplateInput({
    name: input.name ?? current.name,
    engine: input.engine ?? (current.engine as CreateTemplateInput['engine']),
    protocol: input.protocol ?? current.protocol,
    transport: input.transport ?? current.transport,
    tlsMode: input.tlsMode ?? (current.tls_mode as CreateTemplateInput['tlsMode']),
    warpExit: input.warpExit ?? toBool(current.warp_exit),
    warpRouteMode: input.warpRouteMode ?? (current.warp_route_mode as CreateTemplateInput['warpRouteMode']),
    defaults: input.defaults ?? parseJsonObject<Record<string, unknown>>(current.defaults_json, {}),
    notes: input.notes ?? current.notes,
  })

  await services.db.run(
    `UPDATE templates
     SET name = ?, engine = ?, protocol = ?, transport = ?, tls_mode = ?, warp_exit = ?, warp_route_mode = ?, defaults_json = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextTemplate.name,
      nextTemplate.engine,
      nextTemplate.protocol,
      nextTemplate.transport,
      nextTemplate.tlsMode,
      nextTemplate.warpExit ? 1 : 0,
      nextTemplate.warpRouteMode,
      JSON.stringify(nextTemplate.defaults),
      nextTemplate.notes,
      nowIso(),
      templateId,
    ],
  )

  const row = await getTemplateRow(services, templateId)
  return row ? toTemplateRecord(row) : null
}

export async function deleteTemplate(services: AppServices, templateId: string): Promise<boolean> {
  const current = await getTemplateRow(services, templateId)
  if (!current) return false
  await services.db.run('DELETE FROM templates WHERE id = ?', [templateId])
  return true
}

export async function listSubscriptions(services: AppServices): Promise<SubscriptionRecord[]> {
  const rows = await services.db.all<SubscriptionRow>('SELECT * FROM subscriptions ORDER BY updated_at DESC')
  return rows.map(toSubscriptionRecord)
}

export async function createSubscription(services: AppServices, input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const id = createId('sub')
  const now = nowIso()
  const token = createToken()
  const visibleNodeIds = await normalizeVisibleNodeIds(services, input.visibleNodeIds)
  await services.db.run(
    `INSERT INTO subscriptions (id, token, name, enabled, visible_node_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      input.name,
      input.enabled ? 1 : 0,
      JSON.stringify(visibleNodeIds),
      now,
      now,
    ],
  )
  const row = await services.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id])
  if (!row) throw new Error('failed to create subscription')
  return toSubscriptionRecord(row)
}

export async function updateSubscription(
  services: AppServices,
  subscriptionId: string,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionRecord | null> {
  const current = await services.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId])
  if (!current) return null

  const visibleNodeIds = input.visibleNodeIds === undefined
    ? parseJsonObject<string[]>(current.visible_node_ids_json, [])
    : await normalizeVisibleNodeIds(services, input.visibleNodeIds)

  const updatedAt = nowIso()
  await services.db.run(
    `UPDATE subscriptions
     SET name = ?, enabled = ?, visible_node_ids_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0),
      JSON.stringify(visibleNodeIds),
      updatedAt,
      subscriptionId,
    ],
  )

  const row = await services.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId])
  return row ? toSubscriptionRecord(row) : null
}

export async function deleteSubscription(services: AppServices, subscriptionId: string): Promise<boolean> {
  const current = await services.db.get<SubscriptionRow>('SELECT id FROM subscriptions WHERE id = ?', [subscriptionId])
  if (!current) return false
  await services.db.run('DELETE FROM subscriptions WHERE id = ?', [subscriptionId])
  return true
}

async function reserveNodeReleaseSlot(services: AppServices, nodeId: string): Promise<{ row: NodeRow; revision: number; updatedAt: string } | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await getNodeRow(services, nodeId)
    if (!current) return null
    const desiredRevision = Number(current.desired_release_revision || 0) + 1
    const updatedAt = nowIso()
    const updated = await services.db.get<NodeRow>(
      `UPDATE nodes
       SET desired_release_revision = ?, current_release_status = ?, updated_at = ?
       WHERE id = ? AND desired_release_revision = ?
       RETURNING *`,
      [desiredRevision, 'pending', updatedAt, nodeId, current.desired_release_revision],
    )
    if (updated) {
      return {
        row: updated,
        revision: desiredRevision,
        updatedAt,
      }
    }
  }
  throw new Error('failed to reserve release revision after retries')
}

export async function publishNodeRelease(
  services: AppServices,
  nodeId: string,
  templateIds: string[],
  message: string,
): Promise<ReleaseRecord | null> {
  const node = await getNodeById(services, nodeId)
  if (!node) return null

  const uniqueTemplateIds = uniqueIds(templateIds)
  const templateRows = await getTemplateRows(services, uniqueTemplateIds)
  if (uniqueTemplateIds.length !== templateRows.length) {
    throw new Error('One or more selected templates do not exist')
  }
  if (templateRows.length === 0) {
    throw new Error('Template releases require at least one protocol template')
  }

  const reserved = await reserveNodeReleaseSlot(services, nodeId)
  if (!reserved) return null

  const releaseId = createId('rel')
  const artifactKey = `releases/${nodeId}/r${reserved.revision}.json`
  const summary = summarizeRelease(uniqueTemplateIds, message)
  const repairedTemplates = await persistRepairedTemplates(services, templateRows)

  try {
    const artifact = renderReleaseArtifact({
      releaseId,
      revision: reserved.revision,
      kind: 'runtime',
      configRevision: Number(reserved.row.config_revision || 0),
      createdAt: reserved.updatedAt,
      message,
      summary,
      node: {
        ...node,
        desiredReleaseRevision: reserved.revision,
        currentReleaseStatus: 'pending',
      },
      templates: repairedTemplates,
    })
    const stored = await services.artifacts.putJson(artifactKey, artifact)

    await services.db.run(
      `INSERT INTO releases (
        id, node_id, kind, revision, status, config_revision,
        template_ids_json, artifact_key, artifact_sha256, summary, message,
        apply_log, apply_log_status, apply_log_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseId,
        nodeId,
        'runtime',
        reserved.revision,
        'pending',
        Number(reserved.row.config_revision || 0),
        JSON.stringify(uniqueTemplateIds),
        artifactKey,
        stored.etag,
        summary,
        message,
        '',
        '',
        null,
        reserved.updatedAt,
        reserved.updatedAt,
      ],
    )
  } catch (error) {
    await services.db.run(
      `UPDATE nodes
       SET current_release_status = ?, updated_at = ?
       WHERE id = ? AND desired_release_revision = ?`,
      [
        'failed',
        nowIso(),
        nodeId,
        reserved.revision,
      ],
    )
    throw error
  }

  const row = await getReleaseRow(services, releaseId)
  return row ? toReleaseRecord(row) : null
}

export async function previewNodeRelease(
  services: AppServices,
  nodeId: string,
  templateIds: string[],
  message: string,
): Promise<ReleasePreviewRecord | null> {
  const node = await getNodeById(services, nodeId)
  if (!node) return null

  const uniqueTemplateIds = uniqueIds(templateIds)
  const templateRows = await getTemplateRows(services, uniqueTemplateIds)
  if (uniqueTemplateIds.length !== templateRows.length) {
    throw new Error('One or more selected templates do not exist')
  }
  if (templateRows.length === 0) {
    throw new Error('Template releases require at least one protocol template')
  }

  const previewRevision = Number(node.desiredReleaseRevision || 0) + 1
  const createdAt = nowIso()
  const summary = summarizeRelease(uniqueTemplateIds, message)
  const repairedTemplates = templateRows.map((row) => repairTemplateRecord(toTemplateRecord(row)))
  const artifact = renderReleaseArtifact({
    releaseId: createId('preview'),
    revision: previewRevision,
    kind: 'runtime',
    configRevision: Number(node.configRevision || 0),
    createdAt,
    message,
    summary,
    node: {
      ...node,
      desiredReleaseRevision: previewRevision,
      currentReleaseStatus: 'pending',
    },
    templates: repairedTemplates,
  })

  return {
    kind: artifact.kind,
    runtimePlans: artifact.runtimes.map((runtime) => ({
      engine: runtime.engine,
      entryConfigPath: runtime.entryConfigPath,
      files: runtime.files,
    })),
    templateIds: uniqueTemplateIds,
  }
}

function hydrateReleaseTemplates(
  templates: ReleaseArtifact['templates'],
  release: Pick<ReleaseRow, 'created_at' | 'updated_at'>,
): TemplateRecord[] {
  return templates.map((template) =>
    repairTemplateRecord({
      id: template.id,
      name: template.name,
      engine: template.engine,
      protocol: template.protocol,
      transport: template.transport,
      tlsMode: template.tlsMode,
      warpExit: template.warpExit,
      warpRouteMode: template.warpRouteMode,
      defaults: { ...(template.defaults || {}) },
      notes: '',
      createdAt: release.created_at,
      updatedAt: release.updated_at,
    }))
}

export async function listNodeReleases(services: AppServices, nodeId: string): Promise<ReleaseRecord[]> {
  const rows = await services.db.all<ReleaseRow>('SELECT * FROM releases WHERE node_id = ? ORDER BY revision DESC', [nodeId])
  return rows.map(toReleaseRecord)
}

export async function getReleaseById(services: AppServices, releaseId: string): Promise<ReleaseRow | null> {
  return getReleaseRow(services, releaseId)
}

export async function getNodeReleaseLog(
  services: AppServices,
  nodeId: string,
  releaseId: string,
): Promise<ReleaseLogRecord | null> {
  const row = await getReleaseRow(services, releaseId)
  if (!row || row.node_id !== nodeId) return null
  return toReleaseLogRecord(row)
}

export async function recordHeartbeat(services: AppServices, input: HeartbeatInput): Promise<NodeRecord | null> {
  const now = nowIso()
  const nextWarpStatus = input.warpStatus === undefined ? null : input.warpStatus
  const nextWarpIpv4 = input.warpIpv4 === undefined ? null : input.warpIpv4
  const nextWarpIpv6 = input.warpIpv6 === undefined ? null : input.warpIpv6
  const nextWarpEndpoint = input.warpEndpoint === undefined ? null : input.warpEndpoint
  const nextWarpAccountType = input.warpAccountType === undefined ? null : input.warpAccountType
  const nextWarpTunnelProtocol = input.warpTunnelProtocol === undefined ? null : input.warpTunnelProtocol
  const nextWarpPrivateKey = input.warpPrivateKey === undefined ? null : input.warpPrivateKey
  const nextWarpReservedJson = input.warpReserved === undefined ? null : JSON.stringify(input.warpReserved)
  const nextArgoStatus = input.argoStatus === undefined ? null : input.argoStatus
  const nextArgoDomain = input.argoDomain === undefined ? null : input.argoDomain
  const nextPermissionMode = input.permissionMode === undefined ? null : input.permissionMode
  const nextSingBoxVersion = input.singBoxVersion === undefined ? null : input.singBoxVersion
  const nextSingBoxStatus = input.singBoxStatus === undefined ? null : input.singBoxStatus
  const nextXrayVersion = input.xrayVersion === undefined ? null : input.xrayVersion
  const nextXrayStatus = input.xrayStatus === undefined ? null : input.xrayStatus
  const nextStorageTotalBytes = input.storageTotalBytes === undefined ? null : input.storageTotalBytes
  const nextStorageUsedBytes = input.storageUsedBytes === undefined ? null : input.storageUsedBytes
  const nextStorageUsagePercent = input.storageUsagePercent === undefined ? null : input.storageUsagePercent
  const nextCpuCoreCount = input.cpuCoreCount === undefined ? null : input.cpuCoreCount
  const nextMemoryTotalBytes = input.memoryTotalBytes === undefined ? null : input.memoryTotalBytes
  const nextMemoryUsedBytes = input.memoryUsedBytes === undefined ? null : input.memoryUsedBytes
  const nextHeartbeatIntervalSeconds = input.heartbeatIntervalSeconds === undefined ? null : input.heartbeatIntervalSeconds
  const nextVersionPullIntervalSeconds = input.versionPullIntervalSeconds === undefined ? null : input.versionPullIntervalSeconds
  await services.db.run(
    `UPDATE nodes
     SET bytes_in_total = ?, bytes_out_total = ?, current_connections = ?, cpu_usage_percent = ?, memory_usage_percent = ?,
         warp_status = coalesce(?, warp_status), warp_ipv4 = coalesce(?, warp_ipv4), warp_ipv6 = coalesce(?, warp_ipv6),
         warp_endpoint = coalesce(?, warp_endpoint), warp_account_type = coalesce(?, warp_account_type),
         warp_tunnel_protocol = coalesce(?, warp_tunnel_protocol), warp_private_key = coalesce(?, warp_private_key),
         warp_reserved_json = coalesce(?, warp_reserved_json),
         argo_status = coalesce(?, argo_status), argo_domain = coalesce(?, argo_domain),
         permission_mode = coalesce(?, permission_mode),
         sing_box_version = coalesce(?, sing_box_version), sing_box_status = coalesce(?, sing_box_status),
         xray_version = coalesce(?, xray_version), xray_status = coalesce(?, xray_status),
         storage_total_bytes = coalesce(?, storage_total_bytes), storage_used_bytes = coalesce(?, storage_used_bytes),
         storage_usage_percent = coalesce(?, storage_usage_percent),
         cpu_core_count = coalesce(?, cpu_core_count),
         memory_total_bytes = coalesce(?, memory_total_bytes),
         memory_used_bytes = coalesce(?, memory_used_bytes),
         heartbeat_interval_seconds = coalesce(?, heartbeat_interval_seconds),
         version_pull_interval_seconds = coalesce(?, version_pull_interval_seconds),
         protocol_runtime_version = ?, last_seen_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.bytesInTotal,
      input.bytesOutTotal,
      input.currentConnections,
      input.cpuUsagePercent,
      input.memoryUsagePercent,
      nextWarpStatus,
      nextWarpIpv4,
      nextWarpIpv6,
      nextWarpEndpoint,
      nextWarpAccountType,
      nextWarpTunnelProtocol,
      nextWarpPrivateKey,
      nextWarpReservedJson,
      nextArgoStatus,
      nextArgoDomain,
      nextPermissionMode,
      nextSingBoxVersion,
      nextSingBoxStatus,
      nextXrayVersion,
      nextXrayStatus,
      nextStorageTotalBytes,
      nextStorageUsedBytes,
      nextStorageUsagePercent,
      nextCpuCoreCount,
      nextMemoryTotalBytes,
      nextMemoryUsedBytes,
      nextHeartbeatIntervalSeconds,
      nextVersionPullIntervalSeconds,
      input.protocolRuntimeVersion,
      now,
      now,
      input.nodeId,
    ],
  )

  await services.db.run(
    `INSERT INTO traffic_samples (
      id, node_id, at, bytes_in_total, bytes_out_total, current_connections, cpu_usage_percent, memory_usage_percent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createId('ts'),
      input.nodeId,
      now,
      input.bytesInTotal,
      input.bytesOutTotal,
      input.currentConnections,
      input.cpuUsagePercent,
      input.memoryUsagePercent,
    ],
  )

  return getNodeById(services, input.nodeId)
}

export async function listNodeTraffic(services: AppServices, nodeId: string, limit = 24): Promise<TrafficSample[]> {
  const rows = await services.db.all<{
    node_id: string
    at: string
    bytes_in_total: number
    bytes_out_total: number
    current_connections: number
    cpu_usage_percent: number | null
    memory_usage_percent: number | null
  }>(
    'SELECT * FROM traffic_samples WHERE node_id = ? ORDER BY at DESC LIMIT ?',
    [nodeId, limit],
  )

  return rows.map((row) => ({
    nodeId: row.node_id,
    at: row.at,
    bytesInTotal: Number(row.bytes_in_total || 0),
    bytesOutTotal: Number(row.bytes_out_total || 0),
    currentConnections: Number(row.current_connections || 0),
    cpuUsagePercent: row.cpu_usage_percent === null ? null : Number(row.cpu_usage_percent),
    memoryUsagePercent: row.memory_usage_percent === null ? null : Number(row.memory_usage_percent),
  }))
}

export async function resolveAgentNode(services: AppServices, nodeId: string, token: string): Promise<NodeRow | null> {
  const row = await getNodeRow(services, nodeId)
  if (!row || row.agent_token !== token) return null
  return row
}

export async function getNodeInstallTarget(
  services: AppServices,
  nodeId: string,
): Promise<{
  id: string
  name: string
  agentToken: string
  networkType: NodeRecord['networkType']
  primaryDomain: string
  backupDomain: string
  entryIp: string
  githubMirrorUrl: string
  installWarp: boolean
  warpLicenseKey: string
  heartbeatIntervalSeconds: number
  versionPullIntervalSeconds: number
  cfDnsToken: string
  argoTunnelToken: string
  argoTunnelDomain: string
  argoTunnelPort: number
} | null> {
  const row = await getNodeRow(services, nodeId)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    agentToken: row.agent_token,
    networkType: (row.network_type as NodeRecord['networkType']) || 'public',
    primaryDomain: row.primary_domain || '',
    backupDomain: row.backup_domain || '',
    entryIp: row.entry_ip || '',
    githubMirrorUrl: row.github_mirror_url || '',
    installWarp: toBool(row.install_warp),
    warpLicenseKey: row.warp_license_key || '',
    heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds || 15),
    versionPullIntervalSeconds: Number(row.version_pull_interval_seconds || 15),
    cfDnsToken: row.cf_dns_token || '',
    argoTunnelToken: row.argo_tunnel_token || '',
    argoTunnelDomain: row.argo_tunnel_domain || '',
    argoTunnelPort: Number(row.argo_tunnel_port || 2053),
  }
}

export async function getDesiredRelease(services: AppServices, nodeId: string) {
  const node = await getNodeRow(services, nodeId)
  if (!node) return null
  if (Number(node.desired_release_revision || 0) <= Number(node.current_release_revision || 0)) {
    return {
      node: toNodeRecord(node),
      release: null,
    }
  }
  const release = await services.db.get<ReleaseRow>(
    'SELECT * FROM releases WHERE node_id = ? AND revision = ?',
    [nodeId, Number(node.desired_release_revision || 0)],
  )
  if (!release || (release.status !== 'pending' && release.status !== 'applying')) {
    return {
      node: toNodeRecord(node),
      release: null,
    }
  }
  return {
    node: toNodeRecord(node),
    release: toReleaseRecord(release),
  }
}

export async function acknowledgeRelease(
  services: AppServices,
  nodeId: string,
  releaseId: string,
  status: ReleaseStatus,
  message: string,
  applyLogInput = '',
): Promise<ReleaseRecord | null> {
  const release = await getReleaseRow(services, releaseId)
  if (!release || release.node_id !== nodeId) return null

  const updatedAt = nowIso()
  const applyLog = sanitizeApplyLog(applyLogInput)
  const shouldWriteApplyLog = Boolean(applyLog)
  const shouldUpdateRelease = release.status !== status || release.message !== message || shouldWriteApplyLog

  if (!shouldUpdateRelease) {
    return toReleaseRecord(release)
  }

  await services.db.run(
    `UPDATE releases
     SET status = ?, message = ?, updated_at = ?, apply_log = ?, apply_log_status = ?, apply_log_updated_at = ?
     WHERE id = ?`,
    [
      status,
      message,
      updatedAt,
      shouldWriteApplyLog ? applyLog : release.apply_log,
      shouldWriteApplyLog ? status : (release.apply_log_status || ''),
      shouldWriteApplyLog ? updatedAt : release.apply_log_updated_at,
      releaseId,
    ],
  )

  if (status === 'healthy') {
    await services.db.run(
      'UPDATE nodes SET current_release_revision = ?, current_release_status = ?, updated_at = ? WHERE id = ?',
      [release.revision, status, updatedAt, nodeId],
    )
  } else if (status === 'failed') {
    await services.db.run(
      'UPDATE nodes SET current_release_status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, nodeId],
    )
  } else {
    await services.db.run(
      'UPDATE nodes SET current_release_status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, nodeId],
    )
  }

  const row = await getReleaseRow(services, releaseId)
  return row ? toReleaseRecord(row) : null
}

export async function buildPublicSubscriptionDocument(
  services: AppServices,
  token: string,
): Promise<Omit<PublicSubscriptionDocument, 'format'> | null> {
  const subscription = await getSubscriptionRowByToken(services, token)
  if (!subscription) return null

  const visibleNodeIds = parseJsonObject<string[]>(subscription.visible_node_ids_json, [])
  const nodes = visibleNodeIds.length > 0
    ? (await Promise.all(uniqueIds(visibleNodeIds).map((nodeId) => getNodeRow(services, nodeId)))).filter(
      (row): row is NodeRow => Boolean(row),
    )
    : await services.db.all<NodeRow>('SELECT * FROM nodes ORDER BY updated_at DESC')

  const entries: PublicSubscriptionDocument['entries'] = []
  for (const nodeRow of nodes) {
    const release = await services.db.get<ReleaseRow>(
      'SELECT * FROM releases WHERE node_id = ? AND kind = ? AND status = ? ORDER BY revision DESC LIMIT 1',
      [nodeRow.id, 'runtime', 'healthy'],
    )
    if (!release) continue
    const artifact = await services.artifacts.get(release.artifact_key)
    if (!artifact) continue
    const parsedArtifact = parseReleaseArtifact(artifact.body)
    if (!parsedArtifact) continue
    const releaseTemplates = hydrateReleaseTemplates(parsedArtifact.templates || [], release)
    if (releaseTemplates.length > 0) {
      entries.push(...buildSubscriptionEntries(toNodeRecord(nodeRow), releaseTemplates))
      continue
    }

    entries.push(...parsedArtifact.subscriptionEndpoints)
  }

  return {
    subscriptionId: subscription.id,
    name: subscription.name,
    generatedAt: nowIso(),
    entries,
  }
}

export async function buildSystemStatus(services: AppServices): Promise<SystemStatus> {
  const [nodeCountRow, templateCountRow, releaseCountRow, totalsRow] = await Promise.all([
    services.db.get<CountRow>('SELECT count(*) AS value FROM nodes'),
    services.db.get<CountRow>('SELECT count(*) AS value FROM templates'),
    services.db.get<CountRow>('SELECT count(*) AS value FROM releases'),
    services.db.get<TotalsRow>('SELECT coalesce(sum(bytes_in_total), 0) AS bytes_in, coalesce(sum(bytes_out_total), 0) AS bytes_out FROM nodes'),
  ])

  const nodes = await listNodes(services)
  const summary: DashboardSummary = {
    mode: services.mode,
    nodeCount: Number(nodeCountRow?.value || 0),
    templateCount: Number(templateCountRow?.value || 0),
    releaseCount: Number(releaseCountRow?.value || 0),
    onlineCount: nodes.filter((item) => isNodeOnline(item.lastSeenAt, item.heartbeatIntervalSeconds)).length,
    totalBytesIn: Number(totalsRow?.bytes_in || 0),
    totalBytesOut: Number(totalsRow?.bytes_out || 0),
  }

  return {
    appVersion: APP_VERSION,
    mode: services.mode,
    databaseDriver: services.dbDriver,
    artifactDriver: services.artifactDriver,
    publicBaseUrl: services.publicBaseUrl,
    summary,
    now: nowIso(),
  }
}
