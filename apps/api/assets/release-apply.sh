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
  value="${value%%/*}"
  if [[ "$value" =~ ^\[([0-9A-Fa-f:]+)\](:[0-9]+)?$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$value" == \[*\]:* ]]; then
    value="${value#\[}"
    value="${value%%\]:*}"
  fi
  printf '%s' "$value"
}

has_ipv6_default_route() {
  if ! command -v ip >/dev/null 2>&1; then
    return 1
  fi
  ip -6 route show default 2>/dev/null | grep -q .
}

resolve_host_ipv4() {
  local host="$1"
  local candidate=""
  if [ -z "$host" ]; then
    return 1
  fi
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s' "$host"
    return 0
  fi
  if command -v getent >/dev/null 2>&1; then
    candidate="$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  fi
  if [ -z "$candidate" ] && command -v python3 >/dev/null 2>&1; then
    candidate="$(python3 - "$host" <<'PY'
import socket
import sys

host = sys.argv[1]
try:
    infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_DGRAM)
except OSError:
    infos = []

seen = set()
for info in infos:
    addr = info[4][0]
    if addr not in seen:
        print(addr)
        break
    seen.add(addr)
PY
)"
  fi
  [ -n "$candidate" ] || return 1
  printf '%s' "$candidate"
}

normalize_warp_endpoint() {
  local host_raw="$1"
  local port_raw="$2"
  local host port ipv4_host
  host="$(printf '%s' "$host_raw" | tr -d '[:space:]')"
  port="$(printf '%s' "$port_raw" | tr -d '[:space:]')"
  if [[ "$host" =~ ^\[(.+)\]:([0-9]+)$ ]]; then
    host="${BASH_REMATCH[1]}"
    [ -z "$port" ] && port="${BASH_REMATCH[2]}"
  elif [[ "$host" =~ ^(.+):([0-9]+)$ ]] && [[ "$host" != *:*:* ]]; then
    host="${BASH_REMATCH[1]}"
    [ -z "$port" ] && port="${BASH_REMATCH[2]}"
  fi
  [ -n "$host" ] || host="engage.cloudflareclient.com"
  if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ || "$port" -lt 1 || "$port" -gt 65535 ]]; then
    port="2408"
  fi
  if [[ "$host" != *:* ]] && ! [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && ! has_ipv6_default_route; then
    ipv4_host="$(resolve_host_ipv4 "$host" || true)"
    if [ -n "$ipv4_host" ]; then
      log "No IPv6 default route detected; using IPv4 WARP endpoint ${ipv4_host}:${port} instead of ${host}:${port}."
      host="$ipv4_host"
    fi
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

update_saved_warp_endpoint() {
  local warp_dir="$1"
  local config_file="$warp_dir/warp.conf"
  local current_endpoint normalized_endpoint tmp_file
  [ -s "$config_file" ] || return 0
  current_endpoint="$(sed -n 's/^Endpoint = //p' "$config_file" | head -n1)"
  [ -n "$current_endpoint" ] || return 0
  normalized_endpoint="$(normalize_warp_endpoint "$current_endpoint" "" || true)"
  [ -n "$normalized_endpoint" ] || return 0
  [ "$normalized_endpoint" = "$current_endpoint" ] && return 0
  tmp_file="$(mktemp)"
  awk -v endpoint="$normalized_endpoint" '
    index($0, "Endpoint = ") == 1 { print "Endpoint = " endpoint; next }
    { print }
  ' "$config_file" > "$tmp_file"
  mv "$tmp_file" "$config_file"
  printf '%s\n' "$normalized_endpoint" > "$warp_dir/endpoint"
  log "Updated saved WARP endpoint to ${normalized_endpoint}."
}

ensure_sing_box_binary_for_warp() {
  local existing_bin="$RUNTIME_BIN_DIR/sing-box"
  if [ -x "$existing_bin" ]; then
    printf '%s' "$existing_bin"
    return 0
  fi
  if command -v sing-box >/dev/null 2>&1; then
    command -v sing-box
    return 0
  fi

  warn "sing-box is missing; installing it to generate the WARP WireGuard keypair."
  local RUNTIME_ENGINE="sing-box"
  local RUNTIME_VERSION=""
  local RUNTIME_BINARY_NAME="sing-box"
  local RUNTIME_INSTALL_PATH_DEFAULT="/usr/local/bin/sing-box"
  local RUNTIME_ARCHIVE_FORMAT="tar.gz"
  local RUNTIME_INSTALL_PATH=""
  resolve_runtime_install_path
  install_runtime_binary || return 1
  printf '%s' "$RUNTIME_INSTALL_PATH"
}

generate_warp_keypair_with_sing_box() {
  local sing_box_bin key_output private_key public_key fallback_keys
  sing_box_bin="$(ensure_sing_box_binary_for_warp)" || return 1
  key_output="$("$sing_box_bin" generate wg-keypair 2>/dev/null || true)"
  [ -n "$key_output" ] || {
    warn "sing-box failed to generate a WARP WireGuard keypair."
    return 1
  }

  private_key="$(printf '%s\n' "$key_output" | grep -i 'private' | grep -oE '[A-Za-z0-9+/=]{43,}' | head -n1 || true)"
  public_key="$(printf '%s\n' "$key_output" | grep -i 'public' | grep -oE '[A-Za-z0-9+/=]{43,}' | head -n1 || true)"
  if [ -z "$private_key" ] || [ -z "$public_key" ]; then
    fallback_keys="$(printf '%s\n' "$key_output" | grep -oE '[A-Za-z0-9+/=]{43,}' | head -n2 || true)"
    private_key="$(printf '%s\n' "$fallback_keys" | sed -n '1p')"
    public_key="$(printf '%s\n' "$fallback_keys" | sed -n '2p')"
  fi

  [ -n "$private_key" ] || return 1
  [ -n "$public_key" ] || return 1
  printf '%s\n%s\n' "$private_key" "$public_key"
}

register_warp_via_api() {
  local warp_dir="$STATE_DIR/warp"
  local config_file="$warp_dir/warp.conf"
  local keypair_output reg_api reg_payload response private_key public_key tos serial
  local device_id access_token ipv6 host port client_id_b64 reserved endpoint bytes b1 b2 b3
  local peer_public_key system_interface local_address_ipv4
  mkdir -p "$warp_dir"
  if [ -s "$config_file" ] && [ -s "$warp_dir/private_key" ] && [ -s "$warp_dir/v6" ]; then
    update_saved_warp_endpoint "$warp_dir"
    return 0
  fi
  ensure_command curl curl ca-certificates || return 1
  reg_api="https://api.cloudflareclient.com/v0a4005/reg"
  keypair_output="$(generate_warp_keypair_with_sing_box)" || return 1
  private_key="$(printf '%s\n' "$keypair_output" | sed -n '1p')"
  public_key="$(printf '%s\n' "$keypair_output" | sed -n '2p')"
  [ -n "$private_key" ] || return 1
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
    curl -fsS "${reg_api}/${device_id}/account" -X PUT -H "Content-Type: application/json; charset=UTF-8" -H "Accept: application/json" -H "Authorization: Bearer ${access_token}" --data "$(printf '{"license":"%s"}' "$NODE_WARP_LICENSE_KEY")" >/dev/null 2>&1 || true
  fi
  peer_public_key="bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="
  system_interface="false"
  local_address_ipv4="172.16.0.2/32"
  endpoint="$(normalize_warp_endpoint "$host" "$port")"
  reserved="0,0,0"
  if [ -n "$client_id_b64" ] && command -v od >/dev/null 2>&1 && command -v base64 >/dev/null 2>&1; then
    bytes="$(decode_base64_flexible "$client_id_b64" | od -An -t u1 2>/dev/null | tr -s ' ' | sed 's/^ //')"
    b1="$(echo "$bytes" | awk '{print $1}')"
    b2="$(echo "$bytes" | awk '{print $2}')"
    b3="$(echo "$bytes" | awk '{print $3}')"
    if [ -n "$b1" ] && [ -n "$b2" ] && [ -n "$b3" ]; then
      reserved="${b1},${b2},${b3}"
    fi
  fi
  cat >"$config_file" <<EOF
PrivateKey = ${private_key}
Address4 = ${local_address_ipv4}
Address6 = ${ipv6}/128
Endpoint = ${endpoint}
PeerPublicKey = ${peer_public_key}
SystemInterface = ${system_interface}
Reserved = ${reserved}
DeviceID = ${device_id}
Token = ${access_token}
AllowedIPs = 0.0.0.0/0, ::/0
EOF
  save_warp_runtime "$warp_dir" "$private_key" "$ipv6" "$reserved" "$endpoint"
}

ensure_warp_bootstrap() {
  register_warp_via_api
  log "WARP registration completed."
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
