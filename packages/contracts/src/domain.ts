export type NodeKind = 'vps' | 'edge'

export type NetworkType = 'public' | 'noPublicIp'

export type ReleaseKind = 'runtime'

export type ReleaseStatus = 'pending' | 'applying' | 'healthy' | 'failed'
export type WarpRouteMode = 'all' | 'ipv4' | 'ipv6'

export type StorageMode = 'cloudflare' | 'docker'

export type SubscriptionDocumentFormat = 'plain' | 'base64' | 'json' | 'v2ray' | 'clash' | 'singbox' | 'wireguard'

export const DEFAULT_WARP_LOCAL_PROXY_PORT = 23499
export const DEFAULT_EDGE_DEPLOY_ASSET_URL = 'https://github.com/byJoey/cfnew/releases/latest/download/Pages.zip'
export const NODE_OFFLINE_MULTIPLIER = 2.1
export const DEFAULT_NODE_HEARTBEAT_INTERVAL_SECONDS = 15
export const MIN_NODE_HEARTBEAT_INTERVAL_SECONDS = 5
export const MAX_NODE_HEARTBEAT_INTERVAL_SECONDS = 3600

function normalizeNodeIntervalSeconds(value: unknown, fallback = DEFAULT_NODE_HEARTBEAT_INTERVAL_SECONDS): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(MIN_NODE_HEARTBEAT_INTERVAL_SECONDS, Math.min(MAX_NODE_HEARTBEAT_INTERVAL_SECONDS, Math.trunc(parsed)))
}

export function getNodeOfflineThresholdMs(heartbeatIntervalSeconds: unknown): number {
  return Math.round(normalizeNodeIntervalSeconds(heartbeatIntervalSeconds) * NODE_OFFLINE_MULTIPLIER * 1000)
}

export function isNodeOnline(lastSeenAt: string | null | undefined, heartbeatIntervalSeconds: unknown): boolean {
  if (!lastSeenAt) return false
  const lastSeen = new Date(lastSeenAt).getTime()
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= getNodeOfflineThresholdMs(heartbeatIntervalSeconds)
}

export interface EdgeSubscriptionSource {
  format: SubscriptionDocumentFormat
  url: string
  enabled: boolean
}

export interface EdgeSubscriptionProbeResult {
  format: SubscriptionDocumentFormat
  url: string
  ok: boolean
  status?: number
  statusText?: string
  contentType?: string
  bytes?: number
  finalUrl?: string
  error?: string
}

export interface EdgeSubscriptionProbeResponse {
  testedAt: string
  successCount: number
  failureCount: number
  results: EdgeSubscriptionProbeResult[]
}

export interface NodeRecord {
  id: string
  name: string
  nodeType: NodeKind
  region: string
  tags: string[]
  networkType: NetworkType
  primaryDomain: string
  backupDomain: string
  entryIp: string
  githubMirrorUrl: string
  edgeUseGithubMirror?: boolean
  edgeDeployAssetUrl?: string
  edgeSubscriptionSources?: EdgeSubscriptionSource[]
  installWarp: boolean
  warpLicenseKey: string
  cfDnsToken: string
  argoTunnelToken: string
  argoTunnelDomain: string
  argoTunnelPort: number
  warpStatus?: string
  warpIpv4?: string
  warpIpv6?: string
  warpEndpoint?: string
  warpAccountType?: string
  warpTunnelProtocol?: string
  warpPrivateKey?: string
  warpReserved?: number[]
  argoStatus?: string
  argoDomain?: string
  permissionMode?: 'root' | 'user'
  singBoxVersion?: string
  singBoxStatus?: string
  xrayVersion?: string
  xrayStatus?: string
  storageTotalBytes?: number
  storageUsedBytes?: number
  storageUsagePercent?: number | null
  cpuCoreCount?: number | null
  memoryTotalBytes?: number
  memoryUsedBytes?: number
  configRevision: number
  desiredReleaseRevision: number
  currentReleaseRevision: number
  currentReleaseStatus: ReleaseStatus | 'idle'
  lastSeenAt: string | null
  heartbeatIntervalSeconds: number
  versionPullIntervalSeconds: number
  cpuUsagePercent: number | null
  memoryUsagePercent: number | null
  bytesInTotal: number
  bytesOutTotal: number
  currentConnections: number
  protocolRuntimeVersion: string
  updatedAt: string
  createdAt: string
}

export interface TemplateRecord {
  id: string
  name: string
  engine: 'sing-box' | 'xray'
  protocol: string
  transport: string
  tlsMode: 'none' | 'tls' | 'reality'
  warpExit: boolean
  warpRouteMode: WarpRouteMode
  defaults: Record<string, unknown>
  notes: string
  updatedAt: string
  createdAt: string
}

export interface ReleaseRecord {
  id: string
  nodeId: string
  kind: ReleaseKind
  revision: number
  status: ReleaseStatus
  configRevision: number
  templateIds: string[]
  artifactKey: string
  artifactSha256: string
  summary: string
  message: string
  createdAt: string
  updatedAt: string
}

export interface ReleaseLogRecord extends ReleaseRecord {
  applyLog: string
  applyLogStatus: ReleaseStatus | ''
  applyLogUpdatedAt: string | null
}

export interface ReleasePreviewRecord {
  kind: ReleaseKind
  runtimePlans: Array<Pick<ReleaseRuntimePlan, 'engine' | 'entryConfigPath' | 'files'>>
  templateIds: string[]
}

export interface SubscriptionRecord {
  id: string
  token: string
  name: string
  enabled: boolean
  visibleNodeIds: string[]
  updatedAt: string
  createdAt: string
}

export interface TrafficSample {
  nodeId: string
  at: string
  bytesInTotal: number
  bytesOutTotal: number
  currentConnections: number
  cpuUsagePercent: number | null
  memoryUsagePercent: number | null
}

export interface DashboardSummary {
  mode: StorageMode
  nodeCount: number
  templateCount: number
  releaseCount: number
  onlineCount: number
  totalBytesIn: number
  totalBytesOut: number
}

export interface SystemStatus {
  appVersion: string
  mode: StorageMode
  databaseDriver: 'd1' | 'sqlite'
  artifactDriver: 'local' | 'r2'
  publicBaseUrl: string
  summary: DashboardSummary
  now: string
}

export interface ReleaseConfigFile {
  path: string
  contentType: 'application/json' | 'text/plain'
  content: string
}

export interface ReleaseRuntimePlan {
  engine: TemplateRecord['engine']
  entryConfigPath: string
  files: ReleaseConfigFile[]
}

export interface SubscriptionEndpoint {
  nodeId: string
  nodeName: string
  templateId: string
  templateName: string
  engine: TemplateRecord['engine']
  protocol: string
  transport: string
  tlsMode: TemplateRecord['tlsMode']
  warpExit: boolean
  warpRouteMode: WarpRouteMode
  label: string
  server: string
  port: number
  host?: string
  sni?: string
  path?: string
  serviceName?: string
  uuid?: string
  password?: string
  method?: string
  flow?: string
  fingerprint?: string
  alterId?: number
  realityPublicKey?: string
  realityShortId?: string
  upMbps?: number
  downMbps?: number
  wireguard?: WireguardSubscription
  uri?: string
}

export interface WireguardSubscription {
  privateKey: string
  publicKey?: string
  peerPublicKey: string
  preSharedKey?: string
  address: string
  allowedIps: string[]
  dns?: string[]
  mtu?: number
  persistentKeepalive?: number
}

export interface ReleaseArtifact {
  schema: 'nodehubsapi-release-v2'
  releaseId: string
  nodeId: string
  revision: number
  kind: ReleaseKind
  configRevision: number
  summary: string
  message: string
  createdAt: string
  node: Pick<
    NodeRecord,
    | 'id'
    | 'name'
    | 'nodeType'
    | 'region'
    | 'tags'
    | 'networkType'
    | 'primaryDomain'
    | 'backupDomain'
    | 'entryIp'
    | 'githubMirrorUrl'
    | 'cfDnsToken'
    | 'argoTunnelToken'
    | 'argoTunnelDomain'
    | 'argoTunnelPort'
  >
  templates: Array<
    Pick<TemplateRecord, 'id' | 'name' | 'engine' | 'protocol' | 'transport' | 'tlsMode' | 'warpExit' | 'warpRouteMode' | 'defaults'>
  >
  runtimes: ReleaseRuntimePlan[]
  subscriptionEndpoints: SubscriptionEndpoint[]
}

export interface PublicSubscriptionDocument {
  subscriptionId: string
  name: string
  format: SubscriptionDocumentFormat
  generatedAt: string
  entries: SubscriptionEndpoint[]
}

export interface TemplatePreset {
  id: string
  name: string
  engine: TemplateRecord['engine']
  protocol: string
  transport: string
  tlsMode: TemplateRecord['tlsMode']
  warpExit: boolean
  warpRouteMode: WarpRouteMode
  defaults: Record<string, unknown>
  notes: string
}
