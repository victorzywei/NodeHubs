import type { ReleaseArtifact } from '@contracts/index'
import { AGENT_INSTALL_SCRIPT_TEMPLATE, RELEASE_APPLY_SCRIPT_TEMPLATE } from '../generated/script-assets'
import { APP_VERSION } from '../lib/constants'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

export function buildDeployCommand(input: {
  publicBaseUrl: string
  nodeId: string
  agentToken: string
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  const installUrl = `${apiBase}/api/nodes/agent/install?nodeId=${encodeURIComponent(input.nodeId)}`
  const tokenHeader = `X-Agent-Token: ${input.agentToken}`
  return [
    `URL=${shellQuote(installUrl)}`,
    `TOKEN_HEADER=${shellQuote(tokenHeader)}`,
    'if command -v curl >/dev/null 2>&1; then curl -fsSL -H "$TOKEN_HEADER" "$URL"',
    'elif command -v wget >/dev/null 2>&1; then wget -qO- --header="$TOKEN_HEADER" "$URL"',
    'elif command -v busybox >/dev/null 2>&1; then busybox wget -qO- --header="$TOKEN_HEADER" "$URL"',
    "else echo 'A downloader is required: curl, wget, or busybox wget.' >&2; exit 1",
    'fi | bash',
  ].join('; ')
}

export function buildUninstallCommand(): string {
  return `systemctl stop nodehubsapi-agent.service nodehubsapi-runtime.service nodehubsapi-runtime-sing-box.service nodehubsapi-runtime-xray.service 2>/dev/null; systemctl disable nodehubsapi-agent.service nodehubsapi-runtime.service nodehubsapi-runtime-sing-box.service nodehubsapi-runtime-xray.service 2>/dev/null; rm -f /etc/systemd/system/nodehubsapi-agent.service /etc/systemd/system/nodehubsapi-runtime.service /etc/systemd/system/nodehubsapi-runtime-sing-box.service /etc/systemd/system/nodehubsapi-runtime-xray.service; systemctl daemon-reload; rm -f /usr/local/bin/nodehubsapi-agent /usr/local/bin/xray /usr/local/bin/sing-box; rm -rf /etc/nodehubsapi /opt/nodehubsapi; echo 'NodeHub agent uninstalled.'`
}

function buildRuntimeFileBlocks(artifact: ReleaseArtifact): string {
  const releaseMetadata = {
    releaseId: artifact.releaseId,
    revision: artifact.revision,
    kind: artifact.kind,
    configRevision: artifact.configRevision,
    bootstrapRevision: artifact.bootstrapRevision,
    message: artifact.message,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
  }
  const files = [
    ...artifact.runtimes.flatMap((runtime) => runtime.files),
    {
      path: 'runtime/release.json',
      contentType: 'application/json' as const,
      content: JSON.stringify(releaseMetadata, null, 2),
    },
  ]
  const deduplicated = Array.from(new Map(files.map((file) => [file.path, file])).values())

  return deduplicated
    .map((file, index) => {
      const label = `NODESHUB_FILE_${index + 1}`
      const targetPath = `\${ETC_DIR}/${file.path}`
      return [
        `mkdir -p "$(dirname "${targetPath}")"`,
        `cat >"${targetPath}" <<'${label}'`,
        file.content,
        label,
      ].join('\n')
    })
    .join('\n\n')
}

function buildRuntimeApplyBlocks(artifact: ReleaseArtifact): string {
  return artifact.runtimes
    .map((runtime) => {
      const configPath = `\${ETC_DIR}/${runtime.entryConfigPath}`
      const serviceName = `nodehubsapi-runtime-${runtime.engine}`
      const serviceFile = `\${SYSTEMD_DIR}/${serviceName}.service`
      return [
        `  RUNTIME_ENGINE=${shellQuote(runtime.engine)}`,
        `  RUNTIME_VERSION=${shellQuote(runtime.binary.version)}`,
        `  RUNTIME_BINARY_NAME=${shellQuote(runtime.binary.binaryName)}`,
        `  RUNTIME_INSTALL_PATH_DEFAULT=${shellQuote(runtime.binary.installPath)}`,
        `  RUNTIME_ASSET_TEMPLATE=${shellQuote(runtime.binary.assetNameTemplate)}`,
        `  RUNTIME_BINARY_PATH_TEMPLATE=${shellQuote(runtime.binary.binaryPathTemplate)}`,
        `  RUNTIME_RUN_ARGS_TEMPLATE=${shellQuote(runtime.binary.runArgsTemplate)}`,
        `  RUNTIME_ARCHIVE_FORMAT=${shellQuote(runtime.binary.archiveFormat)}`,
        `  RUNTIME_CONFIG_PATH="${configPath}"`,
        `  RUNTIME_SERVICE_NAME=${shellQuote(serviceName)}`,
        `  RUNTIME_SERVICE_FILE="${serviceFile}"`,
        '  resolve_runtime_install_path',
        '  install_runtime_binary',
        '  write_runtime_service',
        '  restart_runtime_service',
      ].join('\n')
    })
    .join('\n')
}

function buildBootstrapBinaryApplyBlocks(artifact: ReleaseArtifact): string {
  return artifact.bootstrap.runtimeBinaries
    .map((binary) => {
      const configPath = `\${ETC_DIR}/runtime/${binary.engine}.json`
      return [
        `  RUNTIME_ENGINE=${shellQuote(binary.engine)}`,
        `  RUNTIME_VERSION=${shellQuote(binary.version)}`,
        `  RUNTIME_BINARY_NAME=${shellQuote(binary.binaryName)}`,
        `  RUNTIME_INSTALL_PATH_DEFAULT=${shellQuote(binary.installPath)}`,
        `  RUNTIME_ASSET_TEMPLATE=${shellQuote(binary.assetNameTemplate)}`,
        `  RUNTIME_BINARY_PATH_TEMPLATE=${shellQuote(binary.binaryPathTemplate)}`,
        `  RUNTIME_RUN_ARGS_TEMPLATE=${shellQuote(binary.runArgsTemplate)}`,
        `  RUNTIME_ARCHIVE_FORMAT=${shellQuote(binary.archiveFormat)}`,
        `  RUNTIME_CONFIG_PATH="${configPath}"`,
        '  resolve_runtime_install_path',
        '  install_runtime_binary',
      ].join('\n')
    })
    .join('\n')
}

export function buildAgentReconcileEnv(input: {
  nodeId: string
  needsUpdate: boolean
  currentReleaseRevision: number
  desiredReleaseRevision?: number
  releaseId?: string
  applyUrl?: string
  artifactUrl?: string
  status?: string
  agentVersion?: string
  installUrl?: string
}): string {
  return [
    `node_id=${shellQuote(input.nodeId)}`,
    `needs_update=${input.needsUpdate ? '1' : '0'}`,
    `current_release_revision=${shellQuote(String(input.currentReleaseRevision))}`,
    `desired_release_revision=${shellQuote(String(input.desiredReleaseRevision ?? input.currentReleaseRevision))}`,
    `release_id=${shellQuote(input.releaseId || '')}`,
    `apply_url=${shellQuote(input.applyUrl || '')}`,
    `artifact_url=${shellQuote(input.artifactUrl || '')}`,
    `release_status=${shellQuote(input.status || '')}`,
    `agent_version=${shellQuote(input.agentVersion || '')}`,
    `install_url=${shellQuote(input.installUrl || '')}`,
  ].join('\n')
}

type BootstrapTemplateData = {
  protocol: string
  transport: string
  tlsMode: ReleaseArtifact['templates'][number]['tlsMode']
  server: string
  sni: string
  certPath: string
  keyPath: string
  listenPort: number
}

function releaseTemplateString(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function releaseTemplateNumber(source: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return Math.trunc(parsed)
    }
  }
  return fallback
}

function defaultReleaseTemplateServer(node: ReleaseArtifact['node']): string {
  if (node.networkType === 'noPublicIp') {
    return node.argoTunnelDomain || node.primaryDomain || node.backupDomain || node.entryIp
  }
  return node.primaryDomain || node.entryIp || node.backupDomain || node.argoTunnelDomain
}

function buildBootstrapTemplateData(artifact: ReleaseArtifact): BootstrapTemplateData[] {
  return artifact.templates.map((template) => {
    const defaults = template.defaults || {}
    const server = releaseTemplateString(defaults, 'server', defaultReleaseTemplateServer(artifact.node))
    const sni = releaseTemplateString(defaults, 'sni', artifact.node.primaryDomain || artifact.node.argoTunnelDomain || server)
    return {
      protocol: template.protocol.toLowerCase(),
      transport: template.transport.toLowerCase(),
      tlsMode: template.tlsMode,
      server,
      sni,
      certPath: releaseTemplateString(defaults, 'certPath', '/etc/nodehubsapi/certs/server.crt'),
      keyPath: releaseTemplateString(defaults, 'keyPath', '/etc/nodehubsapi/certs/server.key'),
      listenPort: releaseTemplateNumber(defaults, ['serverPort', 'port'], template.tlsMode === 'none' ? 80 : 443),
    }
  })
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function isIpLike(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return true
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value)
}

function buildShellMultilineAssignment(name: string, values: string[]): string {
  if (values.length === 0) return `${name}=''`
  const label = `${name}_EOF`
  return `${name}=$(cat <<'${label}'\n${values.join('\n')}\n${label}\n)`
}
function getScriptAsset(name: 'agent-install.sh' | 'release-apply.sh'): string {
  if (name === 'agent-install.sh') return AGENT_INSTALL_SCRIPT_TEMPLATE
  return RELEASE_APPLY_SCRIPT_TEMPLATE
}

function renderScriptAsset(name: string, replacements: Record<string, string>): string {
  let output = getScriptAsset(name as 'agent-install.sh' | 'release-apply.sh')
  for (const [placeholder, value] of Object.entries(replacements)) {
    output = output.split(placeholder).join(value)
  }
  output = output.replace(/\r\n?/g, '\n')
  const unresolved = Array.from(new Set(output.match(/__[A-Z0-9_]+__/g) || []))
  if (unresolved.length > 0) {
    throw new Error(`Unresolved placeholders in ${name}: ${unresolved.join(', ')}`)
  }
  return output
}

export function buildReleaseApplyScript(artifact: ReleaseArtifact): string {
  const runtimeFileBlocks = buildRuntimeFileBlocks(artifact)
  const runtimeApplyBlocks = buildRuntimeApplyBlocks(artifact)
  const bootstrapBinaryApplyBlocks = buildBootstrapBinaryApplyBlocks(artifact)
  const primaryRuntimeServiceName = `nodehubsapi-runtime-${artifact.runtimes[0]?.engine || 'sing-box'}`
  const runtimePlanCount = artifact.runtimes.length
  const bootstrapBinaryCount = artifact.bootstrap.runtimeBinaries.length
  const bootstrapTemplates = buildBootstrapTemplateData(artifact)
  const tlsTemplates = bootstrapTemplates.filter((template) => template.tlsMode === 'tls' || template.protocol === 'hysteria2')
  const tlsDomains = uniqueValues(
    [
      ...tlsTemplates.flatMap((template) => [template.server, template.sni]),
      artifact.node.primaryDomain,
      artifact.node.backupDomain,
      artifact.node.argoTunnelDomain,
    ].filter((value) => value && !isIpLike(value)),
  )
  const bootstrapTlsDomains = buildShellMultilineAssignment('BOOTSTRAP_TLS_DOMAINS', tlsDomains)
  const bootstrapCertPath = tlsTemplates[0]?.certPath || '/etc/nodehubsapi/certs/server.crt'
  const bootstrapKeyPath = tlsTemplates[0]?.keyPath || '/etc/nodehubsapi/certs/server.key'
  const argoOriginPort = String(bootstrapTemplates[0]?.listenPort || artifact.node.argoTunnelPort || 443)

  return renderScriptAsset('release-apply.sh', {
    __RELEASE_ID__: shellQuote(artifact.releaseId),
    __RELEASE_REVISION__: shellQuote(String(artifact.revision)),
    __RELEASE_KIND__: shellQuote(artifact.kind),
    __RUNTIME_PRIMARY_SERVICE_NAME__: shellQuote(primaryRuntimeServiceName),
    __RUNTIME_PLAN_COUNT__: String(runtimePlanCount),
    __GITHUB_MIRROR_URL__: shellQuote(artifact.node.githubMirrorUrl || ''),
    __BOOTSTRAP_INSTALL_WARP__: artifact.bootstrap.installWarp ? '1' : '0',
    __BOOTSTRAP_INSTALL_SING_BOX__: artifact.bootstrap.installSingBox ? '1' : '0',
    __BOOTSTRAP_INSTALL_XRAY__: artifact.bootstrap.installXray ? '1' : '0',
    __BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS__: shellQuote(String(artifact.bootstrap.heartbeatIntervalSeconds || 15)),
    __BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS__: shellQuote(String(artifact.bootstrap.versionPullIntervalSeconds || 15)),
    __BOOTSTRAP_RUNTIME_BINARY_COUNT__: String(bootstrapBinaryCount),
    __BOOTSTRAP_NEEDS_CERTS__: tlsTemplates.length > 0 ? '1' : '0',
    __BOOTSTRAP_CERT_PATH__: shellQuote(bootstrapCertPath),
    __BOOTSTRAP_KEY_PATH__: shellQuote(bootstrapKeyPath),
    __BOOTSTRAP_PRIMARY_TLS_DOMAIN__: shellQuote(tlsDomains[0] || ''),
    __NODE_CF_DNS_TOKEN__: shellQuote(artifact.node.cfDnsToken || ''),
    __NODE_WARP_LICENSE_KEY__: shellQuote(artifact.bootstrap.warpLicenseKey || ''),
    __NODE_ARGO_TUNNEL_TOKEN__: shellQuote(artifact.node.argoTunnelToken || ''),
    __NODE_ARGO_TUNNEL_DOMAIN__: shellQuote(artifact.node.argoTunnelDomain || ''),
    __NODE_ARGO_ORIGIN_PORT__: shellQuote(argoOriginPort),
    __CONTROL_PLANE_AGENT_VERSION__: shellQuote(APP_VERSION),
    __BOOTSTRAP_TLS_DOMAINS__: bootstrapTlsDomains,
    __RUNTIME_FILE_BLOCKS__: runtimeFileBlocks,
    __RUNTIME_APPLY_BLOCKS__: runtimeApplyBlocks,
    __BOOTSTRAP_BINARY_APPLY_BLOCKS__: bootstrapBinaryApplyBlocks,
  })
}

export function buildAgentInstallScript(input: {
  publicBaseUrl: string
  nodeId: string
  agentToken: string
  networkType: 'public' | 'noPublicIp'
  primaryDomain: string
  backupDomain: string
  entryIp: string
  githubMirrorUrl: string
  cfDnsToken: string
  argoTunnelToken: string
  argoTunnelDomain: string
  argoTunnelPort: number
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  const installUrl = `${apiBase}/api/nodes/agent/install?nodeId=${encodeURIComponent(input.nodeId)}`
  const tlsDomains = uniqueValues([input.primaryDomain, input.backupDomain].filter((value) => value && !isIpLike(value)))
  const bootstrapTlsDomains = buildShellMultilineAssignment('BOOTSTRAP_TLS_DOMAINS', tlsDomains)

  return renderScriptAsset('agent-install.sh', {
    __API_BASE__: shellQuote(apiBase),
    __NODE_ID__: shellQuote(input.nodeId),
    __AGENT_TOKEN__: shellQuote(input.agentToken),
    __AGENT_VERSION__: shellQuote(APP_VERSION),
    __AGENT_INSTALL_URL__: shellQuote(installUrl),
    __NODE_NETWORK_TYPE__: shellQuote(input.networkType),
    __NODE_PRIMARY_DOMAIN__: shellQuote(input.primaryDomain || ''),
    __NODE_BACKUP_DOMAIN__: shellQuote(input.backupDomain || ''),
    __NODE_ENTRY_IP__: shellQuote(input.entryIp || ''),
    __GITHUB_MIRROR_URL__: shellQuote(input.githubMirrorUrl || ''),
    __NODE_CF_DNS_TOKEN__: shellQuote(input.cfDnsToken || ''),
    __NODE_ARGO_TUNNEL_TOKEN__: shellQuote(input.argoTunnelToken || ''),
    __NODE_ARGO_TUNNEL_DOMAIN__: shellQuote(input.argoTunnelDomain || ''),
    __NODE_ARGO_ORIGIN_PORT__: shellQuote(String(input.argoTunnelPort || 2053)),
    __BOOTSTRAP_NEEDS_CERTS__: input.networkType === 'public' && tlsDomains.length > 0 ? '1' : '0',
    __BOOTSTRAP_PRIMARY_TLS_DOMAIN__: shellQuote(tlsDomains[0] || input.primaryDomain || ''),
    __BOOTSTRAP_TLS_DOMAINS__: bootstrapTlsDomains,
  })
}
