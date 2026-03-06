import type { ReleaseArtifact } from '@contracts/index'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

export function buildDeployCommand(input: {
  publicBaseUrl: string
  nodeId: string
}): string {
  const apiBase = input.publicBaseUrl.replace(/\/+$/, '')
  return `URL=${shellQuote(`${apiBase}/agent/install`)}; if command -v curl >/dev/null 2>&1; then curl -fsSL $URL; else wget -q -O - $URL; fi | bash -s -- --api-base ${shellQuote(apiBase)} --node-id ${shellQuote(input.nodeId)}`
}

export function buildUninstallCommand(): string {
  return `systemctl stop nodehubsapi-agent.service nodehubsapi-runtime.service 2>/dev/null; systemctl disable nodehubsapi-agent.service nodehubsapi-runtime.service 2>/dev/null; rm -f /etc/systemd/system/nodehubsapi-agent.service /etc/systemd/system/nodehubsapi-runtime.service; systemctl daemon-reload; rm -f /usr/local/bin/nodehubsapi-agent /usr/local/bin/xray /usr/local/bin/sing-box; rm -rf /etc/nodehubsapi /opt/nodehubsapi; echo '✅ NodeHub agent uninstalled.'`
}

function buildRuntimeFileBlocks(artifact: ReleaseArtifact): string {
  return artifact.runtime.files
    .map((file, index) => {
      const label = `NODESHUB_FILE_${index + 1}`
      const targetPath = `/etc/nodehubsapi/${file.path}`
      return [
        `mkdir -p "$(dirname ${shellQuote(targetPath)})"`,
        `cat >${shellQuote(targetPath)} <<'${label}'`,
        file.content,
        label,
      ].join('\n')
    })
    .join('\n\n')
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
  ].join('\n')
}

export function buildReleaseApplyScript(artifact: ReleaseArtifact): string {
  const runtime = artifact.runtime
  const binary = runtime.binary
  const configPath = `/etc/nodehubsapi/${runtime.entryConfigPath}`
  const runtimeFileBlocks = buildRuntimeFileBlocks(artifact)

  return `#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID=${shellQuote(artifact.releaseId)}
RELEASE_KIND=${shellQuote(artifact.kind)}
RUNTIME_ENGINE=${shellQuote(runtime.engine)}
RUNTIME_VERSION=${shellQuote(binary.version)}
RUNTIME_BINARY_NAME=${shellQuote(binary.binaryName)}
RUNTIME_INSTALL_PATH=${shellQuote(binary.installPath)}
RUNTIME_DOWNLOAD_BASE_URL=${shellQuote(binary.downloadBaseUrl)}
RUNTIME_ASSET_TEMPLATE=${shellQuote(binary.assetNameTemplate)}
RUNTIME_BINARY_PATH_TEMPLATE=${shellQuote(binary.binaryPathTemplate)}
RUNTIME_RUN_ARGS_TEMPLATE=${shellQuote(binary.runArgsTemplate)}
RUNTIME_ARCHIVE_FORMAT=${shellQuote(binary.archiveFormat)}
RUNTIME_CONFIG_PATH=${shellQuote(configPath)}
RUNTIME_SERVICE_NAME=${shellQuote(artifact.bootstrap.runtimeServiceName)}
RUNTIME_SERVICE_FILE=${shellQuote(`/etc/systemd/system/${artifact.bootstrap.runtimeServiceName}.service`)}
ETC_DIR=${shellQuote('/etc/nodehubsapi')}
STATE_DIR=${shellQuote('/opt/nodehubsapi')}

json_escape() {
  local value="$1"
  value="\${value//\\/\\\\}"
  value="\${value//\"/\\\"}"
  value="\${value//$'\\n'/\\n}"
  value="\${value//$'\\r'/\\r}"
  value="\${value//$'\\t'/\\t}"
  printf '"%s"' "$value"
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
  echo "No zip extractor available. Need unzip, bsdtar, python3, or busybox unzip." >&2
  return 1
}

extract_archive() {
  local archive="$1"
  local target_dir="$2"
  mkdir -p "$target_dir"
  case "$RUNTIME_ARCHIVE_FORMAT" in
    tar.gz)
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

  http_get_to_file "$download_url" "$archive_file"
  extract_archive "$archive_file" "$unpack_dir"

  source_binary="$unpack_dir/$binary_rel"
  if [ ! -f "$source_binary" ]; then
    echo "Runtime binary not found after extraction: $source_binary" >&2
    return 1
  fi

  install_binary_file "$source_binary" "$RUNTIME_INSTALL_PATH"
}

write_runtime_files() {
${runtimeFileBlocks
      .split('\n')
      .map((line) => (line ? `  ${line}` : ''))
      .join('\n')}
}

write_runtime_service() {
  local exec_args
  exec_args="$(render_template "$RUNTIME_RUN_ARGS_TEMPLATE" "")"
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
WantedBy=multi-user.target
EOF
}

restart_runtime_service() {
  systemctl daemon-reload
  systemctl enable --now "$RUNTIME_SERVICE_NAME.service" >/dev/null
  systemctl restart "$RUNTIME_SERVICE_NAME.service"
  systemctl is-active --quiet "$RUNTIME_SERVICE_NAME.service"
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
  if [ "\${EUID:-$(id -u)}" -ne 0 ]; then
    echo "Release apply script must run as root." >&2
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd is required for runtime management." >&2
    exit 1
  fi

  TMP_DIR="$(mktemp -d)"
  trap fail_apply ERR

  mkdir -p "$ETC_DIR/runtime" "$STATE_DIR/releases" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d" "$ETC_DIR/hooks/bootstrap.d"

  ack_release "applying" "release apply started"
  run_hooks "$ETC_DIR/hooks/pre-apply.d"
  if [ "$RELEASE_KIND" = "bootstrap" ]; then
    run_hooks "$ETC_DIR/hooks/bootstrap.d"
  fi
  install_runtime_binary
  write_runtime_files
  write_runtime_service
  cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"
  restart_runtime_service
  run_hooks "$ETC_DIR/hooks/post-apply.d"
  ack_release "healthy" "release applied"
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
  return `#!/usr/bin/env bash
set -euo pipefail

API_BASE=${shellQuote(apiBase)}
NODE_ID=${shellQuote(input.nodeId)}
AGENT_TOKEN=${shellQuote(input.agentToken)}
STATE_DIR=${shellQuote('/opt/nodehubsapi')}
ETC_DIR=${shellQuote('/etc/nodehubsapi')}
AGENT_BIN=${shellQuote('/usr/local/bin/nodehubsapi-agent')}
SERVICE_FILE=${shellQuote('/etc/systemd/system/nodehubsapi-agent.service')}
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

require_root() {
  if [ "\${EUID:-$(id -u)}" -ne 0 ]; then
    echo "Run this installer as root." >&2
    exit 1
  fi
}

ensure_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd is required for the managed agent service." >&2
    exit 1
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
  cat >"$ETC_DIR/agent.env" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
AGENT_TOKEN=$AGENT_TOKEN
STATE_DIR=$STATE_DIR
ETC_DIR=$ETC_DIR
POLL_INTERVAL=$POLL_INTERVAL
EOF
}

write_agent_binary() {
  cat >"$AGENT_BIN" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

. /etc/nodehubsapi/agent.env

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
  if [ -x /usr/local/bin/sing-box ]; then
    /usr/local/bin/sing-box version 2>/dev/null | head -n 1 | tr -d '\r'
    return 0
  fi
  if [ -x /usr/local/bin/xray ]; then
    /usr/local/bin/xray version 2>/dev/null | head -n 1 | tr -d '\r'
    return 0
  fi
  printf ''
}

heartbeat() {
  local bytes_in bytes_out memory cpu connections version payload
  read -r bytes_in bytes_out <<EOF_NET
$(sum_network_bytes)
EOF_NET
  memory="$(memory_usage_percent)"
  cpu="$(cpu_usage_percent)"
  connections="$(connection_count)"
  version="$(runtime_version)"
  payload=$(cat <<EOF_JSON
{
  "nodeId": $(json_escape "$NODE_ID"),
  "bytesInTotal": \${bytes_in:-0},
  "bytesOutTotal": \${bytes_out:-0},
  "currentConnections": \${connections:-0},
  "cpuUsagePercent": \${cpu:-null},
  "memoryUsagePercent": \${memory:-null},
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
  export API_BASE NODE_ID AGENT_TOKEN ETC_DIR STATE_DIR
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

  if [ "\${needs_update:-0}" = "1" ] && [ -n "\${release_id:-}" ] && [ -n "\${apply_url:-}" ]; then
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
EOF

  chmod +x "$AGENT_BIN"
}

write_service() {
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
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now nodehubsapi-agent.service
}

print_summary() {
  cat <<EOF
nodehubsapi agent installed.

- API base: $API_BASE
- Node ID: $NODE_ID
- Agent env: $ETC_DIR/agent.env
- Runtime config root: $ETC_DIR/runtime
- Hook directories:
  $ETC_DIR/hooks/pre-apply.d
  $ETC_DIR/hooks/post-apply.d
  $ETC_DIR/hooks/bootstrap.d
EOF
}

require_root
ensure_systemd
ensure_downloader
write_agent_env
write_agent_binary
write_service
print_summary
`
}
