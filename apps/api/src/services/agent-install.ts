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
  networkType: 'public' | 'noPublicIp'
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
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  const installUrl = `${apiBase}/api/system/install-script`
  const args = [
    `--api-base ${shellQuote(apiBase)}`,
    `--node-id ${shellQuote(input.nodeId)}`,
    `--agent-token ${shellQuote(input.agentToken)}`,
    `--network-type ${shellQuote(input.networkType)}`,
  ]
  if (input.primaryDomain) args.push(`--primary-domain ${shellQuote(input.primaryDomain)}`)
  if (input.backupDomain) args.push(`--backup-domain ${shellQuote(input.backupDomain)}`)
  if (input.entryIp) args.push(`--entry-ip ${shellQuote(input.entryIp)}`)
  if (input.githubMirrorUrl) args.push(`--github-mirror-url ${shellQuote(input.githubMirrorUrl)}`)
  if (input.heartbeatIntervalSeconds) args.push(`--heartbeat-interval ${shellQuote(String(input.heartbeatIntervalSeconds))}`)
  else args.push(`--heartbeat-interval '15'`)
  if (input.versionPullIntervalSeconds) args.push(`--version-pull-interval ${shellQuote(String(input.versionPullIntervalSeconds))}`)
  else args.push(`--version-pull-interval '15'`)
  if (input.cfDnsToken) args.push(`--cf-dns-token ${shellQuote(input.cfDnsToken)}`)
  if (input.argoTunnelToken) args.push(`--argo-tunnel-token ${shellQuote(input.argoTunnelToken)}`)
  if (input.argoTunnelDomain) args.push(`--argo-tunnel-domain ${shellQuote(input.argoTunnelDomain)}`)
  if (input.argoTunnelPort) args.push(`--argo-tunnel-port ${shellQuote(String(input.argoTunnelPort))}`)
  else args.push(`--argo-tunnel-port '2053'`)
  if (input.installWarp) args.push('--install-warp')
  if (input.warpLicenseKey.trim()) args.push(`--warp-license-key ${shellQuote(input.warpLicenseKey.trim())}`)
  const argText = args.join(' ')
  return [
    `INSTALL_URL=${shellQuote(installUrl)}`,
    'if command -v curl >/dev/null 2>&1; then curl -fsSL "$INSTALL_URL"',
    'elif command -v wget >/dev/null 2>&1; then wget -qO- "$INSTALL_URL"',
    'elif command -v busybox >/dev/null 2>&1; then busybox wget -qO- "$INSTALL_URL"',
    "else echo 'A downloader is required: curl, wget, or busybox wget.' >&2; exit 1",
    `fi | bash -s -- ${argText}`,
  ].join('; ')
}

export function buildUninstallCommand(): string {
  return [
    'set +e',
    'log() { printf \'%s\\n\' "[nodehubsapi] $*"; }',
    'warn() { printf \'%s\\n\' "[nodehubsapi] WARN: $*" >&2; }',
    'ETC_DIR="$(if [ -d /etc/nodehubsapi ]; then echo /etc/nodehubsapi; else echo "$HOME/.config/nodehubsapi"; fi)"',
    'STATE_DIR="$(if [ -d /opt/nodehubsapi ]; then echo /opt/nodehubsapi; else echo "$HOME/.local/share/nodehubsapi"; fi)"',
    'SYSTEMD_DIR=/etc/systemd/system',
    'USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"',
    'remove_autostart_block() {',
    '  local file="$1"',
    '  [ -f "$file" ] || return 0',
    '  local tmp_file',
    '  tmp_file="$(mktemp 2>/dev/null || printf \'%s.tmp\' "$file")"',
    '  awk \'BEGIN{skip=0} /# >>> nodehubsapi autostart >>>/{skip=1; next} /# <<< nodehubsapi autostart <<</{skip=0; next} skip==0 {print}\' "$file" >"$tmp_file" 2>/dev/null || { rm -f "$tmp_file"; return 1; }',
    '  cat "$tmp_file" >"$file" 2>/dev/null || { rm -f "$tmp_file"; return 1; }',
    '  rm -f "$tmp_file"',
    '}',
    'stop_service_unit() {',
    '  local service="$1"',
    '  if command -v systemctl >/dev/null 2>&1; then',
    '    systemctl stop "$service" >/dev/null 2>&1 || true',
    '    systemctl disable "$service" >/dev/null 2>&1 || true',
    '    systemctl --user stop "$service" >/dev/null 2>&1 || true',
    '    systemctl --user disable "$service" >/dev/null 2>&1 || true',
    '  fi',
    '}',
    'stop_pattern() {',
    '  local pattern="$1"',
    '  if command -v pkill >/dev/null 2>&1; then',
    '    pkill -f "$pattern" >/dev/null 2>&1 || true',
    '  elif command -v pgrep >/dev/null 2>&1; then',
    '    pgrep -f "$pattern" 2>/dev/null | xargs kill >/dev/null 2>&1 || true',
    '  fi',
    '}',
    'log "Stopping services and background processes."',
    'for service in \\',
    '  nodehubsapi-agent.service \\',
    '  nodehubsapi-runtime.service \\',
    '  nodehubsapi-runtime-sing-box.service \\',
    '  nodehubsapi-runtime-xray.service \\',
    '  nodehubsapi-cloudflared.service; do',
    '  stop_service_unit "$service"',
    'done',
    'for pattern in \\',
    '  "/usr/local/bin/nodehubsapi-agent" \\',
    '  "$HOME/.local/bin/nodehubsapi-agent" \\',
    '  "nodehubsapi-agent" \\',
    '  "/usr/local/bin/sing-box" \\',
    '  "$HOME/.local/bin/sing-box" \\',
    '  "sing-box" \\',
    '  "/usr/local/bin/xray" \\',
    '  "$HOME/.local/bin/xray" \\',
    '  "xray" \\',
    '  "/usr/local/bin/cloudflared" \\',
    '  "$HOME/.local/bin/cloudflared" \\',
    '  "cloudflared tunnel --url" \\',
    '  "cloudflared" \\',
    '  "/usr/local/bin/lego" \\',
    '  "$HOME/.local/bin/lego" \\',
    '  "lego" \\',
    '  "warp-svc" \\',
    '  "warp-cli" \\',
    '  "warp-go"; do',
    '  stop_pattern "$pattern"',
    'done',
    'if [ -f "$STATE_DIR/argo/cloudflared.pid" ]; then',
    '  kill "$(cat "$STATE_DIR/argo/cloudflared.pid" 2>/dev/null)" >/dev/null 2>&1 || true',
    'fi',
    'log "Removing service definitions and autostart hooks."',
    'rm -f "$SYSTEMD_DIR/nodehubsapi-agent.service" "$SYSTEMD_DIR/nodehubsapi-runtime.service" "$SYSTEMD_DIR/nodehubsapi-runtime-sing-box.service" "$SYSTEMD_DIR/nodehubsapi-runtime-xray.service" "$SYSTEMD_DIR/nodehubsapi-cloudflared.service"',
    'rm -f "$USER_SYSTEMD_DIR/nodehubsapi-agent.service" "$USER_SYSTEMD_DIR/nodehubsapi-runtime.service" "$USER_SYSTEMD_DIR/nodehubsapi-runtime-sing-box.service" "$USER_SYSTEMD_DIR/nodehubsapi-runtime-xray.service" "$USER_SYSTEMD_DIR/nodehubsapi-cloudflared.service"',
    'remove_autostart_block "$HOME/.profile" || warn "Failed to clean $HOME/.profile"',
    'remove_autostart_block "$HOME/.bash_profile" || warn "Failed to clean $HOME/.bash_profile"',
    'remove_autostart_block "$HOME/.bash_login" || warn "Failed to clean $HOME/.bash_login"',
    'remove_autostart_block "$HOME/.zprofile" || warn "Failed to clean $HOME/.zprofile"',
    'remove_autostart_block "/etc/rc.local" || true',
    'remove_autostart_block "/etc/rc.d/rc.local" || true',
    'if command -v systemctl >/dev/null 2>&1; then',
    '  systemctl daemon-reload >/dev/null 2>&1 || true',
    '  systemctl --user daemon-reload >/dev/null 2>&1 || true',
    'fi',
    'log "Removing binaries."',
    'rm -f /usr/local/bin/nodehubsapi-agent /usr/local/bin/sing-box /usr/local/bin/xray /usr/local/bin/cloudflared /usr/local/bin/lego',
    'rm -f "$HOME/.local/bin/nodehubsapi-agent" "$HOME/.local/bin/sing-box" "$HOME/.local/bin/xray" "$HOME/.local/bin/cloudflared" "$HOME/.local/bin/lego"',
    'log "Removing configuration and state directories."',
    'rm -rf /etc/nodehubsapi /opt/nodehubsapi "$HOME/.config/nodehubsapi" "$HOME/.local/share/nodehubsapi"',
    'log "Uninstall completed. nodehubsapi files, services, and runtime artifacts were removed."',
  ].join('\n')
}

function buildRuntimeFileBlocks(artifact: ReleaseArtifact): string {
  if (artifact.kind !== 'runtime') return ':'
  const releaseMetadata = {
    releaseId: artifact.releaseId,
    revision: artifact.revision,
    kind: artifact.kind,
    configRevision: artifact.configRevision,
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

function buildRuntimePlanSetupBlock(runtime: ReleaseArtifact['runtimes'][number]): string {
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
  ].join('\n')
}

function buildRuntimePrepareBlocks(artifact: ReleaseArtifact): string {
  return artifact.runtimes
    .map((runtime) => {
      return [
        buildRuntimePlanSetupBlock(runtime),
        '  ensure_runtime_binary_ready',
      ].join('\n')
    })
    .join('\n')
}

function buildRuntimeApplyBlocks(artifact: ReleaseArtifact): string {
  return artifact.runtimes
    .map((runtime) => {
      return [
        buildRuntimePlanSetupBlock(runtime),
        '  resolve_runtime_install_path',
        '  write_runtime_service',
        '  restart_runtime_service',
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
    `release_status=${shellQuote(input.status || '')}`,
    `agent_version=${shellQuote(input.agentVersion || '')}`,
    `install_url=${shellQuote(input.installUrl || '')}`,
  ].join('\n')
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
  const runtimePrepareBlocks = buildRuntimePrepareBlocks(artifact)
  const runtimeApplyBlocks = buildRuntimeApplyBlocks(artifact)
  const primaryRuntimeServiceName = `nodehubsapi-runtime-${artifact.runtimes[0]?.engine || 'sing-box'}`
  const runtimePlanCount = artifact.runtimes.length
  const argoOriginPort = String(artifact.node.argoTunnelPort || 2053)

  return renderScriptAsset('release-apply.sh', {
    __RELEASE_ID__: shellQuote(artifact.releaseId),
    __RELEASE_REVISION__: shellQuote(String(artifact.revision)),
    __RELEASE_KIND__: shellQuote('runtime'),
    __RUNTIME_PRIMARY_SERVICE_NAME__: shellQuote(primaryRuntimeServiceName),
    __RUNTIME_PLAN_COUNT__: String(runtimePlanCount),
    __GITHUB_MIRROR_URL__: shellQuote(artifact.node.githubMirrorUrl || ''),
    __NODE_CF_DNS_TOKEN__: shellQuote(artifact.node.cfDnsToken || ''),
    __NODE_WARP_LICENSE_KEY__: shellQuote(''),
    __NODE_ARGO_TUNNEL_TOKEN__: shellQuote(artifact.node.argoTunnelToken || ''),
    __NODE_ARGO_TUNNEL_DOMAIN__: shellQuote(artifact.node.argoTunnelDomain || ''),
    __NODE_ARGO_ORIGIN_PORT__: shellQuote(argoOriginPort),
    __RUNTIME_FILE_BLOCKS__: runtimeFileBlocks,
    __RUNTIME_PREPARE_BLOCKS__: runtimePrepareBlocks,
    __RUNTIME_APPLY_BLOCKS__: runtimeApplyBlocks,
  })
}

export function buildAgentInstallScript(input: {
  publicBaseUrl: string
  nodeId?: string
  agentToken?: string
  networkType?: 'public' | 'noPublicIp'
  primaryDomain?: string
  backupDomain?: string
  entryIp?: string
  githubMirrorUrl?: string
  installWarp?: boolean
  warpLicenseKey?: string
  heartbeatIntervalSeconds?: number
  versionPullIntervalSeconds?: number
  cfDnsToken?: string
  argoTunnelToken?: string
  argoTunnelDomain?: string
  argoTunnelPort?: number
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  const nodeId = input.nodeId || ''
  const installUrl = nodeId
    ? `${apiBase}/api/nodes/agent/install?nodeId=${encodeURIComponent(nodeId)}`
    : `${apiBase}/api/system/install-script`
  const tlsDomains = uniqueValues([input.primaryDomain || '', input.backupDomain || ''].filter((value) => value && !isIpLike(value)))
  const bootstrapTlsDomains = buildShellMultilineAssignment('BOOTSTRAP_TLS_DOMAINS', tlsDomains)

  return renderScriptAsset('agent-install.sh', {
    __API_BASE__: shellQuote(apiBase),
    __NODE_ID__: shellQuote(nodeId),
    __AGENT_TOKEN__: shellQuote(input.agentToken || ''),
    __AGENT_VERSION__: shellQuote(APP_VERSION),
    __AGENT_INSTALL_URL__: shellQuote(installUrl),
    __NODE_NETWORK_TYPE__: shellQuote(input.networkType || 'public'),
    __NODE_PRIMARY_DOMAIN__: shellQuote(input.primaryDomain || ''),
    __NODE_BACKUP_DOMAIN__: shellQuote(input.backupDomain || ''),
    __NODE_ENTRY_IP__: shellQuote(input.entryIp || ''),
    __GITHUB_MIRROR_URL__: shellQuote(input.githubMirrorUrl || ''),
    __NODE_INSTALL_WARP__: input.installWarp ? '1' : '0',
    __NODE_WARP_LICENSE_KEY__: shellQuote(input.warpLicenseKey || ''),
    __HEARTBEAT_INTERVAL_SECONDS__: shellQuote(String(input.heartbeatIntervalSeconds || 15)),
    __VERSION_PULL_INTERVAL_SECONDS__: shellQuote(String(input.versionPullIntervalSeconds || 15)),
    __NODE_CF_DNS_TOKEN__: shellQuote(input.cfDnsToken || ''),
    __NODE_ARGO_TUNNEL_TOKEN__: shellQuote(input.argoTunnelToken || ''),
    __NODE_ARGO_TUNNEL_DOMAIN__: shellQuote(input.argoTunnelDomain || ''),
    __NODE_ARGO_ORIGIN_PORT__: shellQuote(String(input.argoTunnelPort || 2053)),
    __BOOTSTRAP_NEEDS_CERTS__: (input.networkType || 'public') === 'public' && tlsDomains.length > 0 ? '1' : '0',
    __BOOTSTRAP_PRIMARY_TLS_DOMAIN__: shellQuote(tlsDomains[0] || input.primaryDomain || ''),
    __BOOTSTRAP_TLS_DOMAINS__: bootstrapTlsDomains,
  })
}
