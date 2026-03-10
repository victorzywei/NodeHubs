#!/usr/bin/env bash
set -euo pipefail

API_BASE=__API_BASE__
NODE_ID=__NODE_ID__
AGENT_TOKEN=__AGENT_TOKEN__
AGENT_VERSION=__AGENT_VERSION__
AGENT_INSTALL_URL=__AGENT_INSTALL_URL__
NODE_NETWORK_TYPE=__NODE_NETWORK_TYPE__
NODE_PRIMARY_DOMAIN=__NODE_PRIMARY_DOMAIN__
NODE_BACKUP_DOMAIN=__NODE_BACKUP_DOMAIN__
NODE_ENTRY_IP=__NODE_ENTRY_IP__
GITHUB_MIRROR_URL=__GITHUB_MIRROR_URL__
NODE_INSTALL_WARP=__NODE_INSTALL_WARP__
NODE_WARP_LICENSE_KEY=__NODE_WARP_LICENSE_KEY__
NODE_CF_DNS_TOKEN=__NODE_CF_DNS_TOKEN__
NODE_ARGO_TUNNEL_TOKEN=__NODE_ARGO_TUNNEL_TOKEN__
NODE_ARGO_TUNNEL_DOMAIN=__NODE_ARGO_TUNNEL_DOMAIN__
NODE_ARGO_ORIGIN_PORT=__NODE_ARGO_ORIGIN_PORT__
BOOTSTRAP_NEEDS_CERTS=__BOOTSTRAP_NEEDS_CERTS__
BOOTSTRAP_PRIMARY_TLS_DOMAIN=__BOOTSTRAP_PRIMARY_TLS_DOMAIN__
STATE_DIR=""
ETC_DIR=""
AGENT_BIN=""
SERVICE_FILE=""
AGENT_ENV_FILE=""
RUNTIME_BIN_DIR=""
CLOUDFLARED_BIN_PATH=""
USER_AUTOSTART_SCRIPT=""
AUTOSTART_STATUS=""
SYSTEMCTL_USER_FLAG=""
SYSTEMD_WANTED_BY="multi-user.target"
SYSTEMD_DIR=""
USE_SYSTEMD=0
INSTALL_MODE=""
HEARTBEAT_INTERVAL_SECONDS_DEFAULT=__HEARTBEAT_INTERVAL_SECONDS__
VERSION_PULL_INTERVAL_SECONDS_DEFAULT=__VERSION_PULL_INTERVAL_SECONDS__
HEARTBEAT_INTERVAL_SECONDS=__HEARTBEAT_INTERVAL_SECONDS__
VERSION_PULL_INTERVAL_SECONDS=__VERSION_PULL_INTERVAL_SECONDS__
BOOTSTRAP_CERT_PATH=""
BOOTSTRAP_KEY_PATH=""
TMP_DIR=""
__BOOTSTRAP_TLS_DOMAINS__
trap cleanup_tmp_dir EXIT

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

log() {
  printf '%s\n' "[nodehubsapi] $*"
}

log_stderr() {
  printf '%s\n' "[nodehubsapi] $*" >&2
}

warn() {
  printf '%s\n' "[nodehubsapi] WARN: $*" >&2
}

INSTALL_STEP_INDEX=0

run_step() {
  local label="$1"
  shift
  INSTALL_STEP_INDEX=$((INSTALL_STEP_INDEX + 1))
  log "Step ${INSTALL_STEP_INDEX}: ${label}"
  "$@"
  log "Step ${INSTALL_STEP_INDEX} completed: ${label}"
}

cleanup_tmp_dir() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
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

detect_install_context() {
  AUTOSTART_STATUS="manual restart required"
  if is_root; then
    INSTALL_MODE="system"
    STATE_DIR="/opt/nodehubsapi"
    ETC_DIR="/etc/nodehubsapi"
    AGENT_BIN="/usr/local/bin/nodehubsapi-agent"
    SERVICE_FILE="/etc/systemd/system/nodehubsapi-agent.service"
    RUNTIME_BIN_DIR="/usr/local/bin"
    SYSTEMD_DIR="/etc/systemd/system"
  else
    INSTALL_MODE="user"
    STATE_DIR="$HOME/.local/share/nodehubsapi"
    ETC_DIR="$HOME/.config/nodehubsapi"
    AGENT_BIN="$HOME/.local/bin/nodehubsapi-agent"
    SERVICE_FILE="$HOME/.config/systemd/user/nodehubsapi-agent.service"
    SYSTEMCTL_USER_FLAG="--user"
    SYSTEMD_WANTED_BY="default.target"
    RUNTIME_BIN_DIR="$HOME/.local/bin"
    SYSTEMD_DIR="$HOME/.config/systemd/user"
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
      SYSTEMD_DIR="$HOME/.config/systemd/user"
      mkdir -p "$STATE_DIR" "$ETC_DIR" "$(dirname "$AGENT_BIN")"
    else
      echo "Failed to create user-mode directories." >&2
      exit 1
    fi
  fi

  AGENT_ENV_FILE="$ETC_DIR/agent.env"
  CLOUDFLARED_BIN_PATH="$RUNTIME_BIN_DIR/cloudflared"
  USER_AUTOSTART_SCRIPT="$ETC_DIR/agent-autostart.sh"
  BOOTSTRAP_CERT_PATH="$ETC_DIR/certs/server.crt"
  BOOTSTRAP_KEY_PATH="$ETC_DIR/certs/server.key"

  if command -v systemctl >/dev/null 2>&1; then
    if [ "$INSTALL_MODE" = "user" ]; then
      if systemctl --user show-environment >/dev/null 2>&1; then
        USE_SYSTEMD=1
      fi
    elif [ -d /run/systemd/system ]; then
      USE_SYSTEMD=1
    fi
  fi

  log "Install context: mode=$INSTALL_MODE, config=$ETC_DIR, state=$STATE_DIR, runtime-bin=$RUNTIME_BIN_DIR"
  if [ "$USE_SYSTEMD" = "1" ]; then
    log "Agent startup mode: systemd"
  else
    log "Agent startup mode: background autostart"
  fi
}

ensure_downloader() {
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || command -v busybox >/dev/null 2>&1; then
    return 0
  fi
  echo "A downloader is required: curl, wget, or busybox wget." >&2
  exit 1
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

http_download_to_file() {
  local url="$1"
  local target="$2"
  local resolved_url
  resolved_url="$(wrap_github_url "$url")"
  log_stderr "Downloading file: $resolved_url"
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

package_install() {
  if ! is_root; then
    return 1
  fi
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

tail_recent_lines() {
  local file="$1"
  local lines="${2:-20}"
  if [ -f "$file" ]; then
    tail -n "$lines" "$file" 2>/dev/null || true
  fi
}

describe_tls_certificate() {
  if [ ! -s "$BOOTSTRAP_CERT_PATH" ] || [ ! -s "$BOOTSTRAP_KEY_PATH" ]; then
    return 1
  fi
  log "TLS certificate path: $BOOTSTRAP_CERT_PATH"
  log "TLS private key path: $BOOTSTRAP_KEY_PATH"
  if command -v openssl >/dev/null 2>&1; then
    local summary
    summary="$(openssl x509 -in "$BOOTSTRAP_CERT_PATH" -noout -issuer -subject -dates 2>/dev/null | tr '\n' '; ' | sed 's/; $//')"
    [ -n "$summary" ] && log "TLS certificate details: $summary"
  fi
}

install_lego_binary() {
  local target="$RUNTIME_BIN_DIR/lego"
  local version
  local fallback_version="v4.32.0"
  local arch asset archive_file unpack_dir
  if [ -x "$target" ]; then
    log_stderr "Reusing existing lego binary: $target"
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
  log_stderr "Downloading lego ${version} for TLS bootstrap."
  http_download_to_file "https://github.com/go-acme/lego/releases/download/${version}/${asset}" "$archive_file"
  tar -xzf "$archive_file" -C "$unpack_dir"
  install_binary_file "$unpack_dir/lego" "$target"
  printf '%s' "$target"
}

issue_cloudflare_certificate() {
  local lego_bin="$1"
  local primary_domain="$BOOTSTRAP_PRIMARY_TLS_DOMAIN"
  local certs_dir="$STATE_DIR/lego"
  local cert_source key_source email issue_log
  if [ -z "$primary_domain" ]; then
    primary_domain="$(printf '%s\n' "$BOOTSTRAP_TLS_DOMAINS" | awk 'NF { print; exit }')"
  fi
  [ -n "$primary_domain" ] || return 1
  email="$(guess_acme_email "$primary_domain")"
  mkdir -p "$certs_dir"
  issue_log="$certs_dir/issue.log"
  : > "$issue_log"
  local args=(--accept-tos --path "$certs_dir" --email "$email" --dns cloudflare)
  while IFS= read -r domain; do
    [ -n "$domain" ] || continue
    args+=(--domains "$domain")
  done <<< "$BOOTSTRAP_TLS_DOMAINS"
  log "Requesting TLS certificate via Cloudflare DNS for: $(printf '%s' "$BOOTSTRAP_TLS_DOMAINS" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if ! CLOUDFLARE_DNS_API_TOKEN="$NODE_CF_DNS_TOKEN" "$lego_bin" "${args[@]}" run >>"$issue_log" 2>&1; then
    warn "lego certificate issuance failed."
    tail_recent_lines "$issue_log" 20 >&2
    return 1
  fi
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
  local cert_source key_source email issue_log
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
  issue_log="$certs_dir/issue-standalone.log"
  : > "$issue_log"
  local args=(--accept-tos --path "$certs_dir" --email "$email" --http --http.port :80)
  while IFS= read -r domain; do
    [ -n "$domain" ] || continue
    args+=(--domains "$domain")
  done <<< "$BOOTSTRAP_TLS_DOMAINS"
  log "Requesting TLS certificate via standalone HTTP challenge for: $(printf '%s' "$BOOTSTRAP_TLS_DOMAINS" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if ! "$lego_bin" "${args[@]}" run >>"$issue_log" 2>&1; then
    warn "lego standalone certificate issuance failed."
    tail_recent_lines "$issue_log" 20 >&2
    return 1
  fi
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
  log "TLS bootstrap mode: public node"
  if [ -s "$BOOTSTRAP_CERT_PATH" ] && [ -s "$BOOTSTRAP_KEY_PATH" ]; then
    if existing_certificate_is_self_signed; then
      warn "Existing TLS certificate is self-signed; replacing via lego."
    else
      log "Reusing existing TLS certificate at $BOOTSTRAP_CERT_PATH."
      describe_tls_certificate || true
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
    log "Cloudflare DNS token detected; lego DNS challenge will be used."
    if issue_cloudflare_certificate "$lego_bin"; then
      log "Issued TLS certificate via lego + Cloudflare DNS."
      describe_tls_certificate || true
      return 0
    fi
    warn "lego certificate issuance via Cloudflare DNS failed."
  else
    log "Cloudflare DNS token missing or no TLS domains configured."
  fi

  if issue_standalone_certificate "$lego_bin"; then
    log "Issued TLS certificate via lego standalone HTTP challenge."
    describe_tls_certificate || true
    return 0
  fi

  warn "lego standalone certificate issuance failed."
  return 1
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

install_cloudflared_binary() {
  local target="$RUNTIME_BIN_DIR/cloudflared"
  local arch
  if [ -x "$target" ]; then
    log_stderr "Reusing existing cloudflared binary: $target"
    printf '%s' "$target"
    return 0
  fi
  arch="$(resolve_cloudflared_arch)" || {
    warn "cloudflared is not available for this architecture."
    return 1
  }
  log_stderr "Downloading cloudflared for Argo bootstrap."
  http_download_to_file "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" "$TMP_DIR/cloudflared"
  install_binary_file "$TMP_DIR/cloudflared" "$target"
  printf '%s' "$target"
}

wait_for_argo_domain() {
  local retries="${1:-10}"
  local delay="${2:-2}"
  local attempt=0
  while [ "$attempt" -lt "$retries" ]; do
    sync_argo_domain_state
    if [ -s "$STATE_DIR/argo/domain" ]; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep "$delay"
  done
  return 1
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
After=network-online.target
Wants=network-online.target

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
After=network-online.target
Wants=network-online.target

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
  log "Preparing Argo bootstrap."
  log "Argo origin URL: http://127.0.0.1:$NODE_ARGO_ORIGIN_PORT"
  if [ -n "$NODE_ARGO_TUNNEL_TOKEN" ]; then
    log "Argo tunnel mode: token-managed tunnel"
  else
    log "Argo tunnel mode: quick tunnel"
  fi
  if [ -n "$NODE_ARGO_TUNNEL_DOMAIN" ]; then
    log "Expected Argo domain: $NODE_ARGO_TUNNEL_DOMAIN"
  fi
  cloudflared_bin="$(install_cloudflared_binary)" || return 1
  if [ "$USE_SYSTEMD" = "1" ]; then
    log "Starting cloudflared with systemd."
    write_argo_service "$cloudflared_bin"
    run_systemctl daemon-reload
    run_systemctl enable --now nodehubsapi-cloudflared.service >/dev/null
    run_systemctl restart nodehubsapi-cloudflared.service
    if run_systemctl is-active --quiet nodehubsapi-cloudflared.service; then
      log "cloudflared service is active."
    else
      warn "cloudflared service is not active yet; check logs if Argo stays unavailable."
    fi
  else
    log "Starting cloudflared in background mode."
    start_argo_background "$cloudflared_bin"
    if [ -f "$STATE_DIR/argo/cloudflared.pid" ] && kill -0 "$(cat "$STATE_DIR/argo/cloudflared.pid" 2>/dev/null || true)" 2>/dev/null; then
      log "cloudflared background process is running."
    else
      warn "cloudflared background process did not stay up; check logs if Argo stays unavailable."
    fi
  fi
  if wait_for_argo_domain 15 2; then
    log "Argo domain: $(cat "$STATE_DIR/argo/domain" 2>/dev/null || true)"
  else
    warn "Argo domain was not detected yet."
  fi
  log "Argo env file: $ETC_DIR/cloudflared.env"
  log "Argo log file: $STATE_DIR/argo/cloudflared.log"
  log "Argo bootstrap completed."
}

run_network_bootstrap() {
  TMP_DIR="$(mktemp -d)"
  mkdir -p "$ETC_DIR/certs" "$STATE_DIR/lego" "$STATE_DIR/argo"
  if [ "$NODE_NETWORK_TYPE" = "public" ]; then
    log "Running mandatory network bootstrap: TLS certificate."
    ensure_tls_certificate
    return 0
  fi
  log "Running mandatory network bootstrap: Argo tunnel."
  ensure_argo_bootstrap
}

resolve_xray_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) printf '64' ;;
    aarch64|arm64) printf 'arm64-v8a' ;;
    armv7l|armv7) printf 'arm32-v7a' ;;
    i386|i686) printf '32' ;;
    *) return 1 ;;
  esac
}

resolve_sing_box_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) printf 'amd64' ;;
    aarch64|arm64) printf 'arm64' ;;
    armv7l|armv7) printf 'armv7' ;;
    i386|i686) printf '386' ;;
    *) return 1 ;;
  esac
}

runtime_binary_exists() {
  local name="$1"
  [ -x "$RUNTIME_BIN_DIR/$name" ] || command -v "$name" >/dev/null 2>&1
}

install_xray_binary() {
  local target="$RUNTIME_BIN_DIR/xray"
  local arch zip_file unpack_dir
  runtime_binary_exists xray && {
    log "Reusing existing xray binary."
    return 0
  }
  arch="$(resolve_xray_arch)" || {
    warn "Unsupported architecture for xray."
    return 1
  }
  ensure_command unzip unzip || {
    warn "unzip is required to install xray."
    return 1
  }
  zip_file="$TMP_DIR/xray.zip"
  unpack_dir="$TMP_DIR/xray"
  mkdir -p "$unpack_dir"
  log "Installing xray binary."
  http_download_to_file "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${arch}.zip" "$zip_file"
  unzip -q -o "$zip_file" -d "$unpack_dir"
  install_binary_file "$unpack_dir/xray" "$target"
}

install_sing_box_binary() {
  local target="$RUNTIME_BIN_DIR/sing-box"
  local arch tag version archive_file unpack_dir extracted
  runtime_binary_exists sing-box && {
    log "Reusing existing sing-box binary."
    return 0
  }
  arch="$(resolve_sing_box_arch)" || {
    warn "Unsupported architecture for sing-box."
    return 1
  }
  ensure_command tar tar || {
    warn "tar is required to install sing-box."
    return 1
  }
  tag="$(get_latest_github_tag "SagerNet/sing-box" "v1.13.0")"
  [ -n "$tag" ] || tag="v1.13.0"
  version="${tag#v}"
  archive_file="$TMP_DIR/sing-box.tar.gz"
  unpack_dir="$TMP_DIR/sing-box"
  mkdir -p "$unpack_dir"
  log "Installing sing-box binary: $tag"
  http_download_to_file "https://github.com/SagerNet/sing-box/releases/download/${tag}/sing-box-${version}-linux-${arch}.tar.gz" "$archive_file"
  tar -xzf "$archive_file" -C "$unpack_dir"
  extracted="$unpack_dir/sing-box-${version}-linux-${arch}/sing-box"
  install_binary_file "$extracted" "$target"
}

install_runtime_binaries() {
  local xray_ready=0
  local sing_box_ready=0
  mkdir -p "$RUNTIME_BIN_DIR"
  install_xray_binary && xray_ready=1 || warn "xray installation failed."
  install_sing_box_binary && sing_box_ready=1 || warn "sing-box installation failed."
  if [ "$xray_ready" -ne 1 ] && [ "$sing_box_ready" -ne 1 ]; then
    echo "Failed to install xray and sing-box." >&2
    exit 1
  fi
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
  [ -n "$codename" ] || return 1
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
  basearch="$(resolve_warp_rpm_basearch)" || return 1
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

warp_cli_account_type() {
  capture_warp_cli registration show | tr -d '\r' | sed -nE 's/^[[:space:]]*Account[[:space:]]+type[[:space:]]*:[[:space:]]*(.+)$/\1/ip' | head -n 1
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
  warn "warp-cli daemon is not ready."
  return 1
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
    log "warp-cli is still connecting; bootstrap will continue in background."
    return 0
  fi
  warn "warp-cli failed to reach connected state."
  return 1
}

start_warp_service_background() {
  local warp_svc_bin log_file
  warp_svc_bin="$(command -v warp-svc 2>/dev/null || true)"
  [ -n "$warp_svc_bin" ] || return 1
  warp_service_running && return 0
  mkdir -p "$STATE_DIR/warp"
  log_file="$STATE_DIR/warp/warp-svc.log"
  nohup "$warp_svc_bin" >"$log_file" 2>&1 &
  sleep 2
  warp_service_running && return 0
  warn "warp-svc background process failed to start."
  return 1
}

ensure_warp_service() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl enable --now warp-svc >/dev/null 2>&1 || true
    systemctl restart warp-svc >/dev/null 2>&1 || true
  else
    start_warp_service_background || return 1
  fi
  warp_service_running || return 1
}

configure_warp_cli() {
  local account_type attempt=0
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
  [ -n "$account_type" ] && log "warp-cli account type: $account_type"
  run_warp_cli connect || return 1
  wait_for_warp_connected
}

ensure_warp_bootstrap() {
  if [ "$NODE_INSTALL_WARP" != "1" ]; then
    return 0
  fi
  is_root || {
    warn "Install WARP requested, but current deployment is user mode; skipping."
    return 0
  }
  install_warp_cli || return 1
  ensure_warp_service || return 1
  configure_warp_cli || return 1
  log "Official warp-cli bootstrap completed."
}

read_existing_env_value() {
  local key="$1"
  local fallback="$2"
  local current=""
  if [ -f "$AGENT_ENV_FILE" ]; then
    current="$(awk -F '=' -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$AGENT_ENV_FILE")"
  fi
  if [ -n "$current" ]; then
    printf '%s' "$current"
    return 0
  fi
  printf '%s' "$fallback"
}

write_agent_env() {
  mkdir -p "$STATE_DIR/releases" "$STATE_DIR/runtime" "$STATE_DIR/lego" "$STATE_DIR/argo" "$ETC_DIR/certs" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d"
  HEARTBEAT_INTERVAL_SECONDS="$(read_existing_env_value HEARTBEAT_INTERVAL_SECONDS "$HEARTBEAT_INTERVAL_SECONDS_DEFAULT")"
  VERSION_PULL_INTERVAL_SECONDS="$(read_existing_env_value VERSION_PULL_INTERVAL_SECONDS "$VERSION_PULL_INTERVAL_SECONDS_DEFAULT")"
  cat >"$AGENT_ENV_FILE" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
AGENT_TOKEN=$AGENT_TOKEN
AGENT_VERSION=$AGENT_VERSION
AGENT_INSTALL_URL=$AGENT_INSTALL_URL
AGENT_BIN=$AGENT_BIN
NODE_NETWORK_TYPE=$NODE_NETWORK_TYPE
NODE_PRIMARY_DOMAIN=$NODE_PRIMARY_DOMAIN
NODE_BACKUP_DOMAIN=$NODE_BACKUP_DOMAIN
NODE_ENTRY_IP=$NODE_ENTRY_IP
GITHUB_MIRROR_URL=$GITHUB_MIRROR_URL
NODE_INSTALL_WARP=$NODE_INSTALL_WARP
NODE_WARP_LICENSE_KEY=$NODE_WARP_LICENSE_KEY
NODE_CF_DNS_TOKEN=$NODE_CF_DNS_TOKEN
NODE_ARGO_TUNNEL_TOKEN=$NODE_ARGO_TUNNEL_TOKEN
NODE_ARGO_TUNNEL_DOMAIN=$NODE_ARGO_TUNNEL_DOMAIN
NODE_ARGO_ORIGIN_PORT=$NODE_ARGO_ORIGIN_PORT
BOOTSTRAP_CERT_PATH=$BOOTSTRAP_CERT_PATH
BOOTSTRAP_KEY_PATH=$BOOTSTRAP_KEY_PATH
STATE_DIR=$STATE_DIR
ETC_DIR=$ETC_DIR
RUNTIME_BIN_DIR=$RUNTIME_BIN_DIR
INSTALL_MODE=$INSTALL_MODE
USE_SYSTEMD=$USE_SYSTEMD
SYSTEMCTL_USER_FLAG=$SYSTEMCTL_USER_FLAG
CLOUDFLARED_BIN_PATH=$CLOUDFLARED_BIN_PATH
USER_AUTOSTART_SCRIPT=$USER_AUTOSTART_SCRIPT
NODESHUB_AGENT_ENV_FILE=$AGENT_ENV_FILE
HEARTBEAT_INTERVAL_SECONDS=$HEARTBEAT_INTERVAL_SECONDS
VERSION_PULL_INTERVAL_SECONDS=$VERSION_PULL_INTERVAL_SECONDS
EOF
}

write_agent_binary() {
  cat >"$AGENT_BIN" <<'NODESHUB_AGENT_BIN_EOF'
#!/usr/bin/env bash
set -euo pipefail

discover_agent_env_file() {
  if [ -n "${NODESHUB_AGENT_ENV_FILE:-}" ] && [ -f "$NODESHUB_AGENT_ENV_FILE" ]; then
    printf '%s' "$NODESHUB_AGENT_ENV_FILE"
    return 0
  fi
  if [ -f /etc/nodehubsapi/agent.env ]; then
    printf '%s' /etc/nodehubsapi/agent.env
    return 0
  fi
  if [ -f "$HOME/.config/nodehubsapi/agent.env" ]; then
    printf '%s' "$HOME/.config/nodehubsapi/agent.env"
    return 0
  fi
  return 1
}

normalize_interval() {
  local value="$1"
  local fallback="$2"
  case "$value" in
    ''|*[!0-9]*)
    printf '%s' "$fallback"
    return 0
    ;;
  esac
  if [ "$value" -lt 5 ]; then
    printf '5'
    return 0
  fi
  if [ "$value" -gt 3600 ]; then
    printf '3600'
    return 0
  fi
  printf '%s' "$value"
}

AGENT_ENV_FILE="$(discover_agent_env_file)" || {
  echo "agent.env not found." >&2
  exit 1
}

load_agent_env() {
  . "$AGENT_ENV_FILE"
  NODESHUB_AGENT_ENV_FILE="$AGENT_ENV_FILE"
  AGENT_BIN="${AGENT_BIN:-$HOME/.local/bin/nodehubsapi-agent}"
  RUNTIME_BIN_DIR="${RUNTIME_BIN_DIR:-/usr/local/bin}"
  CLOUDFLARED_BIN_PATH="${CLOUDFLARED_BIN_PATH:-$RUNTIME_BIN_DIR/cloudflared}"
  HEARTBEAT_INTERVAL_SECONDS="$(normalize_interval "${HEARTBEAT_INTERVAL_SECONDS:-15}" 15)"
  VERSION_PULL_INTERVAL_SECONDS="$(normalize_interval "${VERSION_PULL_INTERVAL_SECONDS:-15}" 15)"
}

load_agent_env

log() {
  printf '%s\n' "[nodehubsapi] $*"
}

warn() {
  printf '%s\n' "[nodehubsapi] WARN: $*" >&2
}

usage() {
  cat <<EOF
Usage:
  $0 --api-base <url> --node-id <id> --agent-token <token> [options]

Options:
  --network-type <public|noPublicIp>
  --primary-domain <domain>
  --backup-domain <domain>
  --entry-ip <ip>
  --github-mirror-url <url>
  --install-warp
  --warp-license-key <key>
  --heartbeat-interval <seconds>
  --version-pull-interval <seconds>
  --cf-dns-token <token>
  --argo-tunnel-token <token>
  --argo-tunnel-domain <domain>
  --argo-tunnel-port <port>
EOF
}

need_value() {
  local option="$1"
  local value="${2:-}"
  [ -n "$value" ] || {
    echo "Option $option requires a value." >&2
    exit 1
  }
}

is_ip_like() {
  local value="$1"
  if printf '%s' "$value" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    return 0
  fi
  if printf '%s' "$value" | grep -Eq '^[0-9a-fA-F:]+$' && printf '%s' "$value" | grep -q ':'; then
    return 0
  fi
  return 1
}

recompute_bootstrap_tls_domains() {
  local domains=""
  local value=""
  for value in "$NODE_PRIMARY_DOMAIN" "$NODE_BACKUP_DOMAIN"; do
    [ -n "$value" ] || continue
    is_ip_like "$value" && continue
    if [ -z "$domains" ]; then
      domains="$value"
    elif ! printf '%s\n' "$domains" | grep -Fxq "$value"; then
      domains="${domains}
$value"
    fi
  done
  BOOTSTRAP_TLS_DOMAINS="$domains"
  if [ -z "$BOOTSTRAP_PRIMARY_TLS_DOMAIN" ] && [ -n "$domains" ]; then
    BOOTSTRAP_PRIMARY_TLS_DOMAIN="$(printf '%s\n' "$domains" | awk 'NF { print; exit }')"
  fi
  if [ "$NODE_NETWORK_TYPE" = "public" ] && [ -n "$domains" ]; then
    BOOTSTRAP_NEEDS_CERTS=1
  else
    BOOTSTRAP_NEEDS_CERTS=0
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --api-base) need_value "$1" "${2:-}"; API_BASE="$2"; shift 2 ;;
      --node-id) need_value "$1" "${2:-}"; NODE_ID="$2"; shift 2 ;;
      --agent-token) need_value "$1" "${2:-}"; AGENT_TOKEN="$2"; shift 2 ;;
      --network-type) need_value "$1" "${2:-}"; NODE_NETWORK_TYPE="$2"; shift 2 ;;
      --primary-domain) need_value "$1" "${2:-}"; NODE_PRIMARY_DOMAIN="$2"; shift 2 ;;
      --backup-domain) need_value "$1" "${2:-}"; NODE_BACKUP_DOMAIN="$2"; shift 2 ;;
      --entry-ip) need_value "$1" "${2:-}"; NODE_ENTRY_IP="$2"; shift 2 ;;
      --github-mirror-url) need_value "$1" "${2:-}"; GITHUB_MIRROR_URL="$2"; shift 2 ;;
      --install-warp) NODE_INSTALL_WARP=1; shift ;;
      --warp-license-key) need_value "$1" "${2:-}"; NODE_WARP_LICENSE_KEY="$2"; shift 2 ;;
      --heartbeat-interval) need_value "$1" "${2:-}"; HEARTBEAT_INTERVAL_SECONDS_DEFAULT="$2"; HEARTBEAT_INTERVAL_SECONDS="$2"; shift 2 ;;
      --version-pull-interval) need_value "$1" "${2:-}"; VERSION_PULL_INTERVAL_SECONDS_DEFAULT="$2"; VERSION_PULL_INTERVAL_SECONDS="$2"; shift 2 ;;
      --cf-dns-token) need_value "$1" "${2:-}"; NODE_CF_DNS_TOKEN="$2"; shift 2 ;;
      --argo-tunnel-token) need_value "$1" "${2:-}"; NODE_ARGO_TUNNEL_TOKEN="$2"; shift 2 ;;
      --argo-tunnel-domain) need_value "$1" "${2:-}"; NODE_ARGO_TUNNEL_DOMAIN="$2"; shift 2 ;;
      --argo-tunnel-port) need_value "$1" "${2:-}"; NODE_ARGO_ORIGIN_PORT="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
  done

  [ -n "$API_BASE" ] || { usage; echo "Missing --api-base" >&2; exit 1; }
  [ -n "$NODE_ID" ] || { usage; echo "Missing --node-id" >&2; exit 1; }
  [ -n "$AGENT_TOKEN" ] || { usage; echo "Missing --agent-token" >&2; exit 1; }
  [ -n "$NODE_NETWORK_TYPE" ] || NODE_NETWORK_TYPE="public"
  if [ -z "$AGENT_INSTALL_URL" ]; then
    AGENT_INSTALL_URL="${API_BASE%/}/api/nodes/agent/install?nodeId=${NODE_ID}"
  fi
  recompute_bootstrap_tls_domains
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\\"/\\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
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
  if [ -z "$desired_version" ] || [ "$desired_version" = "${AGENT_VERSION:-}" ]; then
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

memory_usage_bytes() {
  awk '
    /^MemTotal:/ { total = $2 * 1024 }
    /^MemAvailable:/ { available = $2 * 1024 }
    END {
      if (total <= 0) {
        print "0 0"
      } else {
        used = total - available
        if (used < 0) used = 0
        printf "%.0f %.0f", total, used
      }
    }
  ' /proc/meminfo 2>/dev/null || printf '0 0'
}

cpu_usage_percent() {
  if [ -r /proc/loadavg ] && command -v nproc >/dev/null 2>&1; then
    load_avg=$(awk '{print $1}' /proc/loadavg)
    cores=$(nproc)
    awk -v load_avg="$load_avg" -v cores="$cores" 'BEGIN {
      if (cores <= 0) {
        print "null"
      } else {
        value = (load_avg / cores) * 100
        if (value > 100) value = 100
        printf "%.2f", value
      }
    }'
    return 0
  fi
  printf 'null'
}

cpu_core_count() {
  if command -v nproc >/dev/null 2>&1; then
    nproc 2>/dev/null || printf 'null'
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
  local sing_box_version xray_version
  sing_box_version="$(runtime_version_for "sing-box")"
  if [ -n "$sing_box_version" ]; then
    printf '%s' "$sing_box_version"
    return 0
  fi
  xray_version="$(runtime_version_for "xray")"
  if [ -n "$xray_version" ]; then
    printf '%s' "$xray_version"
    return 0
  fi
  printf ''
}

permission_mode() {
  if [ "${INSTALL_MODE:-}" = "system" ] || is_root; then
    printf 'root'
    return 0
  fi
  printf 'user'
}

runtime_binary_path() {
  case "$1" in
    sing-box) printf '%s' "$RUNTIME_BIN_DIR/sing-box" ;;
    xray) printf '%s' "$RUNTIME_BIN_DIR/xray" ;;
    *) printf '' ;;
  esac
}

runtime_config_path() {
  case "$1" in
    sing-box) printf '%s' "$ETC_DIR/runtime/sing-box.json" ;;
    xray) printf '%s' "$ETC_DIR/runtime/xray.json" ;;
    *) printf '' ;;
  esac
}

runtime_service_name() {
  case "$1" in
    sing-box) printf 'nodehubsapi-runtime-sing-box.service' ;;
    xray) printf 'nodehubsapi-runtime-xray.service' ;;
    *) printf '' ;;
  esac
}

runtime_version_for() {
  local binary
  binary="$(runtime_binary_path "$1")"
  [ -x "$binary" ] || {
    printf ''
    return 0
  }
  "$binary" version 2>/dev/null | head -n 1 | tr -d '\r'
}

runtime_status_for() {
  local engine="$1"
  local binary config service pid_file
  binary="$(runtime_binary_path "$engine")"
  config="$(runtime_config_path "$engine")"
  service="$(runtime_service_name "$engine")"
  pid_file="$STATE_DIR/runtime/${engine}.pid"

  if [ "${USE_SYSTEMD:-0}" = "1" ] && [ -n "$service" ] && command -v systemctl >/dev/null 2>&1 \
    && systemctl ${SYSTEMCTL_USER_FLAG:-} is-active --quiet "$service" 2>/dev/null; then
    printf 'running'
    return 0
  fi
  if pid_file_running "$pid_file"; then
    printf 'running'
    return 0
  fi
  if [ -x "$binary" ] || [ -f "$config" ]; then
    printf 'stopping'
    return 0
  fi
  printf 'not_installed'
}

capture_warp_cli() {
  command -v warp-cli >/dev/null 2>&1 || return 127
  warp-cli --accept-tos "$@" 2>/dev/null && return 0
  warp-cli "$@" 2>/dev/null || true
}

warp_cli_registration_show() {
  capture_warp_cli registration show | tr -d '\r'
}

warp_cli_tunnel_stats() {
  capture_warp_cli tunnel stats | tr -d '\r'
}

warp_ipv4() {
  local value=""
  if command -v ip >/dev/null 2>&1; then
    value="$(ip -o -4 addr show dev CloudflareWARP scope global 2>/dev/null | awk '{print $4}' | head -n 1 || true)"
  fi
  if [ -z "$value" ] && command -v ifconfig >/dev/null 2>&1; then
    value="$(ifconfig CloudflareWARP 2>/dev/null | sed -nE 's/.*inet[[:space:]]+([0-9.]+).*/\1/p' | head -n 1 || true)"
  fi
  if [ -z "$value" ]; then
    value="$(cat "$STATE_DIR/warp/v4" 2>/dev/null || true)"
  fi
  value="${value%%/*}"
  printf '%s' "$value"
}

warp_ipv6() {
  local value=""
  if command -v ip >/dev/null 2>&1; then
    value="$(ip -o -6 addr show dev CloudflareWARP scope global 2>/dev/null | awk '{print $4}' | head -n 1 || true)"
  fi
  if [ -z "$value" ] && command -v ifconfig >/dev/null 2>&1; then
    value="$(ifconfig CloudflareWARP 2>/dev/null | sed -nE 's/.*inet6[[:space:]]+([0-9a-fA-F:]+).*/\1/p' | head -n 1 || true)"
  fi
  if [ -z "$value" ]; then
    value="$(cat "$STATE_DIR/warp/v6" 2>/dev/null || true)"
  fi
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^(Address|Address6)[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}')"
    value="$(printf '%s' "$value" | tr ',' '\n' | grep ':' | tr -d '[:space:]' | head -n 1 || true)"
  fi
  value="${value%%/*}"
  printf '%s' "$value"
}

warp_endpoint() {
  local value="" stats_output=""
  stats_output="$(warp_cli_tunnel_stats)"
  if [ -n "$stats_output" ]; then
    value="$(printf '%s\n' "$stats_output" | sed -nE 's/^[[:space:]]*(Endpoint|Remote)[[:space:]]*:[[:space:]]*(.+)$/\2/ip' | head -n 1 || true)"
  fi
  if [ -z "$value" ]; then
    value="$(cat "$STATE_DIR/warp/endpoint" 2>/dev/null || true)"
  fi
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^Endpoint[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}' || true)"
  fi
  value="$(printf '%s' "$value" | tr -d ' \t\n\r')"
  printf '%s' "$value"
}

warp_account_type() {
  local registration_output value
  registration_output="$(warp_cli_registration_show)"
  value="$(printf '%s\n' "$registration_output" | sed -nE 's/^[[:space:]]*Account[[:space:]]+type[[:space:]]*:[[:space:]]*(.+)$/\1/ip' | head -n 1 || true)"
  printf '%s' "$value"
}

warp_tunnel_protocol() {
  local stats_output value
  stats_output="$(warp_cli_tunnel_stats)"
  value="$(printf '%s\n' "$stats_output" | sed -nE 's/^[[:space:]]*(Tunnel[[:space:]]+protocol|Protocol)[[:space:]]*:[[:space:]]*(.+)$/\2/ip' | head -n 1 || true)"
  printf '%s' "$value"
}

warp_private_key() {
  local value
  value="$(cat "$STATE_DIR/warp/private_key" 2>/dev/null || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^PrivateKey[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}' || true)"
  fi
  value="$(printf '%s' "$value" | tr -d ' \t\n\r')"
  printf '%s' "$value"
}

warp_reserved_json() {
  local value a b c
  value="$(cat "$STATE_DIR/warp/reserved" 2>/dev/null || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/warp/warp.conf" ]; then
    value="$(grep -E '^Reserved[[:space:]]*=' "$STATE_DIR/warp/warp.conf" 2>/dev/null | head -n 1 | awk -F '=' '{print $2}' || true)"
  fi
  value="$(printf '%s' "$value" | tr -d '[] \t\n\r')"
  IFS=',' read -r a b c _ <<< "$value"
  if [[ "$a" =~ ^[0-9]+$ ]] && [[ "$b" =~ ^[0-9]+$ ]] && [[ "$c" =~ ^[0-9]+$ ]]; then
    printf '[%s,%s,%s]' "$a" "$b" "$c"
    return 0
  fi
  printf 'null'
}

warp_status() {
  if command -v warp-cli >/dev/null 2>&1; then
    local status_raw status_lower
    status_raw="$(capture_warp_cli status | tr -d '\r' | tail -n 1 || true)"
    status_lower="$(printf '%s' "$status_raw" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$status_lower" | grep -q 'connected'; then
      printf 'running'
      return 0
    fi
    printf 'installed'
    return 0
  fi
  if [ -f "$STATE_DIR/warp/v4" ] || [ -f "$STATE_DIR/warp/v6" ] || [ -f "$STATE_DIR/warp/warp.conf" ] || [ -f "$STATE_DIR/warp/private_key" ]; then
    printf 'installed'
    return 0
  fi
  printf 'not_installed'
}

argo_domain() {
  local value
  value="$(cat "$STATE_DIR/argo/domain" 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  if [ -z "$value" ] && [ -f "$STATE_DIR/argo/cloudflared.log" ]; then
    value="$(grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE_DIR/argo/cloudflared.log" 2>/dev/null | tail -n 1 | sed 's|https://||' || true)"
  fi
  printf '%s' "$value"
}

argo_status() {
  if [ -f "$STATE_DIR/argo/cloudflared.pid" ] && kill -0 "$(cat "$STATE_DIR/argo/cloudflared.pid" 2>/dev/null || true)" 2>/dev/null; then
    printf 'running'
    return 0
  fi
  if [ "${USE_SYSTEMD:-0}" = "1" ] && command -v systemctl >/dev/null 2>&1 && systemctl ${SYSTEMCTL_USER_FLAG:-} is-active --quiet nodehubsapi-cloudflared.service 2>/dev/null; then
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

pid_file_running() {
  local pid_file="$1"
  local pid=""
  if [ ! -f "$pid_file" ]; then
    return 1
  fi
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  rm -f "$pid_file"
  return 1
}

ensure_runtime_background() {
  local engine="$1"
  local binary config args pid_file log_file
  case "$engine" in
    sing-box)
      binary="$RUNTIME_BIN_DIR/sing-box"
      config="$ETC_DIR/runtime/sing-box.json"
      args="run -c \"$config\""
      ;;
    xray)
      binary="$RUNTIME_BIN_DIR/xray"
      config="$ETC_DIR/runtime/xray.json"
      args="run -config \"$config\""
      ;;
    *)
      return 0
      ;;
  esac

  [ -x "$binary" ] || return 0
  [ -f "$config" ] || return 0

  pid_file="$STATE_DIR/runtime/${engine}.pid"
  log_file="$STATE_DIR/runtime/${engine}.log"
  if pid_file_running "$pid_file"; then
    return 0
  fi

  mkdir -p "$STATE_DIR/runtime"
  nohup /bin/sh -lc "cd \"$ETC_DIR\" && exec \"$binary\" $args" >>"$log_file" 2>&1 &
  echo "$!" > "$pid_file"
}

ensure_argo_background() {
  local pid_file="$STATE_DIR/argo/cloudflared.pid"
  local log_file="$STATE_DIR/argo/cloudflared.log"
  local origin_url="http://127.0.0.1:${NODE_ARGO_ORIGIN_PORT:-2053}"
  [ "${USE_SYSTEMD:-0}" = "1" ] && return 0
  [ "${NODE_NETWORK_TYPE:-}" = "noPublicIp" ] || return 0
  [ -x "$CLOUDFLARED_BIN_PATH" ] || return 0
  if pid_file_running "$pid_file"; then
    return 0
  fi
  mkdir -p "$STATE_DIR/argo"
  if [ -n "${NODE_ARGO_TUNNEL_TOKEN:-}" ]; then
    nohup /bin/sh -lc "exec \"$CLOUDFLARED_BIN_PATH\" tunnel --no-autoupdate --edge-ip-version auto --protocol http2 run --token \"$NODE_ARGO_TUNNEL_TOKEN\" >>\"$log_file\" 2>&1" >/dev/null 2>&1 &
  else
    nohup /bin/sh -lc "exec \"$CLOUDFLARED_BIN_PATH\" tunnel --url \"$origin_url\" --edge-ip-version auto --no-autoupdate --protocol http2 >>\"$log_file\" 2>&1" >/dev/null 2>&1 &
  fi
  echo "$!" > "$pid_file"
}

self_heal_background_services() {
  [ "${USE_SYSTEMD:-0}" = "1" ] && return 0
  ensure_runtime_background "sing-box"
  ensure_runtime_background "xray"
  ensure_argo_background
}

heartbeat() {
  local bytes_in bytes_out memory cpu cpu_cores connections version
  local memory_total memory_used
  local warp_ipv4_value warp_ipv6_value warp_status_value warp_endpoint_value warp_account_type_value warp_tunnel_protocol_value
  local warp_private_key_value warp_reserved_value
  local argo_status_value argo_domain_value
  local permission_mode_value sing_box_version_value sing_box_status_value xray_version_value xray_status_value
  local storage_total storage_used storage_percent
  local payload
  read -r bytes_in bytes_out <<EOF_NET
$(sum_network_bytes)
EOF_NET
  memory="$(memory_usage_percent)"
  cpu="$(cpu_usage_percent)"
  cpu_cores="$(cpu_core_count)"
  read -r memory_total memory_used <<EOF_MEM
$(memory_usage_bytes)
EOF_MEM
  connections="$(connection_count)"
  version="$(runtime_version)"
  permission_mode_value="$(permission_mode)"
  sing_box_version_value="$(runtime_version_for "sing-box")"
  sing_box_status_value="$(runtime_status_for "sing-box")"
  xray_version_value="$(runtime_version_for "xray")"
  xray_status_value="$(runtime_status_for "xray")"
  warp_ipv4_value="$(warp_ipv4)"
  warp_ipv6_value="$(warp_ipv6)"
  warp_status_value="$(warp_status)"
  warp_endpoint_value="$(warp_endpoint)"
  warp_account_type_value="$(warp_account_type)"
  warp_tunnel_protocol_value="$(warp_tunnel_protocol)"
  warp_private_key_value="$(warp_private_key)"
  warp_reserved_value="$(warp_reserved_json)"
  argo_status_value="$(argo_status)"
  argo_domain_value="$(argo_domain)"
  read -r storage_total storage_used storage_percent <<EOF_STORAGE
$(storage_usage)
EOF_STORAGE
  payload=$(cat <<EOF_JSON
{
  "nodeId": $(json_escape "$NODE_ID"),
  "bytesInTotal": ${bytes_in:-0},
  "bytesOutTotal": ${bytes_out:-0},
  "currentConnections": ${connections:-0},
  "cpuCoreCount": ${cpu_cores:-null},
  "cpuUsagePercent": ${cpu:-null},
  "memoryTotalBytes": ${memory_total:-0},
  "memoryUsedBytes": ${memory_used:-0},
  "memoryUsagePercent": ${memory:-null},
  "heartbeatIntervalSeconds": ${HEARTBEAT_INTERVAL_SECONDS:-15},
  "versionPullIntervalSeconds": ${VERSION_PULL_INTERVAL_SECONDS:-15},
  "warpStatus": $(json_escape "$warp_status_value"),
  "warpIpv4": $(json_escape "$warp_ipv4_value"),
  "warpIpv6": $(json_escape "$warp_ipv6_value"),
  "warpEndpoint": $(json_escape "$warp_endpoint_value"),
  "warpAccountType": $(json_escape "$warp_account_type_value"),
  "warpTunnelProtocol": $(json_escape "$warp_tunnel_protocol_value"),
  "warpPrivateKey": $(json_escape "$warp_private_key_value"),
  "warpReserved": ${warp_reserved_value},
  "argoStatus": $(json_escape "$argo_status_value"),
  "argoDomain": $(json_escape "$argo_domain_value"),
  "permissionMode": $(json_escape "$permission_mode_value"),
  "singBoxVersion": $(json_escape "$sing_box_version_value"),
  "singBoxStatus": $(json_escape "$sing_box_status_value"),
  "xrayVersion": $(json_escape "$xray_version_value"),
  "xrayStatus": $(json_escape "$xray_status_value"),
  "storageTotalBytes": ${storage_total:-0},
  "storageUsedBytes": ${storage_used:-0},
  "storageUsagePercent": ${storage_percent:-null},
  "protocolRuntimeVersion": $(json_escape "$version")
}
EOF_JSON
)
  if ! post_json "$API_BASE/api/nodes/agent/heartbeat" "$payload"; then
    warn "Heartbeat upload failed for node $NODE_ID."
    return 1
  fi
  return 0
}

apply_release() {
  local release_id="$1"
  local apply_url="$2"
  local script_file
  script_file="$(mktemp)"
  if ! http_get_to_file "$apply_url" "$script_file"; then
    warn "Release apply script download failed: release=$release_id"
    return 1
  fi
  chmod +x "$script_file"
  log "Applying release: release=$release_id"
  export API_BASE NODE_ID AGENT_TOKEN AGENT_VERSION AGENT_INSTALL_URL ETC_DIR STATE_DIR RUNTIME_BIN_DIR INSTALL_MODE USE_SYSTEMD SYSTEMCTL_USER_FLAG
  if ! bash "$script_file"; then
    warn "Release apply failed: release=$release_id"
    rm -f "$script_file"
    return 1
  fi
  log "Release apply completed: release=$release_id"
  rm -f "$script_file"
  return 0
}

reconcile() {
  local env_file
  env_file="$(mktemp)"
  if ! http_get "$API_BASE/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env" >"$env_file"; then
    warn "Reconcile fetch failed for node $NODE_ID."
    rm -f "$env_file"
    return 1
  fi
  . "$env_file"
  rm -f "$env_file"

  if ! self_update_if_needed "${agent_version:-}" "${install_url:-}"; then
    warn "Agent self-update failed for node $NODE_ID."
    return 1
  fi

  if [ "${needs_update:-0}" = "1" ] && [ -n "${release_id:-}" ] && [ -n "${apply_url:-}" ] && { [ "${release_status:-}" = "pending" ] || [ "${release_status:-}" = "applying" ]; }; then
    if ! apply_release "$release_id" "$apply_url"; then
      warn "Reconcile apply step failed: release=$release_id status=${release_status:-unknown}"
      return 1
    fi
  fi
  return 0
}

unix_now() {
  if command -v date >/dev/null 2>&1; then
    date +%s
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox date +%s
    return 0
  fi
  echo "0"
}

loop() {
  local next_heartbeat_at=0
  local next_reconcile_at=0
  local now heartbeat_interval version_pull_interval next_wake_at sleep_for max_heartbeat_at max_reconcile_at
  while true; do
    load_agent_env
    self_heal_background_services
    now="$(unix_now)"
    heartbeat_interval="${HEARTBEAT_INTERVAL_SECONDS:-15}"
    version_pull_interval="${VERSION_PULL_INTERVAL_SECONDS:-15}"

    if [ "$next_heartbeat_at" -le 0 ]; then
      next_heartbeat_at="$now"
    fi
    if [ "$next_reconcile_at" -le 0 ]; then
      next_reconcile_at="$now"
    fi

    max_heartbeat_at=$((now + heartbeat_interval))
    max_reconcile_at=$((now + version_pull_interval))
    if [ "$next_heartbeat_at" -gt "$max_heartbeat_at" ]; then
      next_heartbeat_at="$max_heartbeat_at"
    fi
    if [ "$next_reconcile_at" -gt "$max_reconcile_at" ]; then
      next_reconcile_at="$max_reconcile_at"
    fi

    if [ "$now" -ge "$next_heartbeat_at" ]; then
      heartbeat || true
      next_heartbeat_at=$((now + heartbeat_interval))
    fi
    if [ "$now" -ge "$next_reconcile_at" ]; then
      reconcile || true
      next_reconcile_at=$((now + version_pull_interval))
    fi

    next_wake_at="$next_heartbeat_at"
    if [ "$next_reconcile_at" -lt "$next_wake_at" ]; then
      next_wake_at="$next_reconcile_at"
    fi
    now="$(unix_now)"
    sleep_for=$((next_wake_at - now))
    if [ "$sleep_for" -lt 1 ]; then
      sleep_for=1
    fi
    sleep "$sleep_for"
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
  AUTOSTART_STATUS="systemd service: nodehubsapi-agent.service"
}

start_agent_background() {
  local pid_file="$STATE_DIR/agent.pid"
  local log_file="$STATE_DIR/agent.log"
  local old_pid=""
  mkdir -p "$STATE_DIR"
  : > "$log_file"
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

configure_background_agent_startup() {
  install_user_login_autostart
  install_system_boot_autostart
  start_agent_background
}

write_background_autostart_launcher() {
  mkdir -p "$(dirname "$USER_AUTOSTART_SCRIPT")"
  cat >"$USER_AUTOSTART_SCRIPT" <<EOF
#!/usr/bin/env bash
set -eu

AGENT_ENV_FILE=$AGENT_ENV_FILE

[ -f "\$AGENT_ENV_FILE" ] || exit 0
. "\$AGENT_ENV_FILE"

AGENT_BIN="\${AGENT_BIN:-$HOME/.local/bin/nodehubsapi-agent}"
STATE_DIR="\${STATE_DIR:-$HOME/.local/share/nodehubsapi}"
PID_FILE="\$STATE_DIR/agent.pid"
LOG_FILE="\$STATE_DIR/agent.log"
PID=""

[ "\${USE_SYSTEMD:-0}" = "1" ] && exit 0

mkdir -p "\$STATE_DIR"

if [ -f "\$PID_FILE" ]; then
  PID="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [ -n "\$PID" ] && kill -0 "\$PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "\$PID_FILE"
fi

if [ ! -x "\$AGENT_BIN" ]; then
  exit 0
fi

nohup "\$AGENT_BIN" >>"\$LOG_FILE" 2>&1 &
echo "\$!" > "\$PID_FILE"
EOF
  chmod +x "$USER_AUTOSTART_SCRIPT"
}

ensure_profile_hook() {
  local profile_file="$1"
  local marker_begin="# >>> nodehubsapi autostart >>>"
  local marker_end="# <<< nodehubsapi autostart <<<"
  [ -f "$profile_file" ] || : >"$profile_file"
  if grep -F "$marker_begin" "$profile_file" >/dev/null 2>&1; then
    return 0
  fi
  cat >>"$profile_file" <<EOF

$marker_begin
if [ -x "$USER_AUTOSTART_SCRIPT" ]; then
  "$USER_AUTOSTART_SCRIPT" >/dev/null 2>&1 || true
fi
$marker_end
EOF
}

install_user_login_autostart() {
  [ "$INSTALL_MODE" = "user" ] || return 0
  [ "$USE_SYSTEMD" = "1" ] && return 0
  write_background_autostart_launcher
  ensure_profile_hook "$HOME/.profile"
  ensure_profile_hook "$HOME/.bash_profile"
  ensure_profile_hook "$HOME/.bash_login"
  ensure_profile_hook "$HOME/.zprofile"
  AUTOSTART_STATUS="$USER_AUTOSTART_SCRIPT (triggered from login shell profiles)"
}

ensure_rc_local_hook() {
  local rc_local="$1"
  local marker_begin="# >>> nodehubsapi autostart >>>"
  local marker_end="# <<< nodehubsapi autostart <<<"
  [ -n "$rc_local" ] || return 1
  if [ ! -f "$rc_local" ]; then
    return 1
  fi
  if grep -F "$marker_begin" "$rc_local" >/dev/null 2>&1; then
    chmod +x "$rc_local" >/dev/null 2>&1 || true
    return 0
  fi
  cat >>"$rc_local" <<EOF

$marker_begin
if [ -x "$USER_AUTOSTART_SCRIPT" ]; then
  "$USER_AUTOSTART_SCRIPT" >/dev/null 2>&1 || true
fi
$marker_end
EOF
  chmod +x "$rc_local" >/dev/null 2>&1 || true
}

install_system_boot_autostart() {
  [ "$INSTALL_MODE" = "system" ] || return 0
  [ "$USE_SYSTEMD" = "1" ] && return 0
  write_background_autostart_launcher
  if ensure_rc_local_hook "/etc/rc.local"; then
    AUTOSTART_STATUS="$USER_AUTOSTART_SCRIPT via /etc/rc.local"
    return 0
  fi
  if ensure_rc_local_hook "/etc/rc.d/rc.local"; then
    AUTOSTART_STATUS="$USER_AUTOSTART_SCRIPT via /etc/rc.d/rc.local"
    return 0
  fi
  warn "No supported boot autostart hook detected for system install without systemd; manual restart will be required after reboot."
  AUTOSTART_STATUS="manual restart required (no systemd boot hook detected)"
}

print_summary() {
  cat <<EOF
nodehubsapi agent installed.

- Install mode: $INSTALL_MODE
- API base: $API_BASE
- Node ID: $NODE_ID
- Network type: $NODE_NETWORK_TYPE
- Agent env: $AGENT_ENV_FILE
- Runtime config root: $ETC_DIR/runtime
- Install WARP: $([ "$NODE_INSTALL_WARP" = "1" ] && printf 'yes' || printf 'no')
- Heartbeat interval: $HEARTBEAT_INTERVAL_SECONDS s
- Version pull interval: $VERSION_PULL_INTERVAL_SECONDS s
- Mandatory deploy steps:
$([ "$NODE_NETWORK_TYPE" = "public" ] && printf '%s' "TLS certificate -> $BOOTSTRAP_CERT_PATH (CF DNS token uses lego DNS challenge; otherwise lego standalone challenge)" || printf '%s' "Argo -> $STATE_DIR/argo/domain")
- Autostart:
$AUTOSTART_STATUS
- Hook directories:
  $ETC_DIR/hooks/pre-apply.d
  $ETC_DIR/hooks/post-apply.d
EOF
}

usage() {
  cat <<EOF
Usage:
  $0 --api-base <url> --node-id <id> --agent-token <token> [options]

Options:
  --network-type <public|noPublicIp>
  --primary-domain <domain>
  --backup-domain <domain>
  --entry-ip <ip>
  --github-mirror-url <url>
  --install-warp
  --warp-license-key <key>
  --heartbeat-interval <seconds>
  --version-pull-interval <seconds>
  --cf-dns-token <token>
  --argo-tunnel-token <token>
  --argo-tunnel-domain <domain>
  --argo-tunnel-port <port>
EOF
}

need_value() {
  local option="$1"
  local value="${2:-}"
  [ -n "$value" ] || {
    echo "Option $option requires a value." >&2
    exit 1
  }
}

is_ip_like() {
  local value="$1"
  if printf '%s' "$value" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    return 0
  fi
  if printf '%s' "$value" | grep -Eq '^[0-9a-fA-F:]+$' && printf '%s' "$value" | grep -q ':'; then
    return 0
  fi
  return 1
}

recompute_bootstrap_tls_domains() {
  local domains=""
  local value=""
  for value in "$NODE_PRIMARY_DOMAIN" "$NODE_BACKUP_DOMAIN"; do
    [ -n "$value" ] || continue
    is_ip_like "$value" && continue
    if [ -z "$domains" ]; then
      domains="$value"
    elif ! printf '%s\n' "$domains" | grep -Fxq "$value"; then
      domains="${domains}
$value"
    fi
  done
  BOOTSTRAP_TLS_DOMAINS="$domains"
  if [ -z "$BOOTSTRAP_PRIMARY_TLS_DOMAIN" ] && [ -n "$domains" ]; then
    BOOTSTRAP_PRIMARY_TLS_DOMAIN="$(printf '%s\n' "$domains" | awk 'NF { print; exit }')"
  fi
  if [ "$NODE_NETWORK_TYPE" = "public" ] && [ -n "$domains" ]; then
    BOOTSTRAP_NEEDS_CERTS=1
  else
    BOOTSTRAP_NEEDS_CERTS=0
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --api-base) need_value "$1" "${2:-}"; API_BASE="$2"; shift 2 ;;
      --node-id) need_value "$1" "${2:-}"; NODE_ID="$2"; shift 2 ;;
      --agent-token) need_value "$1" "${2:-}"; AGENT_TOKEN="$2"; shift 2 ;;
      --network-type) need_value "$1" "${2:-}"; NODE_NETWORK_TYPE="$2"; shift 2 ;;
      --primary-domain) need_value "$1" "${2:-}"; NODE_PRIMARY_DOMAIN="$2"; shift 2 ;;
      --backup-domain) need_value "$1" "${2:-}"; NODE_BACKUP_DOMAIN="$2"; shift 2 ;;
      --entry-ip) need_value "$1" "${2:-}"; NODE_ENTRY_IP="$2"; shift 2 ;;
      --github-mirror-url) need_value "$1" "${2:-}"; GITHUB_MIRROR_URL="$2"; shift 2 ;;
      --install-warp) NODE_INSTALL_WARP=1; shift ;;
      --warp-license-key) need_value "$1" "${2:-}"; NODE_WARP_LICENSE_KEY="$2"; shift 2 ;;
      --heartbeat-interval) need_value "$1" "${2:-}"; HEARTBEAT_INTERVAL_SECONDS_DEFAULT="$2"; HEARTBEAT_INTERVAL_SECONDS="$2"; shift 2 ;;
      --version-pull-interval) need_value "$1" "${2:-}"; VERSION_PULL_INTERVAL_SECONDS_DEFAULT="$2"; VERSION_PULL_INTERVAL_SECONDS="$2"; shift 2 ;;
      --cf-dns-token) need_value "$1" "${2:-}"; NODE_CF_DNS_TOKEN="$2"; shift 2 ;;
      --argo-tunnel-token) need_value "$1" "${2:-}"; NODE_ARGO_TUNNEL_TOKEN="$2"; shift 2 ;;
      --argo-tunnel-domain) need_value "$1" "${2:-}"; NODE_ARGO_TUNNEL_DOMAIN="$2"; shift 2 ;;
      --argo-tunnel-port) need_value "$1" "${2:-}"; NODE_ARGO_ORIGIN_PORT="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
  done

  [ -n "$API_BASE" ] || { usage; echo "Missing --api-base" >&2; exit 1; }
  [ -n "$NODE_ID" ] || { usage; echo "Missing --node-id" >&2; exit 1; }
  [ -n "$AGENT_TOKEN" ] || { usage; echo "Missing --agent-token" >&2; exit 1; }
  [ -n "$NODE_NETWORK_TYPE" ] || NODE_NETWORK_TYPE="public"
  recompute_bootstrap_tls_domains
}

parse_args "$@"
log "Starting nodehubsapi install: node=$NODE_ID network=$NODE_NETWORK_TYPE api=$API_BASE"
ensure_downloader
run_step "Detect install context" detect_install_context
run_step "Write agent environment" write_agent_env
run_step "Install or update agent binary" write_agent_binary
run_step "Prepare network bootstrap" run_network_bootstrap
run_step "Install runtime binaries" install_runtime_binaries
run_step "Install WARP when enabled" ensure_warp_bootstrap
if [ "$USE_SYSTEMD" = "1" ]; then
  run_step "Register and start agent service" write_service
else
  run_step "Configure background autostart and start agent" configure_background_agent_startup
fi
cleanup_tmp_dir
log "Install finished. Printing summary."
print_summary
