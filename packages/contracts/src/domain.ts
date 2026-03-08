export type NodeKind = 'vps' | 'edge'

export type NetworkType = 'public' | 'noPublicIp'

export type ReleaseKind = 'runtime' | 'bootstrap'

export type ReleaseStatus = 'pending' | 'applying' | 'healthy' | 'failed'
export type WarpRouteMode = 'all' | 'ipv4' | 'ipv6'

export type StorageMode = 'cloudflare' | 'docker'

export type SubscriptionDocumentFormat = 'plain' | 'base64' | 'json' | 'v2ray' | 'clash' | 'singbox'

export type RuntimeArchiveFormat = 'tar.gz' | 'zip'

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
  warpLicenseKey: string
  cfDnsToken: string
  argoTunnelToken: string
  argoTunnelDomain: string
  argoTunnelPort: number
  warpStatus?: string
  warpIpv6?: string
  warpEndpoint?: string
  warpPrivateKey?: string
  warpReserved?: number[]
  argoStatus?: string
  argoDomain?: string
  storageTotalBytes?: number
  storageUsedBytes?: number
  storageUsagePercent?: number | null
  cpuCoreCount?: number | null
  memoryTotalBytes?: number
  memoryUsedBytes?: number
  configRevision: number
  bootstrapRevision: number
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
  bootstrapRevision: number
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
  bootstrap: BootstrapPlan
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
  artifactDriver: 'r2' | 'minio'
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
  binary: RuntimeBinaryPlan
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
  uri?: string
}

export interface BootstrapPlan {
  serviceName: string
  runtimeServiceName: string
  installWarp: boolean
  warpLicenseKey: string
  heartbeatIntervalSeconds: number
  versionPullIntervalSeconds: number
  installSingBox: boolean
  installXray: boolean
  runtimeBinaries: RuntimeBinaryPlan[]
  mode: 'runtime-only' | 'bootstrap-required'
  notes: string[]
}

export interface BootstrapOptions {
  installWarp: boolean
  warpLicenseKey: string
  heartbeatIntervalSeconds: number
  versionPullIntervalSeconds: number
  installSingBox: boolean
  installXray: boolean
}

export interface RuntimeBinaryPlan {
  engine: TemplateRecord['engine']
  version: string
  binaryName: string
  installPath: string
  archiveFormat: RuntimeArchiveFormat
  downloadBaseUrl: string
  assetNameTemplate: string
  binaryPathTemplate: string
  runArgsTemplate: string
}

export interface ReleaseArtifact {
  schema: 'nodehubsapi-release-v2'
  releaseId: string
  nodeId: string
  revision: number
  kind: ReleaseKind
  configRevision: number
  bootstrapRevision: number
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
  bootstrap: BootstrapPlan
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
