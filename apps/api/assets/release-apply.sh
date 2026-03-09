#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID=__RELEASE_ID__
RELEASE_REVISION=__RELEASE_REVISION__
RELEASE_KIND=__RELEASE_KIND__
RUNTIME_PRIMARY_SERVICE_NAME=__RUNTIME_PRIMARY_SERVICE_NAME__
RUNTIME_PLAN_COUNT=__RUNTIME_PLAN_COUNT__
ETC_DIR="${ETC_DIR:-/etc/nodehubsapi}"
STATE_DIR="${STATE_DIR:-/opt/nodehubsapi}"
RUNTIME_BIN_DIR="${RUNTIME_BIN_DIR:-/usr/local/bin}"
INSTALL_MODE="${INSTALL_MODE:-}"
USE_SYSTEMD="${USE_SYSTEMD:-0}"
SYSTEMCTL_USER_FLAG="${SYSTEMCTL_USER_FLAG:-}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMD_WANTED_BY="${SYSTEMD_WANTED_BY:-multi-user.target}"
GITHUB_MIRROR_URL=__GITHUB_MIRROR_URL__
BOOTSTRAP_INSTALL_WARP=__BOOTSTRAP_INSTALL_WARP__
BOOTSTRAP_INSTALL_SING_BOX=__BOOTSTRAP_INSTALL_SING_BOX__
BOOTSTRAP_INSTALL_XRAY=__BOOTSTRAP_INSTALL_XRAY__
BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS=__BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS__
BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS=__BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS__
BOOTSTRAP_RUNTIME_BINARY_COUNT=__BOOTSTRAP_RUNTIME_BINARY_COUNT__
BOOTSTRAP_NEEDS_CERTS=__BOOTSTRAP_NEEDS_CERTS__
BOOTSTRAP_CERT_PATH=__BOOTSTRAP_CERT_PATH__
BOOTSTRAP_KEY_PATH=__BOOTSTRAP_KEY_PATH__
BOOTSTRAP_PRIMARY_TLS_DOMAIN=__BOOTSTRAP_PRIMARY_TLS_DOMAIN__
NODE_CF_DNS_TOKEN=__NODE_CF_DNS_TOKEN__
NODE_WARP_LICENSE_KEY=__NODE_WARP_LICENSE_KEY__
NODE_ARGO_TUNNEL_TOKEN=__NODE_ARGO_TUNNEL_TOKEN__
NODE_ARGO_TUNNEL_DOMAIN=__NODE_ARGO_TUNNEL_DOMAIN__
NODE_ARGO_ORIGIN_PORT=__NODE_ARGO_ORIGIN_PORT__
CONTROL_PLANE_AGENT_VERSION=__CONTROL_PLANE_AGENT_VERSION__
AGENT_UPGRADED=0
AGENT_RESTART_REQUIRED=0
APPLY_LOG_FILE=""
__BOOTSTRAP_TLS_DOMAINS__

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

append_apply_log() {
  [ -n "$APPLY_LOG_FILE" ] || return 0
  mkdir -p "$(dirname "$APPLY_LOG_FILE")"
  printf '%s\n' "$1" >>"$APPLY_LOG_FILE"
}

log() {
  local line="[nodehubsapi] $*"
  printf '%s\n' "$line"
  append_apply_log "$line"
}

warn() {
  local line="[nodehubsapi] WARN: $*"
  printf '%s\n' "$line" >&2
  append_apply_log "$line"
}

is_root() {
  [ "${EUID:-$(id -u)}" -eq 0 ]
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
    printf '%s/%s' "${GITHUB_MIRROR_URL%/}" "$url"
    return 0
  fi
  printf '%s' "$url"
}

direct_url() {
  local url="$1"
  printf '%s' "$url"
}

normalize_version_tag() {
  local raw="$1"
  if [ -z "$raw" ]; then
    return 1
  fi
  case "$raw" in
    v*) printf '%s' "$raw" ;;
    *) printf 'v%s' "$raw" ;;
  esac
}

get_latest_github_tag() {
  local repo="$1"
  local fallback="${2:-}"
  local api tag redirect_url

  tag=""
  if command -v curl >/dev/null 2>&1; then
    api="$(direct_url "https://api.github.com/repos/${repo}/releases/latest")"
    tag="$(curl -fsSL "$api" 2>/dev/null | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
    if [ -z "$tag" ]; then
      tag="$(curl -fsSL "$api" 2>/dev/null | tr -d '\r\n' | sed 's/.*"tag_name":"\([^"]*\)".*/\1/')"
    fi
    if [[ -z "$tag" || "$tag" == *"{"* ]]; then
      redirect_url="$(direct_url "https://github.com/${repo}/releases/latest")"
      tag="$(curl -fsSL -I "$redirect_url" 2>/dev/null | grep -i '^location:' | sed 's/.*\/tag\/\([^[:space:]]*\).*/\1/' | tr -d '\r\n')"
    fi
  fi

  if [[ -z "$tag" || "$tag" == *"{"* ]] && [ -n "$fallback" ]; then
    warn "Failed to detect latest ${repo} release tag, using fallback: $fallback"
    tag="$fallback"
  fi

  printf '%s' "$tag"
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
  if [ "${AGENT_VERSION:-}" = "$CONTROL_PLANE_AGENT_VERSION" ]; then
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
  if [ "$AGENT_UPGRADED" != "1" ] && [ "$AGENT_RESTART_REQUIRED" != "1" ]; then
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
  local apply_log=""
  local payload
  if [ -n "$APPLY_LOG_FILE" ] && [ -f "$APPLY_LOG_FILE" ]; then
    apply_log="$(cat "$APPLY_LOG_FILE" 2>/dev/null || true)"
  fi
  payload=$(cat <<EOF_JSON
{
  "nodeId": $(json_escape "$NODE_ID"),
  "status": $(json_escape "$status"),
  "message": $(json_escape "$message"),
  "applyLog": $(json_escape "$apply_log")
}
EOF_JSON
)
  post_json "$API_BASE/api/nodes/agent/releases/$RELEASE_ID/ack" "$payload" || true
}

render_template() {
  local value="$1"
  local arch="$2"
  value="${value//\{version\}/$RUNTIME_VERSION}"
  value="${value//\{arch\}/$arch}"
  value="${value//\{config_path\}/$RUNTIME_CONFIG_PATH}"
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

runtime_binary_version_output() {
  local binary_path="$1"
  [ -x "$binary_path" ] || return 1
  "$binary_path" version 2>/dev/null | head -n 1 | tr -d '\r'
}

expected_runtime_version_output() {
  case "$RUNTIME_ENGINE" in
    sing-box)
      printf 'sing-box version %s' "$RUNTIME_VERSION"
      ;;
    xray)
      printf 'Xray %s' "$RUNTIME_VERSION"
      ;;
    *)
      printf ''
      ;;
  esac
}

runtime_binary_is_current() {
  local installed_version expected_version
  [ -x "$RUNTIME_INSTALL_PATH" ] || return 1
  expected_version="$(expected_runtime_version_output)"
  [ -n "$expected_version" ] || return 1
  installed_version="$(runtime_binary_version_output "$RUNTIME_INSTALL_PATH" || true)"
  [ "$installed_version" = "$expected_version" ]
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

  case "$RUNTIME_ENGINE" in
    sing-box)
      local singbox_tag singbox_version
      singbox_tag="$(normalize_version_tag "$RUNTIME_VERSION" || true)"
      [ -n "$singbox_tag" ] || singbox_tag="v1.13.0"
      singbox_version="${singbox_tag#v}"
      asset_name="sing-box-${singbox_version}-linux-${arch}.tar.gz"
      binary_rel="sing-box-${singbox_version}-linux-${arch}/sing-box"
      download_url="https://github.com/SagerNet/sing-box/releases/download/${singbox_tag}/${asset_name}"
      ;;
    xray)
      local xray_tag
      asset_name="Xray-linux-${arch}.zip"
      binary_rel="xray"
      xray_tag="$(normalize_version_tag "$RUNTIME_VERSION" || true)"
      [ -n "$xray_tag" ] || xray_tag="v26.2.6"
      download_url="https://github.com/XTLS/Xray-core/releases/download/${xray_tag}/${asset_name}"
      ;;
    *)
      asset_name="$(render_template "$RUNTIME_ASSET_TEMPLATE" "$arch")"
      binary_rel="$(render_template "$RUNTIME_BINARY_PATH_TEMPLATE" "$arch")"
      if [ -n "${RUNTIME_DOWNLOAD_BASE_URL:-}" ]; then
        download_url="$RUNTIME_DOWNLOAD_BASE_URL/$asset_name"
      else
        echo "Runtime download URL resolver missing for engine: $RUNTIME_ENGINE" >&2
        return 1
      fi
      ;;
  esac

  archive_file="$TMP_DIR/$asset_name"
  unpack_dir="$TMP_DIR/unpack"

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

ensure_runtime_binary_ready() {
  resolve_runtime_install_path
  if [ "$RELEASE_KIND" = "bootstrap" ]; then
    if runtime_binary_is_current; then
      log "Reusing runtime binary: $RUNTIME_INSTALL_PATH"
      return 0
    fi
    log "Installing runtime binary: $RUNTIME_ENGINE $RUNTIME_VERSION"
    install_runtime_binary
    return 0
  fi

  if [ ! -x "$RUNTIME_INSTALL_PATH" ]; then
    echo "Runtime binary missing for $RUNTIME_ENGINE: $RUNTIME_INSTALL_PATH. Publish a bootstrap release to install it." >&2
    return 1
  fi
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

guess_acme_email() {
  local domain="$1"
  local zone="$domain"
  if [ "$(printf '%s' "$domain" | awk -F '.' '{ print NF }')" -gt 2 ]; then
    zone="${domain#*.}"
  fi
  if [ -z "$zone" ]; then
    zone="example.com"
  fi
  printf 'hostmaster@%s' "$zone"
}

install_lego_binary() {
  local target="$RUNTIME_BIN_DIR/lego"
  local version
  local fallback_version="v4.32.0"
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
  version="$(get_latest_github_tag "go-acme/lego" "$fallback_version")"
  [ -n "$version" ] || version="$fallback_version"
  asset="lego_${version}_linux_${arch}.tar.gz"
  archive_file="$TMP_DIR/$asset"
  unpack_dir="$TMP_DIR/lego"
  mkdir -p "$unpack_dir"
  http_download_to_file "https://github.com/go-acme/lego/releases/download/${version}/${asset}" "$archive_file"
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
  CLOUDFLARE_DNS_API_TOKEN="$NODE_CF_DNS_TOKEN" "$lego_bin" "${args[@]}" run >/dev/null
  cert_source="$certs_dir/certificates/${primary_domain}.crt"
  key_source="$certs_dir/certificates/${primary_domain}.key"
  [ -s "$cert_source" ] && [ -s "$key_source" ] || return 1
  mkdir -p "$(dirname "$BOOTSTRAP_CERT_PATH")"
  cp "$cert_source" "$BOOTSTRAP_CERT_PATH"
  cp "$key_source" "$BOOTSTRAP_KEY_PATH"
}

issue_standalone_certificate() {
  local lego_bin="$1"
  local primary_domain="$BOOTSTRAP_PRIMARY_TLS_DOMAIN"
  local certs_dir="$STATE_DIR/lego"
  local cert_source key_source email
  if [ -z "$primary_domain" ]; then
    primary_domain="$(printf '%s\n' "$BOOTSTRAP_TLS_DOMAINS" | awk 'NF { print; exit }')"
  fi
  [ -n "$primary_domain" ] || return 1
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    warn "Standalone ACME requires root to bind port 80."
    return 1
  fi
  email="$(guess_acme_email "$primary_domain")"
  mkdir -p "$certs_dir"
  local args=(--accept-tos --path "$certs_dir" --email "$email" --http --http.port :80)
  while IFS= read -r domain; do
    [ -n "$domain" ] || continue
    args+=(--domains "$domain")
  done <<< "$BOOTSTRAP_TLS_DOMAINS"
  "$lego_bin" "${args[@]}" run >/dev/null
  cert_source="$certs_dir/certificates/${primary_domain}.crt"
  key_source="$certs_dir/certificates/${primary_domain}.key"
  [ -s "$cert_source" ] && [ -s "$key_source" ] || return 1
  mkdir -p "$(dirname "$BOOTSTRAP_CERT_PATH")"
  cp "$cert_source" "$BOOTSTRAP_CERT_PATH"
  cp "$key_source" "$BOOTSTRAP_KEY_PATH"
}

existing_certificate_is_self_signed() {
  if [ ! -s "$BOOTSTRAP_CERT_PATH" ] || ! command -v openssl >/dev/null 2>&1; then
    return 1
  fi
  local issuer subject
  issuer="$(openssl x509 -in "$BOOTSTRAP_CERT_PATH" -noout -issuer 2>/dev/null | sed 's/^issuer= *//')"
  subject="$(openssl x509 -in "$BOOTSTRAP_CERT_PATH" -noout -subject 2>/dev/null | sed 's/^subject= *//')"
  [ -n "$issuer" ] && [ "$issuer" = "$subject" ]
}

ensure_tls_certificate() {
  if [ "$BOOTSTRAP_NEEDS_CERTS" != "1" ]; then
    return 0
  fi
  if [ -s "$BOOTSTRAP_CERT_PATH" ] && [ -s "$BOOTSTRAP_KEY_PATH" ]; then
    if existing_certificate_is_self_signed; then
      warn "Existing TLS certificate is self-signed; replacing via lego."
    else
      return 0
    fi
  fi

  if [ -z "$BOOTSTRAP_TLS_DOMAINS" ]; then
    warn "TLS domains are empty; skipping certificate issuance."
    return 1
  fi

  local lego_bin
  lego_bin="$(install_lego_binary)" || return 1

  if [ -n "$NODE_CF_DNS_TOKEN" ] && [ -n "$BOOTSTRAP_TLS_DOMAINS" ]; then
    if issue_cloudflare_certificate "$lego_bin"; then
      log "Issued TLS certificate via lego + Cloudflare DNS."
      return 0
    fi
    warn "lego certificate issuance via Cloudflare DNS failed."
  fi

  if issue_standalone_certificate "$lego_bin"; then
    log "Issued TLS certificate via lego standalone HTTP challenge."
    return 0
  fi

  warn "lego standalone certificate issuance failed."
  return 1
}

decode_base64_flexible() {
  local input="$1"
  local normalized mod
  normalized="$(printf '%s' "$input" | tr '_-' '/+')"
  mod=$((${#normalized} % 4))
  if [ "$mod" -eq 2 ]; then
    normalized="${normalized}=="
  elif [ "$mod" -eq 3 ]; then
    normalized="${normalized}="
  elif [ "$mod" -eq 1 ]; then
    return 1
  fi
  printf '%s' "$normalized" | base64 -d 2>/dev/null
}

json_get_string() {
  local json="$1"
  local key="$2"
  printf '%s' "$json" | tr -d '\r\n' | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n1 | sed 's/.*:[[:space:]]*"//; s/"$//'
  return 0
}

json_get_number() {
  local json="$1"
  local key="$2"
  printf '%s' "$json" | tr -d '\r\n' | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[0-9][0-9]*" | head -n1 | sed 's/.*:[[:space:]]*//'
  return 0
}

resolve_warp_apt_codename() {
  local codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
  if [ -z "$codename" ] && [ -r /etc/os-release ]; then
    codename="$(. /etc/os-release 2>/dev/null; printf '%s' "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
  fi
  if [ -z "$codename" ] && command -v lsb_release >/dev/null 2>&1; then
    codename="$(lsb_release -cs 2>/dev/null || true)"
  fi
  printf '%s' "$codename"
}

install_warp_cli_debian() {
  local codename keyring repo_file
  ensure_command curl curl ca-certificates || return 1
  if ! command -v gpg >/dev/null 2>&1; then
    package_install gnupg >/dev/null 2>&1 || package_install gnupg2 >/dev/null 2>&1 || return 1
  fi
  codename="$(resolve_warp_apt_codename)"
  [ -n "$codename" ] || {
    warn "Failed to detect Debian/Ubuntu codename for Cloudflare WARP repository."
    return 1
  }
  keyring="/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg"
  repo_file="/etc/apt/sources.list.d/cloudflare-client.list"
  mkdir -p "$(dirname "$keyring")" "$(dirname "$repo_file")"
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o "$keyring"
  cat >"$repo_file" <<EOF
deb [signed-by=${keyring}] https://pkg.cloudflareclient.com/ ${codename} main
EOF
  DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || return 1
  DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflare-warp >/dev/null 2>&1 || return 1
}

resolve_warp_rpm_basearch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) printf 'x86_64' ;;
    aarch64|arm64) printf 'aarch64' ;;
    *) return 1 ;;
  esac
}

install_warp_cli_rpm() {
  local basearch repo_file
  ensure_command curl curl ca-certificates || return 1
  basearch="$(resolve_warp_rpm_basearch)" || {
    warn "Cloudflare WARP RPM packages are not available for this architecture."
    return 1
  }
  repo_file="/etc/yum.repos.d/cloudflare-warp.repo"
  rpm --import https://pkg.cloudflareclient.com/pubkey.gpg >/dev/null 2>&1 || return 1
  mkdir -p "$(dirname "$repo_file")"
  cat >"$repo_file" <<EOF
[cloudflare-warp]
name=cloudflare-warp
baseurl=https://pkg.cloudflareclient.com/rpm/${basearch}
enabled=1
gpgcheck=1
gpgkey=https://pkg.cloudflareclient.com/pubkey.gpg
repo_gpgcheck=0
EOF
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y cloudflare-warp >/dev/null 2>&1 || return 1
    return 0
  fi
  yum install -y cloudflare-warp >/dev/null 2>&1 || return 1
}

install_warp_cli() {
  if command -v warp-cli >/dev/null 2>&1; then
    log "Reusing existing warp-cli installation."
    return 0
  fi
  is_root || {
    warn "Official warp-cli installation requires root-mode permissions."
    return 1
  }
  if command -v apt-get >/dev/null 2>&1; then
    install_warp_cli_debian
    return $?
  fi
  if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    install_warp_cli_rpm
    return $?
  fi
  warn "Unsupported package manager for official warp-cli installation."
  return 1
}

run_warp_cli() {
  local output rc
  command -v warp-cli >/dev/null 2>&1 || return 127
  output="$(warp-cli --accept-tos "$@" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if printf '%s' "$output" | grep -qi -- 'accept-tos'; then
    output="$(warp-cli "$@" 2>&1)"
    rc=$?
    [ "$rc" -eq 0 ] && return 0
  fi
  [ -n "$output" ] && warn "warp-cli $*: $(printf '%s' "$output" | tail -n 1)"
  return "$rc"
}

capture_warp_cli() {
  command -v warp-cli >/dev/null 2>&1 || return 127
  warp-cli --accept-tos "$@" 2>/dev/null && return 0
  warp-cli "$@" 2>/dev/null || true
}

warp_cli_registration_show() {
  capture_warp_cli registration show | tr -d '\r'
}

warp_cli_account_type() {
  local registration_output
  registration_output="$(warp_cli_registration_show)"
  printf '%s\n' "$registration_output" | sed -nE 's/^[[:space:]]*Account[[:space:]]+type[[:space:]]*:[[:space:]]*(.+)$/\1/ip' | head -n 1
}

wait_for_warp_connected() {
  local status_output status_lower attempt=0
  while [ "$attempt" -lt 30 ]; do
    status_output="$(capture_warp_cli status | tr -d '\r' || true)"
    status_lower="$(printf '%s' "$status_output" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$status_lower" | grep -q 'connected'; then
      log "warp-cli connected successfully."
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  if printf '%s' "$status_lower" | grep -q 'connecting'; then
    log "warp-cli is still connecting; bootstrap will continue and let the daemon finish in background."
    return 0
  fi
  warn "warp-cli failed to reach connected state: $(printf '%s' "$status_output" | tail -n 1)"
  return 1
}

wait_for_warp_service_ready() {
  local status_output status_lower attempt=0
  while [ "$attempt" -lt 15 ]; do
    if warp_service_running; then
      status_output="$(capture_warp_cli status | tr -d '\r' || true)"
      status_lower="$(printf '%s' "$status_output" | tr '[:upper:]' '[:lower:]')"
      if [ -n "$status_lower" ] && ! printf '%s' "$status_lower" | grep -Eq 'failed to connect|unable to connect|could not connect|not connected to the local daemon|service is not ready'; then
        return 0
      fi
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  warn "warp-cli daemon is not ready: $(printf '%s' "$status_output" | tail -n 1)"
  return 1
}

warp_service_running() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl is-active --quiet warp-svc >/dev/null 2>&1 && return 0
  fi
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -x warp-svc >/dev/null 2>&1 && return 0
  fi
  return 1
}

start_warp_service_background() {
  local warp_svc_bin log_file
  warp_svc_bin="$(command -v warp-svc 2>/dev/null || true)"
  [ -n "$warp_svc_bin" ] || {
    warn "warp-svc binary not found after warp-cli installation."
    return 1
  }
  warp_service_running && return 0
  mkdir -p "$STATE_DIR/warp"
  log_file="$STATE_DIR/warp/warp-svc.log"
  nohup "$warp_svc_bin" >"$log_file" 2>&1 &
  sleep 2
  warp_service_running && return 0
  warn "warp-svc background process failed to start. Check $log_file for details."
  return 1
}

ensure_warp_service() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl enable --now warp-svc >/dev/null 2>&1 || true
    systemctl restart warp-svc >/dev/null 2>&1 || true
  else
    start_warp_service_background || return 1
  fi
  warp_service_running || {
    warn "warp-svc is not running after bootstrap startup."
    return 1
  }
}

configure_warp_cli() {
  local account_type attempt=0
  command -v warp-cli >/dev/null 2>&1 || {
    warn "warp-cli is not available after installation."
    return 1
  }
  wait_for_warp_service_ready || return 1
  while [ "$attempt" -lt 3 ]; do
    run_warp_cli registration new && break
    sleep 3
    attempt=$((attempt + 1))
  done
  if [ -n "$NODE_WARP_LICENSE_KEY" ]; then
    run_warp_cli registration license "$NODE_WARP_LICENSE_KEY" || {
      warn "Failed to apply the provided WARP License Key."
      return 1
    }
  fi
  account_type="$(warp_cli_account_type)"
  if [ -n "$account_type" ]; then
    log "warp-cli account type: $account_type"
  fi
  run_warp_cli connect || {
    warn "warp-cli connect command failed. Current status: $(capture_warp_cli status | tr -d '\r' | tail -n 1)"
    return 1
  }
  wait_for_warp_connected
}

ensure_warp_bootstrap() {
  is_root || {
    warn "Official warp-cli bootstrap requires root-mode permissions."
    return 1
  }
  install_warp_cli || return 1
  ensure_warp_service
  configure_warp_cli || return 1
  log "Official warp-cli bootstrap completed."
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
  http_download_to_file "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" "$TMP_DIR/cloudflared"
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
    grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$log_file" 2>/dev/null | tail -n1 | sed 's|https://||' > "$domain_file" || true
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
ARGO_TUNNEL_TOKEN=${NODE_ARGO_TUNNEL_TOKEN}
ARGO_ORIGIN_URL=http://127.0.0.1:${NODE_ARGO_ORIGIN_PORT}
ARGO_LOG_FILE=${log_file}
EOF
  if [ -n "$NODE_ARGO_TUNNEL_TOKEN" ]; then
    cat >"$service_file" <<EOF
[Unit]
Description=nodehubsapi cloudflared
After=network-online.target ${RUNTIME_PRIMARY_SERVICE_NAME}.service
Wants=network-online.target ${RUNTIME_PRIMARY_SERVICE_NAME}.service

[Service]
Type=simple
EnvironmentFile=${env_file}
ExecStart=/bin/sh -lc 'exec ${cloudflared_bin} tunnel --no-autoupdate --edge-ip-version auto --protocol http2 run --token "$ARGO_TUNNEL_TOKEN" >>"$ARGO_LOG_FILE" 2>&1'
Restart=always
RestartSec=5

[Install]
WantedBy=$SYSTEMD_WANTED_BY
EOF
  else
    cat >"$service_file" <<EOF
[Unit]
Description=nodehubsapi cloudflared
After=network-online.target ${RUNTIME_PRIMARY_SERVICE_NAME}.service
Wants=network-online.target ${RUNTIME_PRIMARY_SERVICE_NAME}.service

[Service]
Type=simple
EnvironmentFile=${env_file}
ExecStart=/bin/sh -lc 'exec ${cloudflared_bin} tunnel --url "$ARGO_ORIGIN_URL" --edge-ip-version auto --no-autoupdate --protocol http2 >>"$ARGO_LOG_FILE" 2>&1'
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
__RUNTIME_FILE_BLOCKS__
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
  local pid_file="$STATE_DIR/runtime/${engine}.pid"
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
  log_file="$STATE_DIR/runtime/${RUNTIME_ENGINE}.log"
  pid_file="$STATE_DIR/runtime/${RUNTIME_ENGINE}.pid"
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

prepare_runtime_plans() {
  if [ "$RUNTIME_PLAN_COUNT" -le 0 ]; then
    return 0
  fi
__RUNTIME_PREPARE_BLOCKS__
}

apply_runtime_plans() {
  if [ "$RUNTIME_PLAN_COUNT" -le 0 ]; then
    warn "No runtime plans in release artifact."
    return 0
  fi
__RUNTIME_APPLY_BLOCKS__
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local env_file="$ETC_DIR/agent.env"
  local tmp_file
  mkdir -p "$(dirname "$env_file")"
  if [ ! -f "$env_file" ]; then
    printf '%s=%s\n' "$key" "$value" >"$env_file"
    return 0
  fi
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 { print key "=" value; updated = 1; next }
    { print }
    END { if (!updated) print key "=" value }
  ' "$env_file" >"$tmp_file"
  mv "$tmp_file" "$env_file"
}

apply_agent_schedule_settings() {
  if [ "$RELEASE_KIND" != "bootstrap" ]; then
    return 0
  fi
  upsert_env_value "HEARTBEAT_INTERVAL_SECONDS" "$BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS"
  upsert_env_value "VERSION_PULL_INTERVAL_SECONDS" "$BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS"
  HEARTBEAT_INTERVAL_SECONDS="$BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS"
  VERSION_PULL_INTERVAL_SECONDS="$BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS"
  AGENT_RESTART_REQUIRED=1
}

apply_bootstrap_runtime_binaries() {
  if [ "$BOOTSTRAP_RUNTIME_BINARY_COUNT" -le 0 ]; then
    return 0
  fi
__BOOTSTRAP_BINARY_APPLY_BLOCKS__
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
  warn "Release apply failed with exit code $code."
  ack_release "failed" "release apply failed"
  cleanup
  exit "$code"
}

main() {
  detect_execution_mode

  TMP_DIR="$(mktemp -d)"
  trap fail_apply ERR

  mkdir -p "$ETC_DIR/runtime" "$ETC_DIR/certs" "$STATE_DIR/releases" "$STATE_DIR/warp" "$STATE_DIR/argo" "$STATE_DIR/lego" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d" "$ETC_DIR/hooks/bootstrap.d"
  APPLY_LOG_FILE="$STATE_DIR/releases/apply-$RELEASE_ID.log"
  : > "$APPLY_LOG_FILE"
  log "Release apply start: release=$RELEASE_ID revision=$RELEASE_REVISION kind=$RELEASE_KIND"
  log "Release apply mode: $INSTALL_MODE"

  refresh_agent_installation_if_needed
  ack_release "applying" "release apply started"
  run_hooks "$ETC_DIR/hooks/pre-apply.d"
  if [ "$RELEASE_KIND" = "bootstrap" ]; then
    run_hooks "$ETC_DIR/hooks/bootstrap.d"
  fi
  if [ "$RELEASE_KIND" = "runtime" ]; then
    prepare_runtime_plans
    stop_runtime_kernels
    write_runtime_files
    ensure_tls_certificate
    apply_runtime_plans
    cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"
  fi
  if [ "$RELEASE_KIND" = "bootstrap" ]; then
    apply_bootstrap_runtime_binaries
  fi
  if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_WARP" = "1" ]; then
    ensure_warp_bootstrap
  fi
  apply_agent_schedule_settings
  run_hooks "$ETC_DIR/hooks/post-apply.d"
  ack_release "healthy" "release applied"
  schedule_agent_restart_if_needed
  trap - ERR
  cleanup
}

main "$@"
