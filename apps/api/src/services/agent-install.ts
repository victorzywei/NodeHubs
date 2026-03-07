import type { ReleaseArtifact } from '@contracts/index'
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
        `  RUNTIME_DOWNLOAD_BASE_URL=${shellQuote(runtime.binary.downloadBaseUrl)}`,
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

export function buildReleaseApplyScript(artifact: ReleaseArtifact): string {
  const runtimeFileBlocks = buildRuntimeFileBlocks(artifact)
  const runtimeApplyBlocks = buildRuntimeApplyBlocks(artifact)
  const primaryRuntimeServiceName = `nodehubsapi-runtime-${artifact.runtimes[0]?.engine || 'sing-box'}`
  const runtimePlanCount = artifact.runtimes.length
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

  return `#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID=${shellQuote(artifact.releaseId)}
RELEASE_KIND=${shellQuote(artifact.kind)}
RUNTIME_PRIMARY_SERVICE_NAME=${shellQuote(primaryRuntimeServiceName)}
RUNTIME_PLAN_COUNT=${runtimePlanCount}
ETC_DIR="\${ETC_DIR:-/etc/nodehubsapi}"
STATE_DIR="\${STATE_DIR:-/opt/nodehubsapi}"
RUNTIME_BIN_DIR="\${RUNTIME_BIN_DIR:-/usr/local/bin}"
INSTALL_MODE="\${INSTALL_MODE:-}"
USE_SYSTEMD="\${USE_SYSTEMD:-0}"
SYSTEMCTL_USER_FLAG="\${SYSTEMCTL_USER_FLAG:-}"
SYSTEMD_DIR="\${SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMD_WANTED_BY="\${SYSTEMD_WANTED_BY:-multi-user.target}"
GITHUB_MIRROR_URL=${shellQuote(artifact.node.githubMirrorUrl || '')}
BOOTSTRAP_INSTALL_WARP=${artifact.bootstrap.installWarp ? '1' : '0'}
BOOTSTRAP_INSTALL_ARGO=${artifact.bootstrap.installArgo ? '1' : '0'}
BOOTSTRAP_NEEDS_CERTS=${tlsTemplates.length > 0 ? '1' : '0'}
BOOTSTRAP_CERT_PATH=${shellQuote(bootstrapCertPath)}
BOOTSTRAP_KEY_PATH=${shellQuote(bootstrapKeyPath)}
BOOTSTRAP_PRIMARY_TLS_DOMAIN=${shellQuote(tlsDomains[0] || '')}
NODE_CF_DNS_TOKEN=${shellQuote(artifact.node.cfDnsToken || '')}
NODE_WARP_LICENSE_KEY=${shellQuote(artifact.node.warpLicenseKey || '')}
NODE_ARGO_TUNNEL_TOKEN=${shellQuote(artifact.node.argoTunnelToken || '')}
NODE_ARGO_TUNNEL_DOMAIN=${shellQuote(artifact.node.argoTunnelDomain || '')}
NODE_ARGO_ORIGIN_PORT=${shellQuote(argoOriginPort)}
CONTROL_PLANE_AGENT_VERSION=${shellQuote(APP_VERSION)}
AGENT_UPGRADED=0
${bootstrapTlsDomains}

json_escape() {
  local value="$1"
  value="\${value//\\/\\\\}"
  value="\${value//\"/\\\"}"
  value="\${value//$'\\n'/\\n}"
  value="\${value//$'\\r'/\\r}"
  value="\${value//$'\\t'/\\t}"
  printf '"%s"' "$value"
}

log() {
  printf '%s\n' "[nodehubsapi] $*"
}

warn() {
  printf '%s\n' "[nodehubsapi] WARN: $*" >&2
}

is_root() {
  [ "\${EUID:-$(id -u)}" -eq 0 ]
}

run_systemctl() {
  if [ "$USE_SYSTEMD" != "1" ]; then
    return 1
  fi
  systemctl $SYSTEMCTL_USER_FLAG "$@"
}

detect_execution_mode() {
  if [ -z "$INSTALL_MODE" ]; then
    if is_root; then
      INSTALL_MODE="system"
    else
      INSTALL_MODE="user"
    fi
  fi

  if [ "$INSTALL_MODE" = "user" ]; then
    case "$ETC_DIR" in
      ''|/etc/nodehubsapi) ETC_DIR="$HOME/.config/nodehubsapi" ;;
    esac
    case "$STATE_DIR" in
      ''|/opt/nodehubsapi) STATE_DIR="$HOME/.local/share/nodehubsapi" ;;
    esac
    case "$RUNTIME_BIN_DIR" in
      ''|/usr/local/bin) RUNTIME_BIN_DIR="$HOME/.local/bin" ;;
    esac
    SYSTEMCTL_USER_FLAG="--user"
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    SYSTEMD_WANTED_BY="default.target"
  fi

  if ! mkdir -p "$ETC_DIR" "$STATE_DIR" "$RUNTIME_BIN_DIR" >/dev/null 2>&1; then
    if [ "$INSTALL_MODE" = "system" ]; then
      warn "No permission for system directories; switching release apply to user mode."
      INSTALL_MODE="user"
      ETC_DIR="$HOME/.config/nodehubsapi"
      STATE_DIR="$HOME/.local/share/nodehubsapi"
      RUNTIME_BIN_DIR="$HOME/.local/bin"
      SYSTEMCTL_USER_FLAG="--user"
      SYSTEMD_DIR="$HOME/.config/systemd/user"
      SYSTEMD_WANTED_BY="default.target"
      mkdir -p "$ETC_DIR" "$STATE_DIR" "$RUNTIME_BIN_DIR"
    else
      echo "Cannot create directories for release apply." >&2
      exit 1
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    if [ "$INSTALL_MODE" = "user" ]; then
      if systemctl --user show-environment >/dev/null 2>&1; then
        USE_SYSTEMD=1
      else
        USE_SYSTEMD=0
        warn "systemd --user unavailable; runtime processes will run in background mode."
      fi
    elif [ -d /run/systemd/system ]; then
      USE_SYSTEMD=1
      SYSTEMCTL_USER_FLAG=""
      SYSTEMD_DIR="/etc/systemd/system"
      SYSTEMD_WANTED_BY="multi-user.target"
    else
      USE_SYSTEMD=0
      warn "systemd unavailable; runtime processes will run in background mode."
    fi
  else
    USE_SYSTEMD=0
    warn "systemctl command not found; runtime processes will run in background mode."
  fi
}

resolve_runtime_install_path() {
  if [ "$INSTALL_MODE" = "user" ]; then
    mkdir -p "$RUNTIME_BIN_DIR"
    RUNTIME_INSTALL_PATH="$RUNTIME_BIN_DIR/$RUNTIME_BINARY_NAME"
    return 0
  fi
  RUNTIME_INSTALL_PATH="$RUNTIME_INSTALL_PATH_DEFAULT"
}

wrap_github_url() {
  local url="$1"
  if [ -n "$GITHUB_MIRROR_URL" ] && [[ "$url" == https://github.com/* ]]; then
    printf '%s/%s' "\${GITHUB_MIRROR_URL%/}" "$url"
    return 0
  fi
  printf '%s' "$url"
}

http_get_to_file() {
  local url="$1"
  local target="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -H "X-Agent-Token: $AGENT_TOKEN" "$url" -o "$target"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$target" --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO "$target" --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  echo "A downloader is required: curl, wget, or busybox wget." >&2
  return 1
}

http_download_to_file() {
  local url="$1"
  local target="$2"
  local resolved_url
  resolved_url="$(wrap_github_url "$url")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$resolved_url" -o "$target"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$target" "$resolved_url"
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO "$target" "$resolved_url"
    return 0
  fi
  echo "A downloader is required: curl, wget, or busybox wget." >&2
  return 1
}

post_json() {
  local url="$1"
  local body="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -X POST -H "Content-Type: application/json" -H "X-Agent-Token: $AGENT_TOKEN" --data "$body" "$url" >/dev/null
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --header="Content-Type: application/json" --header="X-Agent-Token: $AGENT_TOKEN" --post-data="$body" "$url" >/dev/null
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO- --header="Content-Type: application/json" --header="X-Agent-Token: $AGENT_TOKEN" --post-data="$body" "$url" >/dev/null
    return 0
  fi
  echo "A POST-capable downloader is required." >&2
  return 1
}

refresh_agent_installation_if_needed() {
  if [ "\${AGENT_VERSION:-}" = "$CONTROL_PLANE_AGENT_VERSION" ]; then
    return 0
  fi
  local install_url script_file
  install_url="$API_BASE/api/nodes/agent/install?nodeId=$NODE_ID"
  script_file="$(mktemp)"
  if ! http_get_to_file "$install_url" "$script_file"; then
    rm -f "$script_file"
    echo "Failed to download the nodehubsapi agent installer." >&2
    return 1
  fi
  chmod +x "$script_file"
  if ! bash "$script_file"; then
    rm -f "$script_file"
    echo "Failed to refresh the nodehubsapi agent." >&2
    return 1
  fi
  rm -f "$script_file"
  AGENT_UPGRADED=1
}

schedule_agent_restart_if_needed() {
  if [ "$AGENT_UPGRADED" != "1" ]; then
    return 0
  fi
  if [ "$USE_SYSTEMD" = "1" ]; then
    /bin/sh -lc 'sleep 2; true' >/dev/null 2>&1
    run_systemctl restart nodehubsapi-agent.service >/dev/null 2>&1 || true
  fi
}

ack_release() {
  local status="$1"
  local message="$2"
  local payload
  payload=$(cat <<EOF_JSON
{
  "nodeId": $(json_escape "$NODE_ID"),
  "status": $(json_escape "$status"),
  "message": $(json_escape "$message")
}
EOF_JSON
)
  post_json "$API_BASE/api/nodes/agent/releases/$RELEASE_ID/ack" "$payload" || true
}

render_template() {
  local value="$1"
  local arch="$2"
  value="\${value//\\{version\\}/$RUNTIME_VERSION}"
  value="\${value//\\{arch\\}/$arch}"
  value="\${value//\\{config_path\\}/$RUNTIME_CONFIG_PATH}"
  printf '%s' "$value"
}

package_install() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null 2>&1
    return $?
  fi
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y "$@" >/dev/null 2>&1
    return $?
  fi
  if command -v yum >/dev/null 2>&1; then
    yum install -y "$@" >/dev/null 2>&1
    return $?
  fi
  if command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install -y "$@" >/dev/null 2>&1
    return $?
  fi
  if command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm "$@" >/dev/null 2>&1
    return $?
  fi
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache "$@" >/dev/null 2>&1
    return $?
  fi
  return 1
}

ensure_command() {
  local cmd="$1"
  shift || true
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$#" -gt 0 ] && package_install "$@"; then
    command -v "$cmd" >/dev/null 2>&1
    return $?
  fi
  return 1
}

resolve_runtime_arch() {
  local machine
  machine="$(uname -m 2>/dev/null || true)"
  case "$RUNTIME_ENGINE:$machine" in
    sing-box:x86_64|sing-box:amd64) echo amd64 ;;
    sing-box:aarch64|sing-box:arm64) echo arm64 ;;
    sing-box:armv7l|sing-box:armv7) echo armv7 ;;
    sing-box:armv6l|sing-box:armv6) echo armv6 ;;
    sing-box:armv5l|sing-box:armv5) echo armv5 ;;
    sing-box:i386|sing-box:i686) echo 386 ;;
    sing-box:loongarch64) echo loong64 ;;
    sing-box:mips) echo mips-softfloat ;;
    sing-box:mips64) echo mips64-softfloat ;;
    sing-box:mips64le) echo mips64le ;;
    sing-box:mipsle) echo mipsle-softfloat ;;
    sing-box:ppc64le) echo ppc64le ;;
    sing-box:riscv64) echo riscv64 ;;
    sing-box:s390x) echo s390x ;;
    xray:x86_64|xray:amd64) echo 64 ;;
    xray:aarch64|xray:arm64) echo arm64-v8a ;;
    xray:armv7l|xray:armv7) echo arm32-v7a ;;
    xray:armv6l|xray:armv6) echo arm32-v6 ;;
    xray:armv5l|xray:armv5) echo arm32-v5 ;;
    xray:i386|xray:i686) echo 32 ;;
    xray:loongarch64) echo loong64 ;;
    xray:mips) echo mips32 ;;
    xray:mips64) echo mips64 ;;
    xray:mips64le) echo mips64le ;;
    xray:mipsle) echo mips32le ;;
    xray:ppc64) echo ppc64 ;;
    xray:ppc64le) echo ppc64le ;;
    xray:riscv64) echo riscv64 ;;
    xray:s390x) echo s390x ;;
    *)
      echo "Unsupported runtime architecture: $machine for $RUNTIME_ENGINE" >&2
      return 1
      ;;
  esac
}

install_binary_file() {
  local source="$1"
  local target="$2"
  mkdir -p "$(dirname "$target")"
  if command -v install >/dev/null 2>&1; then
    install -m 0755 "$source" "$target"
    return 0
  fi
  cp "$source" "$target"
  chmod 0755 "$target"
}

extract_zip() {
  local archive="$1"
  local target_dir="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -qo "$archive" -d "$target_dir"
    return 0
  fi
  if command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$archive" -C "$target_dir"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$archive" "$target_dir" <<'PY'
import pathlib
import sys
import zipfile

archive_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])
target_path.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive_path) as archive:
    archive.extractall(target_path)
PY
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox unzip -qo "$archive" -d "$target_dir"
    return 0
  fi
  if ensure_command unzip unzip; then
    unzip -qo "$archive" -d "$target_dir"
    return 0
  fi
  echo "No zip extractor available. Need unzip, bsdtar, python3, or busybox unzip." >&2
  return 1
}

extract_archive() {
  local archive="$1"
  local target_dir="$2"
  mkdir -p "$target_dir"
  case "$RUNTIME_ARCHIVE_FORMAT" in
    tar.gz)
      ensure_command tar tar || {
        echo "tar is required to extract runtime archives." >&2
        return 1
      }
      tar -xzf "$archive" -C "$target_dir"
      ;;
    zip)
      extract_zip "$archive" "$target_dir"
      ;;
    *)
      echo "Unsupported archive format: $RUNTIME_ARCHIVE_FORMAT" >&2
      return 1
      ;;
  esac
}

install_runtime_binary() {
  local arch asset_name binary_rel archive_file unpack_dir download_url source_binary
  arch="$(resolve_runtime_arch)"
  asset_name="$(render_template "$RUNTIME_ASSET_TEMPLATE" "$arch")"
  binary_rel="$(render_template "$RUNTIME_BINARY_PATH_TEMPLATE" "$arch")"
  archive_file="$TMP_DIR/$asset_name"
  unpack_dir="$TMP_DIR/unpack"
  download_url="$RUNTIME_DOWNLOAD_BASE_URL/$asset_name"

  rm -rf "$unpack_dir"
  mkdir -p "$unpack_dir"

  http_download_to_file "$download_url" "$archive_file"
  extract_archive "$archive_file" "$unpack_dir"

  source_binary="$unpack_dir/$binary_rel"
  if [ ! -f "$source_binary" ]; then
    echo "Runtime binary not found after extraction: $source_binary" >&2
    return 1
  fi

  install_binary_file "$source_binary" "$RUNTIME_INSTALL_PATH"
}

resolve_lego_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l|armv7) echo armv7 ;;
    i386|i686) echo 386 ;;
    *)
      return 1
      ;;
  esac
}

resolve_cloudflared_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l|armv7) echo arm ;;
    i386|i686) echo 386 ;;
    *)
      return 1
      ;;
  esac
}

resolve_warpgo_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l|armv7) echo armv7 ;;
    *)
      return 1
      ;;
  esac
}

guess_acme_email() {
  local domain="$1"
  local zone="$domain"
  if [ "$(printf '%s' "$domain" | awk -F '.' '{ print NF }')" -gt 2 ]; then
    zone="\${domain#*.}"
  fi
  if [ -z "$zone" ]; then
    zone="example.com"
  fi
  printf 'hostmaster@%s' "$zone"
}

install_lego_binary() {
  local target="$RUNTIME_BIN_DIR/lego"
  local version="v4.28.1"
  local arch asset archive_file unpack_dir
  if [ -x "$target" ]; then
    printf '%s' "$target"
    return 0
  fi
  arch="$(resolve_lego_arch)" || {
    warn "lego is not available for this architecture."
    return 1
  }
  ensure_command tar tar || {
    warn "tar is required to install lego."
    return 1
  }
  asset="lego_\${version#v}_linux_\${arch}.tar.gz"
  archive_file="$TMP_DIR/$asset"
  unpack_dir="$TMP_DIR/lego"
  mkdir -p "$unpack_dir"
  http_download_to_file "https://github.com/go-acme/lego/releases/download/\${version}/\${asset}" "$archive_file"
  tar -xzf "$archive_file" -C "$unpack_dir"
  install_binary_file "$unpack_dir/lego" "$target"
  printf '%s' "$target"
}

issue_cloudflare_certificate() {
  local lego_bin="$1"
  local primary_domain="$BOOTSTRAP_PRIMARY_TLS_DOMAIN"
  local certs_dir="$STATE_DIR/lego"
  local cert_source key_source email
  if [ -z "$primary_domain" ]; then
    primary_domain="$(printf '%s\n' "$BOOTSTRAP_TLS_DOMAINS" | awk 'NF { print; exit }')"
  fi
  [ -n "$primary_domain" ] || return 1
  email="$(guess_acme_email "$primary_domain")"
  mkdir -p "$certs_dir"
  local args=(--accept-tos --path "$certs_dir" --email "$email" --dns cloudflare)
  while IFS= read -r domain; do
    [ -n "$domain" ] || continue
    args+=(--domains "$domain")
  done <<< "$BOOTSTRAP_TLS_DOMAINS"
  CLOUDFLARE_DNS_API_TOKEN="$NODE_CF_DNS_TOKEN" "$lego_bin" "\${args[@]}" run >/dev/null
  cert_source="$certs_dir/certificates/\${primary_domain}.crt"
  key_source="$certs_dir/certificates/\${primary_domain}.key"
  [ -s "$cert_source" ] && [ -s "$key_source" ] || return 1
  mkdir -p "$(dirname "$BOOTSTRAP_CERT_PATH")"
  cp "$cert_source" "$BOOTSTRAP_CERT_PATH"
  cp "$key_source" "$BOOTSTRAP_KEY_PATH"
}

generate_self_signed_certificate() {
  local primary_domain="$BOOTSTRAP_PRIMARY_TLS_DOMAIN"
  local openssl_conf="$TMP_DIR/openssl.cnf"
  local san_lines=""
  local index=1
  [ -n "$primary_domain" ] || primary_domain="localhost"
  ensure_command openssl openssl || {
    echo "openssl is required to generate fallback certificates." >&2
    return 1
  }
  while IFS= read -r domain; do
    [ -n "$domain" ] || continue
    san_lines="$san_lines"$'\n'"DNS.\${index} = \${domain}"
    index=$((index + 1))
  done <<< "$BOOTSTRAP_TLS_DOMAINS"
  if [ -z "$san_lines" ]; then
    san_lines=$'\n'"DNS.1 = \${primary_domain}"
  fi
  cat >"$openssl_conf" <<EOF
[req]
prompt = no
default_bits = 2048
default_md = sha256
distinguished_name = dn
x509_extensions = req_ext

[dn]
CN = \${primary_domain}

[req_ext]
subjectAltName = @alt_names

[alt_names]\${san_lines}
EOF
  mkdir -p "$(dirname "$BOOTSTRAP_CERT_PATH")"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout "$BOOTSTRAP_KEY_PATH" -out "$BOOTSTRAP_CERT_PATH" -config "$openssl_conf" >/dev/null 2>&1
}

ensure_tls_certificate() {
  if [ "$BOOTSTRAP_NEEDS_CERTS" != "1" ]; then
    return 0
  fi
  if [ -s "$BOOTSTRAP_CERT_PATH" ] && [ -s "$BOOTSTRAP_KEY_PATH" ]; then
    return 0
  fi
  if [ -n "$NODE_CF_DNS_TOKEN" ] && [ -n "$BOOTSTRAP_TLS_DOMAINS" ]; then
    local lego_bin
    if lego_bin="$(install_lego_binary)"; then
      if issue_cloudflare_certificate "$lego_bin"; then
        log "Issued TLS certificate via lego + Cloudflare DNS."
        return 0
      fi
      warn "lego certificate issuance failed, falling back to self-signed."
    fi
  fi
  generate_self_signed_certificate
  log "Generated fallback self-signed certificate."
}

decode_base64_flexible() {
  local input="$1"
  local normalized mod
  normalized="$(printf '%s' "$input" | tr '_-' '/+')"
  mod=$((\${#normalized} % 4))
  if [ "$mod" -eq 2 ]; then
    normalized="\${normalized}=="
  elif [ "$mod" -eq 3 ]; then
    normalized="\${normalized}="
  elif [ "$mod" -eq 1 ]; then
    return 1
  fi
  printf '%s' "$normalized" | base64 -d 2>/dev/null
}

json_get_string() {
  local json="$1"
  local key="$2"
  printf '%s' "$json" | tr -d '\r\n' | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n1 | sed 's/.*:[[:space:]]*"//; s/"$//'
}

json_get_number() {
  local json="$1"
  local key="$2"
  printf '%s' "$json" | tr -d '\r\n' | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[0-9][0-9]*" | head -n1 | sed 's/.*:[[:space:]]*//'
}

normalize_warp_v6() {
  local raw="$1"
  local value
  value="$(printf '%s' "$raw" | tr -d '[:space:]')"
  value="\${value%%/*}"
  if [[ "$value" =~ ^\\[([0-9A-Fa-f:]+)\\](:[0-9]+)?$ ]]; then
    printf '%s' "\${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$value" == \\[*\\]:* ]]; then
    value="\${value#\\[}"
    value="\${value%%\\]:*}"
  fi
  printf '%s' "$value"
}

normalize_warp_endpoint() {
  local host_raw="$1"
  local port_raw="$2"
  local host port
  host="$(printf '%s' "$host_raw" | tr -d '[:space:]')"
  port="$(printf '%s' "$port_raw" | tr -d '[:space:]')"
  if [[ "$host" =~ ^\\[(.+)\\]:([0-9]+)$ ]]; then
    host="\${BASH_REMATCH[1]}"
    [ -z "$port" ] && port="\${BASH_REMATCH[2]}"
  elif [[ "$host" =~ ^(.+):([0-9]+)$ ]] && [[ "$host" != *:*:* ]]; then
    host="\${BASH_REMATCH[1]}"
    [ -z "$port" ] && port="\${BASH_REMATCH[2]}"
  fi
  [ -n "$host" ] || host="engage.cloudflareclient.com"
  if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ || "$port" -lt 1 || "$port" -gt 65535 ]]; then
    port="2408"
  fi
  printf '%s:%s' "$host" "$port"
}

save_warp_runtime() {
  local warp_dir="$1"
  local private_key="$2"
  local ipv6="$3"
  local reserved="$4"
  local endpoint="$5"
  mkdir -p "$warp_dir"
  printf '%s\n' "$private_key" > "$warp_dir/private_key"
  printf '%s\n' "$ipv6" > "$warp_dir/v6"
  printf '%s\n' "$reserved" > "$warp_dir/reserved"
  printf '%s\n' "$endpoint" > "$warp_dir/endpoint"
}

install_warpgo_binary() {
  local target="$RUNTIME_BIN_DIR/warp-go"
  local version="v1.0.8"
  local arch asset archive_file unpack_dir candidate
  if [ -x "$target" ]; then
    printf '%s' "$target"
    return 0
  fi
  arch="$(resolve_warpgo_arch)" || {
    warn "warp-go is not available for this architecture."
    return 1
  }
  ensure_command tar tar || {
    warn "tar is required to install warp-go."
    return 1
  }
  asset="warp-go_\${version#v}_linux_\${arch}.tar.gz"
  archive_file="$TMP_DIR/$asset"
  unpack_dir="$TMP_DIR/warp-go"
  mkdir -p "$unpack_dir"
  http_download_to_file "https://gitlab.com/ProjectWARP/warp-go/-/releases/\${version}/downloads/\${asset}" "$archive_file"
  tar -xzf "$archive_file" -C "$unpack_dir"
  candidate="$(find "$unpack_dir" -maxdepth 3 -type f -name 'warp-go' | head -n1 || true)"
  [ -n "$candidate" ] || return 1
  install_binary_file "$candidate" "$target"
  printf '%s' "$target"
}

ensure_warp_allowed_ips() {
  local config_file="$1"
  if grep -q '^AllowedIPs[[:space:]]*=' "$config_file" 2>/dev/null; then
    return 0
  fi
  printf '%s\n' 'AllowedIPs = 0.0.0.0/0, ::/0' >> "$config_file"
}

register_warp_via_api() {
  local warp_dir="$STATE_DIR/warp"
  local config_file="$warp_dir/warp.conf"
  local wg_bin reg_api reg_payload response private_key public_key tos serial
  local device_id access_token ipv6 host port client_id_b64 reserved endpoint bytes b1 b2 b3
  mkdir -p "$warp_dir"
  if [ -s "$config_file" ] && [ -s "$warp_dir/private_key" ] && [ -s "$warp_dir/v6" ]; then
    return 0
  fi
  ensure_command curl curl ca-certificates || return 1
  ensure_command wg wireguard-tools || return 1
  wg_bin="$(command -v wg)"
  reg_api="https://api.cloudflareclient.com/v0a4005/reg"
  private_key="$("$wg_bin" genkey 2>/dev/null || true)"
  [ -n "$private_key" ] || return 1
  public_key="$(printf '%s' "$private_key" | "$wg_bin" pubkey 2>/dev/null || true)"
  [ -n "$public_key" ] || return 1
  tos="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  serial="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || true)"
  [ -n "$serial" ] || serial="$(date +%s)-$RANDOM"
  reg_payload="$(printf '{"key":"%s","install_id":"","fcm_token":"","tos":"%s","model":"PC","serial_number":"%s","locale":"en_US","warp_enabled":true}' "$public_key" "$tos" "$serial")"
  response="$(curl -fsS "$reg_api" -X POST -H "Content-Type: application/json; charset=UTF-8" -H "Accept: application/json" -H "User-Agent: okhttp/3.12.1" -H "CF-Client-Version: a-6.30-3596" --data "$reg_payload" 2>/dev/null || true)"
  [ -n "$response" ] || return 1
  device_id="$(json_get_string "$response" "id")"
  access_token="$(json_get_string "$response" "token")"
  ipv6="$(normalize_warp_v6 "$(json_get_string "$response" "v6")")"
  host="$(json_get_string "$response" "host")"
  port="$(json_get_number "$response" "port")"
  client_id_b64="$(json_get_string "$response" "client_id")"
  [ -n "$device_id" ] && [ -n "$access_token" ] || return 1
  if [ -n "$NODE_WARP_LICENSE_KEY" ]; then
    curl -fsS "\${reg_api}/\${device_id}/account" -X PUT -H "Content-Type: application/json; charset=UTF-8" -H "Accept: application/json" -H "Authorization: Bearer \${access_token}" --data "$(printf '{"license":"%s"}' "$NODE_WARP_LICENSE_KEY")" >/dev/null 2>&1 || true
  fi
  endpoint="$(normalize_warp_endpoint "$host" "$port")"
  reserved="0,0,0"
  if [ -n "$client_id_b64" ] && command -v od >/dev/null 2>&1 && command -v base64 >/dev/null 2>&1; then
    bytes="$(decode_base64_flexible "$client_id_b64" | od -An -t u1 2>/dev/null | tr -s ' ' | sed 's/^ //')"
    b1="$(echo "$bytes" | awk '{print $1}')"
    b2="$(echo "$bytes" | awk '{print $2}')"
    b3="$(echo "$bytes" | awk '{print $3}')"
    if [ -n "$b1" ] && [ -n "$b2" ] && [ -n "$b3" ]; then
      reserved="\${b1},\${b2},\${b3}"
    fi
  fi
  cat >"$config_file" <<EOF
PrivateKey = \${private_key}
Address6 = \${ipv6}/128
Endpoint = \${endpoint}
Reserved = \${reserved}
DeviceID = \${device_id}
Token = \${access_token}
AllowedIPs = 0.0.0.0/0, ::/0
EOF
  save_warp_runtime "$warp_dir" "$private_key" "$ipv6" "$reserved" "$endpoint"
}

register_warp_with_warpgo() {
  local warp_bin="$1"
  local warp_dir="$STATE_DIR/warp"
  local config_file="$warp_dir/warp.conf"
  local private_key ipv6 endpoint reserved
  mkdir -p "$warp_dir"
  "$warp_bin" --register --config "$config_file" >/dev/null 2>&1
  if [ -n "$NODE_WARP_LICENSE_KEY" ]; then
    if grep -q '^LicenseKey[[:space:]]*=' "$config_file" 2>/dev/null; then
      sed -i "s/^LicenseKey[[:space:]]*=.*/LicenseKey = $NODE_WARP_LICENSE_KEY/" "$config_file"
    else
      printf 'LicenseKey = %s\n' "$NODE_WARP_LICENSE_KEY" >> "$config_file"
    fi
    "$warp_bin" --update --config "$config_file" >/dev/null 2>&1 || true
  fi
  ensure_warp_allowed_ips "$config_file"
  private_key="$(sed -n 's/^PrivateKey[[:space:]]*=[[:space:]]*//p' "$config_file" | head -n1)"
  ipv6="$(sed -n 's/^Address6[[:space:]]*=[[:space:]]*//p' "$config_file" | head -n1 | sed 's#/.*##')"
  endpoint="$(sed -n 's/^Endpoint[[:space:]]*=[[:space:]]*//p' "$config_file" | head -n1)"
  reserved="$(sed -n 's/^Reserved[[:space:]]*=[[:space:]]*//p' "$config_file" | head -n1)"
  save_warp_runtime "$warp_dir" "$private_key" "$ipv6" "$reserved" "$endpoint"
}

write_warp_service() {
  local warp_bin="$1"
  local config_file="$STATE_DIR/warp/warp.conf"
  local service_file="$SYSTEMD_DIR/nodehubsapi-warp.service"
  [ "$USE_SYSTEMD" = "1" ] || return 0
  mkdir -p "$SYSTEMD_DIR"
  cat >"$service_file" <<EOF
[Unit]
Description=nodehubsapi warp-go
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=\${warp_bin} --foreground --config \${config_file}
Restart=always
RestartSec=5

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF
  run_systemctl daemon-reload
  run_systemctl enable --now nodehubsapi-warp.service >/dev/null
  run_systemctl restart nodehubsapi-warp.service
}

start_warp_background() {
  local warp_bin="$1"
  local config_file="$STATE_DIR/warp/warp.conf"
  local pid_file="$STATE_DIR/warp/warp.pid"
  local log_file="$STATE_DIR/warp/warp.log"
  local old_pid=""
  mkdir -p "$STATE_DIR/warp"
  if [ -f "$pid_file" ]; then
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  nohup "$warp_bin" --foreground --config "$config_file" >>"$log_file" 2>&1 &
  echo "$!" > "$pid_file"
}

ensure_warp_bootstrap() {
  local warp_bin
  warp_bin="$(install_warpgo_binary)" || return 1
  register_warp_via_api || register_warp_with_warpgo "$warp_bin"
  if [ "$USE_SYSTEMD" = "1" ]; then
    write_warp_service "$warp_bin"
  else
    start_warp_background "$warp_bin"
  fi
  log "WARP bootstrap completed."
}

install_cloudflared_binary() {
  local target="$RUNTIME_BIN_DIR/cloudflared"
  local arch
  if [ -x "$target" ]; then
    printf '%s' "$target"
    return 0
  fi
  arch="$(resolve_cloudflared_arch)" || {
    warn "cloudflared is not available for this architecture."
    return 1
  }
  http_download_to_file "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-\${arch}" "$TMP_DIR/cloudflared"
  install_binary_file "$TMP_DIR/cloudflared" "$target"
  printf '%s' "$target"
}

sync_argo_domain_state() {
  local log_file="$STATE_DIR/argo/cloudflared.log"
  local domain_file="$STATE_DIR/argo/domain"
  if [ -n "$NODE_ARGO_TUNNEL_DOMAIN" ]; then
    printf '%s\n' "$NODE_ARGO_TUNNEL_DOMAIN" > "$domain_file"
    return 0
  fi
  if [ -f "$log_file" ]; then
    grep -ao 'https://[a-z0-9-]*\\.trycloudflare\\.com' "$log_file" 2>/dev/null | tail -n1 | sed 's|https://||' > "$domain_file" || true
  fi
}

write_argo_service() {
  local cloudflared_bin="$1"
  local service_file="$SYSTEMD_DIR/nodehubsapi-cloudflared.service"
  local env_file="$ETC_DIR/cloudflared.env"
  local log_file="$STATE_DIR/argo/cloudflared.log"
  [ "$USE_SYSTEMD" = "1" ] || return 0
  mkdir -p "$SYSTEMD_DIR"
  mkdir -p "$STATE_DIR/argo"
  : > "$log_file"
  cat >"$env_file" <<EOF
ARGO_TUNNEL_TOKEN=\${NODE_ARGO_TUNNEL_TOKEN}
ARGO_ORIGIN_URL=http://127.0.0.1:\${NODE_ARGO_ORIGIN_PORT}
ARGO_LOG_FILE=\${log_file}
EOF
  if [ -n "$NODE_ARGO_TUNNEL_TOKEN" ]; then
    cat >"$service_file" <<EOF
[Unit]
Description=nodehubsapi cloudflared
After=network-online.target \${RUNTIME_PRIMARY_SERVICE_NAME}.service
Wants=network-online.target \${RUNTIME_PRIMARY_SERVICE_NAME}.service

[Service]
Type=simple
EnvironmentFile=\${env_file}
ExecStart=/bin/sh -lc 'exec \${cloudflared_bin} tunnel --no-autoupdate --edge-ip-version auto --protocol http2 run --token "$ARGO_TUNNEL_TOKEN" >>"$ARGO_LOG_FILE" 2>&1'
Restart=always
RestartSec=5

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF
  else
    cat >"$service_file" <<EOF
[Unit]
Description=nodehubsapi cloudflared
After=network-online.target \${RUNTIME_PRIMARY_SERVICE_NAME}.service
Wants=network-online.target \${RUNTIME_PRIMARY_SERVICE_NAME}.service

[Service]
Type=simple
EnvironmentFile=\${env_file}
ExecStart=/bin/sh -lc 'exec \${cloudflared_bin} tunnel --url "$ARGO_ORIGIN_URL" --edge-ip-version auto --no-autoupdate --protocol http2 >>"$ARGO_LOG_FILE" 2>&1'
Restart=always
RestartSec=5

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF
  fi
}

start_argo_background() {
  local cloudflared_bin="$1"
  local log_file="$STATE_DIR/argo/cloudflared.log"
  local pid_file="$STATE_DIR/argo/cloudflared.pid"
  local origin_url="http://127.0.0.1:$NODE_ARGO_ORIGIN_PORT"
  local old_pid=""
  mkdir -p "$STATE_DIR/argo"
  : > "$log_file"
  if [ -f "$pid_file" ]; then
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  if [ -n "$NODE_ARGO_TUNNEL_TOKEN" ]; then
    nohup /bin/sh -lc "exec \"$cloudflared_bin\" tunnel --no-autoupdate --edge-ip-version auto --protocol http2 run --token \"$NODE_ARGO_TUNNEL_TOKEN\" >>\"$log_file\" 2>&1" >/dev/null 2>&1 &
  else
    nohup /bin/sh -lc "exec \"$cloudflared_bin\" tunnel --url \"$origin_url\" --edge-ip-version auto --no-autoupdate --protocol http2 >>\"$log_file\" 2>&1" >/dev/null 2>&1 &
  fi
  echo "$!" > "$pid_file"
}

ensure_argo_bootstrap() {
  local cloudflared_bin
  cloudflared_bin="$(install_cloudflared_binary)" || return 1
  if [ "$USE_SYSTEMD" = "1" ]; then
    write_argo_service "$cloudflared_bin"
    run_systemctl daemon-reload
    run_systemctl enable --now nodehubsapi-cloudflared.service >/dev/null
    run_systemctl restart nodehubsapi-cloudflared.service
  else
    start_argo_background "$cloudflared_bin"
  fi
  sleep 5
  sync_argo_domain_state
  log "Argo bootstrap completed."
}

write_runtime_files() {
${runtimeFileBlocks
      .split('\n')
      .map((line) => (line ? `  ${line}` : ''))
      .join('\n')}
}

write_runtime_service() {
  if [ "$USE_SYSTEMD" != "1" ]; then
    return 0
  fi
  local exec_args
  exec_args="$(render_template "$RUNTIME_RUN_ARGS_TEMPLATE" "")"
  mkdir -p "$SYSTEMD_DIR"
  cat >"$RUNTIME_SERVICE_FILE" <<EOF
[Unit]
Description=nodehubsapi runtime ($RUNTIME_ENGINE)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$RUNTIME_INSTALL_PATH $exec_args
WorkingDirectory=$ETC_DIR
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF
}

stop_runtime_process_by_engine() {
  local engine="$1"
  local pid_file="$STATE_DIR/runtime/\${engine}.pid"
  local pid=""
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

restart_runtime_process() {
  local exec_args log_file pid_file
  exec_args="$(render_template "$RUNTIME_RUN_ARGS_TEMPLATE" "")"
  mkdir -p "$STATE_DIR/runtime"
  log_file="$STATE_DIR/runtime/\${RUNTIME_ENGINE}.log"
  pid_file="$STATE_DIR/runtime/\${RUNTIME_ENGINE}.pid"
  stop_runtime_process_by_engine "$RUNTIME_ENGINE"
  nohup /bin/sh -lc "cd \"$ETC_DIR\" && exec \"$RUNTIME_INSTALL_PATH\" $exec_args" >>"$log_file" 2>&1 &
  echo "$!" > "$pid_file"
  sleep 1
  kill -0 "$(cat "$pid_file" 2>/dev/null || true)" 2>/dev/null
}

restart_runtime_service() {
  if [ "$USE_SYSTEMD" = "1" ]; then
    run_systemctl daemon-reload
    run_systemctl enable --now "$RUNTIME_SERVICE_NAME.service" >/dev/null
    run_systemctl restart "$RUNTIME_SERVICE_NAME.service"
    run_systemctl is-active --quiet "$RUNTIME_SERVICE_NAME.service"
    return 0
  fi
  restart_runtime_process
}

stop_runtime_kernels() {
  if [ "$USE_SYSTEMD" = "1" ]; then
    run_systemctl stop nodehubsapi-runtime-sing-box.service nodehubsapi-runtime-xray.service nodehubsapi-runtime.service >/dev/null 2>&1 || true
  fi
  stop_runtime_process_by_engine "sing-box"
  stop_runtime_process_by_engine "xray"
  pkill -x sing-box >/dev/null 2>&1 || true
  pkill -x xray >/dev/null 2>&1 || true
}

apply_runtime_plans() {
  if [ "$RUNTIME_PLAN_COUNT" -le 0 ]; then
    warn "No runtime plans in release artifact."
    return 0
  fi
${runtimeApplyBlocks}
}

run_hooks() {
  local directory="$1"
  if [ ! -d "$directory" ]; then
    return 0
  fi
  for hook in "$directory"/*; do
    [ -e "$hook" ] || continue
    [ -x "$hook" ] || continue
    "$hook"
  done
}

cleanup() {
  rm -rf "$TMP_DIR"
}

fail_apply() {
  local code=$?
  ack_release "failed" "release apply failed"
  cleanup
  exit "$code"
}

main() {
  detect_execution_mode

  TMP_DIR="$(mktemp -d)"
  trap fail_apply ERR

  mkdir -p "$ETC_DIR/runtime" "$ETC_DIR/certs" "$STATE_DIR/releases" "$STATE_DIR/warp" "$STATE_DIR/argo" "$STATE_DIR/lego" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d" "$ETC_DIR/hooks/bootstrap.d"

  refresh_agent_installation_if_needed
  ack_release "applying" "release apply started"
  run_hooks "$ETC_DIR/hooks/pre-apply.d"
  if [ "$RELEASE_KIND" = "bootstrap" ]; then
    run_hooks "$ETC_DIR/hooks/bootstrap.d"
  fi
  stop_runtime_kernels
  write_runtime_files
  ensure_tls_certificate
  apply_runtime_plans
  cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"
  if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_WARP" = "1" ]; then
    ensure_warp_bootstrap
  fi
  if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_ARGO" = "1" ]; then
    ensure_argo_bootstrap
  fi
  run_hooks "$ETC_DIR/hooks/post-apply.d"
  ack_release "healthy" "release applied"
  schedule_agent_restart_if_needed
  trap - ERR
  cleanup
}

main "$@"
`
}

export function buildAgentInstallScript(input: {
  publicBaseUrl: string
  nodeId: string
  agentToken: string
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  const installUrl = `${apiBase}/api/nodes/agent/install?nodeId=${encodeURIComponent(input.nodeId)}`
  return `#!/usr/bin/env bash
set -euo pipefail

API_BASE=${shellQuote(apiBase)}
NODE_ID=${shellQuote(input.nodeId)}
AGENT_TOKEN=${shellQuote(input.agentToken)}
AGENT_VERSION=${shellQuote(APP_VERSION)}
AGENT_INSTALL_URL=${shellQuote(installUrl)}
STATE_DIR=""
ETC_DIR=""
AGENT_BIN=""
SERVICE_FILE=""
AGENT_ENV_FILE=""
RUNTIME_BIN_DIR=""
WARP_BIN_PATH=""
CLOUDFLARED_BIN_PATH=""
SYSTEMCTL_USER_FLAG=""
SYSTEMD_WANTED_BY="multi-user.target"
USE_SYSTEMD=0
INSTALL_MODE=""
POLL_INTERVAL=15

json_escape() {
  local value="$1"
  value="\${value//\\/\\\\}"
  value="\${value//\"/\\\"}"
  value="\${value//$'\\n'/\\n}"
  value="\${value//$'\\r'/\\r}"
  value="\${value//$'\\t'/\\t}"
  printf '"%s"' "$value"
}

is_root() {
  [ "\${EUID:-$(id -u)}" -eq 0 ]
}

detect_install_context() {
  if is_root; then
    INSTALL_MODE="system"
    STATE_DIR="/opt/nodehubsapi"
    ETC_DIR="/etc/nodehubsapi"
    AGENT_BIN="/usr/local/bin/nodehubsapi-agent"
    SERVICE_FILE="/etc/systemd/system/nodehubsapi-agent.service"
    RUNTIME_BIN_DIR="/usr/local/bin"
  else
    INSTALL_MODE="user"
    STATE_DIR="$HOME/.local/share/nodehubsapi"
    ETC_DIR="$HOME/.config/nodehubsapi"
    AGENT_BIN="$HOME/.local/bin/nodehubsapi-agent"
    SERVICE_FILE="$HOME/.config/systemd/user/nodehubsapi-agent.service"
    SYSTEMCTL_USER_FLAG="--user"
    SYSTEMD_WANTED_BY="default.target"
    RUNTIME_BIN_DIR="$HOME/.local/bin"
  fi

  if ! mkdir -p "$STATE_DIR" "$ETC_DIR" "$(dirname "$AGENT_BIN")" >/dev/null 2>&1; then
    if [ "$INSTALL_MODE" = "system" ]; then
      INSTALL_MODE="user"
      STATE_DIR="$HOME/.local/share/nodehubsapi"
      ETC_DIR="$HOME/.config/nodehubsapi"
      AGENT_BIN="$HOME/.local/bin/nodehubsapi-agent"
      SERVICE_FILE="$HOME/.config/systemd/user/nodehubsapi-agent.service"
      SYSTEMCTL_USER_FLAG="--user"
      SYSTEMD_WANTED_BY="default.target"
      RUNTIME_BIN_DIR="$HOME/.local/bin"
      mkdir -p "$STATE_DIR" "$ETC_DIR" "$(dirname "$AGENT_BIN")"
    else
      echo "Failed to create user-mode directories." >&2
      exit 1
    fi
  fi

  AGENT_ENV_FILE="$ETC_DIR/agent.env"
  WARP_BIN_PATH="$RUNTIME_BIN_DIR/warp-go"
  CLOUDFLARED_BIN_PATH="$RUNTIME_BIN_DIR/cloudflared"

  if command -v systemctl >/dev/null 2>&1; then
    if [ "$INSTALL_MODE" = "user" ]; then
      if systemctl --user show-environment >/dev/null 2>&1; then
        USE_SYSTEMD=1
      fi
    elif [ -d /run/systemd/system ]; then
      USE_SYSTEMD=1
    fi
  fi
}

ensure_downloader() {
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || command -v busybox >/dev/null 2>&1; then
    return 0
  fi
  echo "A downloader is required: curl, wget, or busybox wget." >&2
  exit 1
}

write_agent_env() {
  mkdir -p "$STATE_DIR/releases" "$STATE_DIR/runtime" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d" "$ETC_DIR/hooks/bootstrap.d"
  cat >"$AGENT_ENV_FILE" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
AGENT_TOKEN=$AGENT_TOKEN
AGENT_VERSION=$AGENT_VERSION
AGENT_INSTALL_URL=$AGENT_INSTALL_URL
STATE_DIR=$STATE_DIR
ETC_DIR=$ETC_DIR
RUNTIME_BIN_DIR=$RUNTIME_BIN_DIR
INSTALL_MODE=$INSTALL_MODE
USE_SYSTEMD=$USE_SYSTEMD
SYSTEMCTL_USER_FLAG=$SYSTEMCTL_USER_FLAG
WARP_BIN_PATH=$WARP_BIN_PATH
CLOUDFLARED_BIN_PATH=$CLOUDFLARED_BIN_PATH
NODESHUB_AGENT_ENV_FILE=$AGENT_ENV_FILE
POLL_INTERVAL=$POLL_INTERVAL
EOF
}

write_agent_binary() {
  cat >"$AGENT_BIN" <<'NODESHUB_AGENT_BIN_EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ -n "\${NODESHUB_AGENT_ENV_FILE:-}" ] && [ -f "$NODESHUB_AGENT_ENV_FILE" ]; then
  . "$NODESHUB_AGENT_ENV_FILE"
elif [ -f /etc/nodehubsapi/agent.env ]; then
  . /etc/nodehubsapi/agent.env
elif [ -f "$HOME/.config/nodehubsapi/agent.env" ]; then
  . "$HOME/.config/nodehubsapi/agent.env"
else
  echo "agent.env not found." >&2
  exit 1
fi

RUNTIME_BIN_DIR="\${RUNTIME_BIN_DIR:-/usr/local/bin}"
WARP_BIN_PATH="\${WARP_BIN_PATH:-$RUNTIME_BIN_DIR/warp-go}"
CLOUDFLARED_BIN_PATH="\${CLOUDFLARED_BIN_PATH:-$RUNTIME_BIN_DIR/cloudflared}"

json_escape() {
  local value="$1"
  value="\${value//\\/\\\\}"
  value="\${value//\"/\\\"}"
  value="\${value//$'\\n'/\\n}"
  value="\${value//$'\\r'/\\r}"
  value="\${value//$'\\t'/\\t}"
  printf '"%s"' "$value"
}

http_get() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -H "X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO- --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  echo "No downloader available." >&2
  return 1
}

http_get_to_file() {
  local url="$1"
  local target="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -H "X-Agent-Token: $AGENT_TOKEN" "$url" -o "$target"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$target" --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO "$target" --header="X-Agent-Token: $AGENT_TOKEN" "$url"
    return 0
  fi
  echo "No downloader available." >&2
  return 1
}

post_json() {
  local url="$1"
  local body="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -X POST -H "Content-Type: application/json" -H "X-Agent-Token: $AGENT_TOKEN" --data "$body" "$url" >/dev/null
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --header="Content-Type: application/json" --header="X-Agent-Token: $AGENT_TOKEN" --post-data="$body" "$url" >/dev/null
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -qO- --header="Content-Type: application/json" --header="X-Agent-Token: $AGENT_TOKEN" --post-data="$body" "$url" >/dev/null
    return 0
  fi
  echo "No POST-capable downloader available." >&2
  return 1
}

run_install_script() {
  local install_url="$1"
  local script_file
  if [ -z "$install_url" ]; then
    install_url="$API_BASE/api/nodes/agent/install?nodeId=$NODE_ID"
  fi
  script_file="$(mktemp)"
  if ! http_get_to_file "$install_url" "$script_file"; then
    rm -f "$script_file"
    return 1
  fi
  chmod +x "$script_file"
  if ! bash "$script_file"; then
    rm -f "$script_file"
    return 1
  fi
  rm -f "$script_file"
  return 0
}

self_update_if_needed() {
  local desired_version="$1"
  local install_url="$2"
  if [ -z "$desired_version" ] || [ "$desired_version" = "\${AGENT_VERSION:-}" ]; then
    return 0
  fi
  run_install_script "$install_url" || return 1
  exit 0
}

sum_network_bytes() {
  awk -F '[: ]+' '/:/ && $1 !~ /lo/ { rx += $3; tx += $11 } END { printf "%s %s", rx + 0, tx + 0 }' /proc/net/dev 2>/dev/null || printf '0 0'
}

memory_usage_percent() {
  awk '
    /^MemTotal:/ { total = $2 }
    /^MemAvailable:/ { available = $2 }
    END {
      if (total <= 0) {
        print "null"
      } else {
        used = total - available
        printf "%.2f", (used / total) * 100
      }
    }
  ' /proc/meminfo 2>/dev/null || printf 'null'
}

cpu_usage_percent() {
  if [ -r /proc/loadavg ] && command -v nproc >/dev/null 2>&1; then
    load=$(awk '{print $1}' /proc/loadavg)
    cores=$(nproc)
    awk -v load="$load" -v cores="$cores" 'BEGIN {
      if (cores <= 0) {
        print "null"
      } else {
        value = (load / cores) * 100
        if (value > 100) value = 100
        printf "%.2f", value
      }
    }'
    return 0
  fi
  printf 'null'
}

connection_count() {
  if command -v ss >/dev/null 2>&1; then
    ss -Htan state established 2>/dev/null | wc -l | tr -d ' '
    return 0
  fi
  printf '0'
}

runtime_version() {
  if [ -x "$RUNTIME_BIN_DIR/sing-box" ]; then
    "$RUNTIME_BIN_DIR/sing-box" version 2>/dev/null | head -n 1 | tr -d '\r'
    return 0
  fi
  if [ -x "$RUNTIME_BIN_DIR/xray" ]; then
    "$RUNTIME_BIN_DIR/xray" version 2>/dev/null | head -n 1 | tr -d '\r'
    return 0
  fi
  printf ''
}

warp_ipv6() {
  local value
  value="$(cat "$STATE_DIR/warp/v6" 2>/dev/null || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^Address6[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}' | tr -d ' ' || true)"
  fi
  value="\${value%%/*}"
  printf '%s' "$value"
}

warp_endpoint() {
  local value
  value="$(cat "$STATE_DIR/warp/endpoint" 2>/dev/null || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^Endpoint[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}' | tr -d ' ' || true)"
  fi
  printf '%s' "$value"
}

warp_status() {
  if [ -f "$STATE_DIR/warp/warp.pid" ] && kill -0 "$(cat "$STATE_DIR/warp/warp.pid" 2>/dev/null || true)" 2>/dev/null; then
    printf 'running'
    return 0
  fi
  if command -v pgrep >/dev/null 2>&1 && pgrep -f 'warp-go|wireguard|wg-quick' >/dev/null 2>&1; then
    printf 'running'
    return 0
  fi
  if [ -f "$STATE_DIR/warp/v6" ] || [ -f "$STATE_DIR/warp/warp.conf" ] || [ -x "$WARP_BIN_PATH" ]; then
    printf 'installed'
    return 0
  fi
  printf 'not_installed'
}

argo_domain() {
  local value
  value="$(cat "$STATE_DIR/argo/domain" 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/argo/cloudflared.log" ]; then
    value="$(grep -ao 'https://[a-z0-9-]*\\.trycloudflare\\.com' "$STATE_DIR/argo/cloudflared.log" 2>/dev/null | tail -n 1 | sed 's|https://||' || true)"
  fi
  printf '%s' "$value"
}

argo_status() {
  if [ -f "$STATE_DIR/argo/cloudflared.pid" ] && kill -0 "$(cat "$STATE_DIR/argo/cloudflared.pid" 2>/dev/null || true)" 2>/dev/null; then
    printf 'running'
    return 0
  fi
  if [ "\${USE_SYSTEMD:-0}" = "1" ] && command -v systemctl >/dev/null 2>&1 && systemctl \${SYSTEMCTL_USER_FLAG:-} is-active --quiet nodehubsapi-cloudflared.service 2>/dev/null; then
    printf 'running'
    return 0
  fi
  if [ -f "$ETC_DIR/cloudflared.env" ] || [ -x "$CLOUDFLARED_BIN_PATH" ]; then
    printf 'installed'
    return 0
  fi
  printf 'not_installed'
}

storage_usage() {
  if command -v df >/dev/null 2>&1; then
    df -kP / 2>/dev/null | awk 'NR==2 {
      total = $2 * 1024
      used = $3 * 1024
      if (total <= 0) {
        print "0 0 null"
      } else {
        printf "%.0f %.0f %.2f", total, used, (used / total) * 100
      }
    }'
    return 0
  fi
  printf '0 0 null'
}

heartbeat() {
  local bytes_in bytes_out memory cpu connections version
  local warp_ipv6_value warp_status_value warp_endpoint_value
  local argo_status_value argo_domain_value
  local storage_total storage_used storage_percent
  local payload
  read -r bytes_in bytes_out <<EOF_NET
$(sum_network_bytes)
EOF_NET
  memory="$(memory_usage_percent)"
  cpu="$(cpu_usage_percent)"
  connections="$(connection_count)"
  version="$(runtime_version)"
  warp_ipv6_value="$(warp_ipv6)"
  warp_status_value="$(warp_status)"
  warp_endpoint_value="$(warp_endpoint)"
  argo_status_value="$(argo_status)"
  argo_domain_value="$(argo_domain)"
  read -r storage_total storage_used storage_percent <<EOF_STORAGE
$(storage_usage)
EOF_STORAGE
  payload=$(cat <<EOF_JSON
{
  "nodeId": $(json_escape "$NODE_ID"),
  "bytesInTotal": \${bytes_in:-0},
  "bytesOutTotal": \${bytes_out:-0},
  "currentConnections": \${connections:-0},
  "cpuUsagePercent": \${cpu:-null},
  "memoryUsagePercent": \${memory:-null},
  "warpStatus": $(json_escape "$warp_status_value"),
  "warpIpv6": $(json_escape "$warp_ipv6_value"),
  "warpEndpoint": $(json_escape "$warp_endpoint_value"),
  "argoStatus": $(json_escape "$argo_status_value"),
  "argoDomain": $(json_escape "$argo_domain_value"),
  "storageTotalBytes": \${storage_total:-0},
  "storageUsedBytes": \${storage_used:-0},
  "storageUsagePercent": \${storage_percent:-null},
  "protocolRuntimeVersion": $(json_escape "$version")
}
EOF_JSON
)
  post_json "$API_BASE/api/nodes/agent/heartbeat" "$payload" || true
}

apply_release() {
  local release_id="$1"
  local apply_url="$2"
  local script_file
  script_file="$(mktemp)"
  if ! http_get_to_file "$apply_url" "$script_file"; then
    return 1
  fi
  chmod +x "$script_file"
  export API_BASE NODE_ID AGENT_TOKEN AGENT_VERSION AGENT_INSTALL_URL ETC_DIR STATE_DIR RUNTIME_BIN_DIR INSTALL_MODE USE_SYSTEMD SYSTEMCTL_USER_FLAG
  if ! bash "$script_file"; then
    rm -f "$script_file"
    return 1
  fi
  rm -f "$script_file"
  return 0
}

reconcile() {
  local env_file
  env_file="$(mktemp)"
  if ! http_get "$API_BASE/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env" >"$env_file"; then
    rm -f "$env_file"
    return 1
  fi
  . "$env_file"
  rm -f "$env_file"

  self_update_if_needed "\${agent_version:-}" "\${install_url:-}" || return 1

  if [ "\${needs_update:-0}" = "1" ] && [ -n "\${release_id:-}" ] && [ -n "\${apply_url:-}" ] && { [ "\${release_status:-}" = "pending" ] || [ "\${release_status:-}" = "applying" ]; }; then
    apply_release "$release_id" "$apply_url" || true
  fi
}

loop() {
  while true; do
    heartbeat
    reconcile || true
    sleep "\${POLL_INTERVAL:-15}"
  done
}

loop
NODESHUB_AGENT_BIN_EOF

  chmod +x "$AGENT_BIN"
}

write_service() {
  [ "$USE_SYSTEMD" = "1" ] || return 1
  mkdir -p "$(dirname "$SERVICE_FILE")"
  cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=nodehubsapi agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ETC_DIR/agent.env
ExecStart=$AGENT_BIN
Restart=always
RestartSec=5

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF

  systemctl $SYSTEMCTL_USER_FLAG daemon-reload
  systemctl $SYSTEMCTL_USER_FLAG enable --now nodehubsapi-agent.service
}

start_agent_background() {
  local pid_file="$STATE_DIR/agent.pid"
  local log_file="$STATE_DIR/agent.log"
  local old_pid=""
  if [ -f "$pid_file" ]; then
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  nohup "$AGENT_BIN" >>"$log_file" 2>&1 &
  echo "$!" > "$pid_file"
}

print_summary() {
  cat <<EOF
nodehubsapi agent installed.

- Install mode: $INSTALL_MODE
- API base: $API_BASE
- Node ID: $NODE_ID
- Agent env: $AGENT_ENV_FILE
- Runtime config root: $ETC_DIR/runtime
- Hook directories:
  $ETC_DIR/hooks/pre-apply.d
  $ETC_DIR/hooks/post-apply.d
  $ETC_DIR/hooks/bootstrap.d
EOF
}

ensure_downloader
detect_install_context
write_agent_env
write_agent_binary
if ! write_service; then
  start_agent_background
fi
print_summary
`
}

