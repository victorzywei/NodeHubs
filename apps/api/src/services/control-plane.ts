import type {
  CreateNodeInput,
  CreateSubscriptionInput,
  CreateTemplateInput,
  DashboardSummary,
  HeartbeatInput,
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
  UpdateTemplateInput,
} from '@contracts/index'
import type { AppServices } from '../lib/app-types'
import { APP_VERSION, ONLINE_WINDOW_MS } from '../lib/constants'
import { createId, createToken, nowIso, parseJsonObject } from '../lib/utils'
import { parseReleaseArtifact, renderReleaseArtifact } from './release-renderer'

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
  install_argo: number
  config_revision: number
  bootstrap_revision: number
  desired_release_revision: number
  current_release_revision: number
  current_release_status: string
  last_seen_at: string | null
  cpu_usage_percent: number | null
  memory_usage_percent: number | null
  bytes_in_total: number
  bytes_out_total: number
  current_connections: number
  warp_status?: string
  warp_ipv6?: string
  warp_endpoint?: string
  argo_status?: string
  argo_domain?: string
  storage_total_bytes?: number
  storage_used_bytes?: number
  storage_usage_percent?: number | null
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
  bootstrap_revision: number
  template_ids_json: string
  artifact_key: string
  artifact_sha256: string
  summary: string
  message: string
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

const BOOTSTRAP_FIELDS = new Set(['nodeType', 'installWarp', 'installArgo', 'networkType', 'argoTunnelToken', 'argoTunnelDomain', 'argoTunnelPort'])
const RUNTIME_FIELDS = new Set(['primaryDomain', 'backupDomain', 'entryIp'])

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
    warpLicenseKey: row.warp_license_key || '',
    cfDnsToken: row.cf_dns_token || '',
    argoTunnelToken: row.argo_tunnel_token || '',
    argoTunnelDomain: row.argo_tunnel_domain || '',
    argoTunnelPort: Number(row.argo_tunnel_port || 2053),
    installWarp: toBool(row.install_warp),
    installArgo: toBool(row.install_argo),
    configRevision: Number(row.config_revision || 1),
    bootstrapRevision: Number(row.bootstrap_revision || 1),
    desiredReleaseRevision: Number(row.desired_release_revision || 0),
    currentReleaseRevision: Number(row.current_release_revision || 0),
    currentReleaseStatus: String(row.current_release_status || 'idle') as NodeRecord['currentReleaseStatus'],
    lastSeenAt: row.last_seen_at,
    cpuUsagePercent: row.cpu_usage_percent === null ? null : Number(row.cpu_usage_percent),
    memoryUsagePercent: row.memory_usage_percent === null ? null : Number(row.memory_usage_percent),
    bytesInTotal: Number(row.bytes_in_total || 0),
    bytesOutTotal: Number(row.bytes_out_total || 0),
    currentConnections: Number(row.current_connections || 0),
    warpStatus: row.warp_status || '',
    warpIpv6: row.warp_ipv6 || '',
    warpEndpoint: row.warp_endpoint || '',
    argoStatus: row.argo_status || '',
    argoDomain: row.argo_domain || '',
    storageTotalBytes: Number(row.storage_total_bytes || 0),
    storageUsedBytes: Number(row.storage_used_bytes || 0),
    storageUsagePercent: row.storage_usage_percent === null || row.storage_usage_percent === undefined
      ? null
      : Number(row.storage_usage_percent),
    protocolRuntimeVersion: row.protocol_runtime_version || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toTemplateRecord(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine as TemplateRecord['engine'],
    protocol: row.protocol,
    transport: row.transport,
    tlsMode: row.tls_mode as TemplateRecord['tlsMode'],
    defaults: parseJsonObject<Record<string, unknown>>(row.defaults_json, {}),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toReleaseRecord(row: ReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind as ReleaseKind,
    revision: Number(row.revision || 0),
    status: row.status as ReleaseStatus,
    configRevision: Number(row.config_revision || 0),
    bootstrapRevision: Number(row.bootstrap_revision || 0),
    artifactKey: row.artifact_key,
    artifactSha256: row.artifact_sha256,
    summary: row.summary,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  const lastSeen = new Date(lastSeenAt).getTime()
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= ONLINE_WINDOW_MS
}

function summarizeRelease(kind: ReleaseKind, templateIds: string[], message: string): string {
  const scope = kind === 'bootstrap' ? 'bootstrap update' : 'runtime update'
  const templates = templateIds.length > 0 ? `templates=${templateIds.join(',')}` : 'templates=none'
  return [scope, templates, message || 'no-message'].join(' | ')
}

function determineNodeImpact(input: UpdateNodeInput): 'none' | 'runtime' | 'bootstrap' {
  let impact: 'none' | 'runtime' | 'bootstrap' = 'none'
  for (const key of Object.keys(input)) {
    if (BOOTSTRAP_FIELDS.has(key)) return 'bootstrap'
    if (RUNTIME_FIELDS.has(key)) impact = 'runtime'
  }
  return impact
}

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
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
  const id = createId('node')
  const now = nowIso()
  await services.db.run(
    `INSERT INTO nodes (
      id, agent_token, name, node_type, region, tags_json, network_type, primary_domain, backup_domain, entry_ip,
      github_mirror_url, warp_license_key, cf_dns_token, argo_tunnel_token, argo_tunnel_domain, argo_tunnel_port,
      install_warp, install_argo, config_revision, bootstrap_revision, desired_release_revision,
      current_release_revision, current_release_status, bytes_in_total, bytes_out_total,
      current_connections, warp_status, warp_ipv6, warp_endpoint, argo_status, argo_domain,
      storage_total_bytes, storage_used_bytes, storage_usage_percent, protocol_runtime_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      createToken(),
      input.name,
      input.nodeType,
      input.region,
      JSON.stringify(input.tags),
      input.networkType,
      input.primaryDomain,
      input.backupDomain,
      input.entryIp,
      input.githubMirrorUrl,
      input.warpLicenseKey,
      input.cfDnsToken,
      input.argoTunnelToken,
      input.argoTunnelDomain,
      input.argoTunnelPort,
      input.installWarp ? 1 : 0,
      input.installArgo ? 1 : 0,
      1,
      1,
      0,
      0,
      'idle',
      0,
      0,
      0,
      '',
      '',
      '',
      '',
      '',
      0,
      0,
      null,
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

  const impact = determineNodeImpact(input)
  const nextConfigRevision = impact === 'runtime' ? Number(current.config_revision || 1) + 1 : Number(current.config_revision || 1)
  const nextBootstrapRevision = impact === 'bootstrap' ? Number(current.bootstrap_revision || 1) + 1 : Number(current.bootstrap_revision || 1)

  await services.db.run(
    `UPDATE nodes
     SET name = ?, node_type = ?, region = ?, tags_json = ?, network_type = ?, primary_domain = ?, backup_domain = ?, entry_ip = ?,
         github_mirror_url = ?, warp_license_key = ?, cf_dns_token = ?, argo_tunnel_token = ?, argo_tunnel_domain = ?, argo_tunnel_port = ?,
         install_warp = ?, install_argo = ?, bytes_in_total = ?, bytes_out_total = ?, current_connections = ?,
         cpu_usage_percent = ?, memory_usage_percent = ?, warp_status = ?, warp_ipv6 = ?, warp_endpoint = ?,
         argo_status = ?, argo_domain = ?, storage_total_bytes = ?, storage_used_bytes = ?, storage_usage_percent = ?,
         protocol_runtime_version = ?, last_seen_at = ?,
         config_revision = ?, bootstrap_revision = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.nodeType ?? current.node_type,
      input.region ?? current.region,
      JSON.stringify(input.tags ?? parseJsonObject<string[]>(current.tags_json, [])),
      input.networkType ?? current.network_type,
      input.primaryDomain ?? current.primary_domain,
      input.backupDomain ?? current.backup_domain,
      input.entryIp ?? current.entry_ip,
      input.githubMirrorUrl ?? current.github_mirror_url,
      input.warpLicenseKey ?? current.warp_license_key,
      input.cfDnsToken ?? current.cf_dns_token,
      input.argoTunnelToken ?? current.argo_tunnel_token,
      input.argoTunnelDomain ?? current.argo_tunnel_domain,
      input.argoTunnelPort ?? current.argo_tunnel_port,
      input.installWarp === undefined ? current.install_warp : (input.installWarp ? 1 : 0),
      input.installArgo === undefined ? current.install_argo : (input.installArgo ? 1 : 0),
      input.bytesInTotal ?? current.bytes_in_total,
      input.bytesOutTotal ?? current.bytes_out_total,
      input.currentConnections ?? current.current_connections,
      input.cpuUsagePercent ?? current.cpu_usage_percent,
      input.memoryUsagePercent ?? current.memory_usage_percent,
      input.warpStatus ?? current.warp_status ?? '',
      input.warpIpv6 ?? current.warp_ipv6 ?? '',
      input.warpEndpoint ?? current.warp_endpoint ?? '',
      input.argoStatus ?? current.argo_status ?? '',
      input.argoDomain ?? current.argo_domain ?? '',
      input.storageTotalBytes ?? current.storage_total_bytes ?? 0,
      input.storageUsedBytes ?? current.storage_used_bytes ?? 0,
      input.storageUsagePercent ?? current.storage_usage_percent ?? null,
      input.protocolRuntimeVersion ?? current.protocol_runtime_version,
      input.lastSeenAt ?? current.last_seen_at,
      nextConfigRevision,
      nextBootstrapRevision,
      nowIso(),
      nodeId,
    ],
  )

  const row = await getNodeRow(services, nodeId)
  return row ? toNodeRecord(row) : null
}

export async function listTemplates(services: AppServices): Promise<TemplateRecord[]> {
  const rows = await services.db.all<TemplateRow>('SELECT * FROM templates ORDER BY updated_at DESC')
  return rows.map(toTemplateRecord)
}

export async function createTemplate(services: AppServices, input: CreateTemplateInput): Promise<TemplateRecord> {
  const id = createId('tpl')
  const now = nowIso()
  await services.db.run(
    `INSERT INTO templates (id, name, engine, protocol, transport, tls_mode, defaults_json, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.engine,
      input.protocol,
      input.transport,
      input.tlsMode,
      JSON.stringify(input.defaults),
      input.notes,
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

  await services.db.run(
    `UPDATE templates
     SET name = ?, engine = ?, protocol = ?, transport = ?, tls_mode = ?, defaults_json = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.engine ?? current.engine,
      input.protocol ?? current.protocol,
      input.transport ?? current.transport,
      input.tlsMode ?? current.tls_mode,
      JSON.stringify(input.defaults ?? parseJsonObject<Record<string, unknown>>(current.defaults_json, {})),
      input.notes ?? current.notes,
      nowIso(),
      templateId,
    ],
  )

  const row = await getTemplateRow(services, templateId)
  return row ? toTemplateRecord(row) : null
}

export async function listSubscriptions(services: AppServices): Promise<SubscriptionRecord[]> {
  const rows = await services.db.all<SubscriptionRow>('SELECT * FROM subscriptions ORDER BY updated_at DESC')
  return rows.map(toSubscriptionRecord)
}

export async function createSubscription(services: AppServices, input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const id = createId('sub')
  const now = nowIso()
  const token = createToken()
  await services.db.run(
    `INSERT INTO subscriptions (id, token, name, enabled, visible_node_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      input.name,
      input.enabled ? 1 : 0,
      JSON.stringify(input.visibleNodeIds),
      now,
      now,
    ],
  )
  const row = await services.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id])
  if (!row) throw new Error('failed to create subscription')
  return toSubscriptionRecord(row)
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
  kind: ReleaseKind,
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
  if (kind === 'runtime' && templateRows.length === 0) {
    throw new Error('Runtime releases require at least one protocol template')
  }

  const reserved = await reserveNodeReleaseSlot(services, nodeId)
  if (!reserved) return null

  const releaseId = createId('rel')
  const artifactKey = `releases/${nodeId}/r${reserved.revision}.json`
  const summary = summarizeRelease(kind, uniqueTemplateIds, message)

  try {
    const artifact = renderReleaseArtifact({
      releaseId,
      revision: reserved.revision,
      kind,
      configRevision: Number(reserved.row.config_revision || 0),
      bootstrapRevision: Number(reserved.row.bootstrap_revision || 0),
      createdAt: reserved.updatedAt,
      message,
      summary,
      node: {
        ...node,
        desiredReleaseRevision: reserved.revision,
        currentReleaseStatus: 'pending',
      },
      templates: templateRows.map(toTemplateRecord),
    }, services.runtimeCatalog)
    const stored = await services.artifacts.putJson(artifactKey, artifact)

    await services.db.run(
      `INSERT INTO releases (
        id, node_id, kind, revision, status, config_revision, bootstrap_revision,
        template_ids_json, artifact_key, artifact_sha256, summary, message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseId,
        nodeId,
        kind,
        reserved.revision,
        'pending',
        Number(reserved.row.config_revision || 0),
        Number(reserved.row.bootstrap_revision || 0),
        JSON.stringify(uniqueTemplateIds),
        artifactKey,
        stored.etag,
        summary,
        message,
        reserved.updatedAt,
        reserved.updatedAt,
      ],
    )
  } catch (error) {
    await services.db.run(
      `UPDATE nodes
       SET desired_release_revision = ?, current_release_status = ?, updated_at = ?
       WHERE id = ? AND desired_release_revision = ?`,
      [
        Math.max(0, reserved.revision - 1),
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
  kind: ReleaseKind,
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
  if (kind === 'runtime' && templateRows.length === 0) {
    throw new Error('Runtime releases require at least one protocol template')
  }

  const previewRevision = Number(node.desiredReleaseRevision || 0) + 1
  const createdAt = nowIso()
  const summary = summarizeRelease(kind, uniqueTemplateIds, message)
  const artifact = renderReleaseArtifact(
    {
      releaseId: createId('preview'),
      revision: previewRevision,
      kind,
      configRevision: Number(node.configRevision || 0),
      bootstrapRevision: Number(node.bootstrapRevision || 0),
      createdAt,
      message,
      summary,
      node: {
        ...node,
        desiredReleaseRevision: previewRevision,
        currentReleaseStatus: 'pending',
      },
      templates: templateRows.map(toTemplateRecord),
    },
    services.runtimeCatalog,
  )

  return {
    kind: artifact.kind,
    engine: artifact.runtime.engine,
    entryConfigPath: artifact.runtime.entryConfigPath,
    files: artifact.runtime.files,
    templateIds: uniqueTemplateIds,
  }
}

export async function listNodeReleases(services: AppServices, nodeId: string): Promise<ReleaseRecord[]> {
  const rows = await services.db.all<ReleaseRow>('SELECT * FROM releases WHERE node_id = ? ORDER BY revision DESC', [nodeId])
  return rows.map(toReleaseRecord)
}

export async function getReleaseById(services: AppServices, releaseId: string): Promise<ReleaseRow | null> {
  return getReleaseRow(services, releaseId)
}

export async function recordHeartbeat(services: AppServices, input: HeartbeatInput): Promise<NodeRecord | null> {
  const now = nowIso()
  const nextWarpStatus = input.warpStatus === undefined ? null : input.warpStatus
  const nextWarpIpv6 = input.warpIpv6 === undefined ? null : input.warpIpv6
  const nextWarpEndpoint = input.warpEndpoint === undefined ? null : input.warpEndpoint
  const nextArgoStatus = input.argoStatus === undefined ? null : input.argoStatus
  const nextArgoDomain = input.argoDomain === undefined ? null : input.argoDomain
  const nextStorageTotalBytes = input.storageTotalBytes === undefined ? null : input.storageTotalBytes
  const nextStorageUsedBytes = input.storageUsedBytes === undefined ? null : input.storageUsedBytes
  const nextStorageUsagePercent = input.storageUsagePercent === undefined ? null : input.storageUsagePercent
  await services.db.run(
    `UPDATE nodes
     SET bytes_in_total = ?, bytes_out_total = ?, current_connections = ?, cpu_usage_percent = ?, memory_usage_percent = ?,
         warp_status = coalesce(?, warp_status), warp_ipv6 = coalesce(?, warp_ipv6), warp_endpoint = coalesce(?, warp_endpoint),
         argo_status = coalesce(?, argo_status), argo_domain = coalesce(?, argo_domain),
         storage_total_bytes = coalesce(?, storage_total_bytes), storage_used_bytes = coalesce(?, storage_used_bytes),
         storage_usage_percent = coalesce(?, storage_usage_percent),
         protocol_runtime_version = ?, last_seen_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.bytesInTotal,
      input.bytesOutTotal,
      input.currentConnections,
      input.cpuUsagePercent,
      input.memoryUsagePercent,
      nextWarpStatus,
      nextWarpIpv6,
      nextWarpEndpoint,
      nextArgoStatus,
      nextArgoDomain,
      nextStorageTotalBytes,
      nextStorageUsedBytes,
      nextStorageUsagePercent,
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
): Promise<{ id: string; name: string; agentToken: string } | null> {
  const row = await getNodeRow(services, nodeId)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    agentToken: row.agent_token,
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
  return {
    node: toNodeRecord(node),
    release: release ? toReleaseRecord(release) : null,
  }
}

export async function acknowledgeRelease(
  services: AppServices,
  nodeId: string,
  releaseId: string,
  status: ReleaseStatus,
  message: string,
): Promise<ReleaseRecord | null> {
  const release = await getReleaseRow(services, releaseId)
  if (!release || release.node_id !== nodeId) return null

  const updatedAt = nowIso()
  await services.db.run(
    'UPDATE releases SET status = ?, message = ?, updated_at = ? WHERE id = ?',
    [status, message, updatedAt, releaseId],
  )

  if (status === 'healthy') {
    await services.db.run(
      'UPDATE nodes SET current_release_revision = ?, current_release_status = ?, updated_at = ? WHERE id = ?',
      [release.revision, status, updatedAt, nodeId],
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
    if (Number(nodeRow.current_release_revision || 0) <= 0 || nodeRow.current_release_status !== 'healthy') {
      continue
    }
    const release = await services.db.get<ReleaseRow>(
      'SELECT * FROM releases WHERE node_id = ? AND revision = ? AND status = ?',
      [nodeRow.id, Number(nodeRow.current_release_revision || 0), 'healthy'],
    )
    if (!release) continue
    const artifact = await services.artifacts.get(release.artifact_key)
    if (!artifact) continue
    const parsedArtifact = parseReleaseArtifact(artifact.body)
    if (!parsedArtifact) continue
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
    onlineCount: nodes.filter((item) => isOnline(item.lastSeenAt)).length,
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
