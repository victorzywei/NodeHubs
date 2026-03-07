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
WARP_BIN_PATH=""
CLOUDFLARED_BIN_PATH=""
SYSTEMCTL_USER_FLAG=""
SYSTEMD_WANTED_BY="multi-user.target"
SYSTEMD_DIR=""
USE_SYSTEMD=0
INSTALL_MODE=""
HEARTBEAT_INTERVAL_SECONDS_DEFAULT=15
VERSION_PULL_INTERVAL_SECONDS_DEFAULT=15
HEARTBEAT_INTERVAL_SECONDS=15
VERSION_PULL_INTERVAL_SECONDS=15
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

warn() {
  printf '%s\n' "[nodehubsapi] WARN: $*" >&2
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
  WARP_BIN_PATH="$RUNTIME_BIN_DIR/warp-go"
  CLOUDFLARED_BIN_PATH="$RUNTIME_BIN_DIR/cloudflared"
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
    log "Reusing existing lego binary: $target"
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
  log "Downloading lego ${version} for TLS bootstrap."
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
  local args=(--accept-tos --path "$certs_dir" --email "$email" --http --http.port 80)
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
    log "Reusing existing cloudflared binary: $target"
    printf '%s' "$target"
    return 0
  fi
  arch="$(resolve_cloudflared_arch)" || {
    warn "cloudflared is not available for this architecture."
    return 1
  }
  log "Downloading cloudflared for Argo bootstrap."
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
  mkdir -p "$STATE_DIR/releases" "$STATE_DIR/runtime" "$STATE_DIR/lego" "$STATE_DIR/argo" "$ETC_DIR/certs" "$ETC_DIR/hooks/pre-apply.d" "$ETC_DIR/hooks/post-apply.d" "$ETC_DIR/hooks/bootstrap.d"
  HEARTBEAT_INTERVAL_SECONDS="$(read_existing_env_value HEARTBEAT_INTERVAL_SECONDS "$HEARTBEAT_INTERVAL_SECONDS_DEFAULT")"
  VERSION_PULL_INTERVAL_SECONDS="$(read_existing_env_value VERSION_PULL_INTERVAL_SECONDS "$VERSION_PULL_INTERVAL_SECONDS_DEFAULT")"
  cat >"$AGENT_ENV_FILE" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
AGENT_TOKEN=$AGENT_TOKEN
AGENT_VERSION=$AGENT_VERSION
AGENT_INSTALL_URL=$AGENT_INSTALL_URL
NODE_NETWORK_TYPE=$NODE_NETWORK_TYPE
NODE_PRIMARY_DOMAIN=$NODE_PRIMARY_DOMAIN
NODE_BACKUP_DOMAIN=$NODE_BACKUP_DOMAIN
NODE_ENTRY_IP=$NODE_ENTRY_IP
GITHUB_MIRROR_URL=$GITHUB_MIRROR_URL
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
WARP_BIN_PATH=$WARP_BIN_PATH
CLOUDFLARED_BIN_PATH=$CLOUDFLARED_BIN_PATH
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
  RUNTIME_BIN_DIR="${RUNTIME_BIN_DIR:-/usr/local/bin}"
  WARP_BIN_PATH="${WARP_BIN_PATH:-$RUNTIME_BIN_DIR/warp-go}"
  CLOUDFLARED_BIN_PATH="${CLOUDFLARED_BIN_PATH:-$RUNTIME_BIN_DIR/cloudflared}"
  HEARTBEAT_INTERVAL_SECONDS="$(normalize_interval "${HEARTBEAT_INTERVAL_SECONDS:-15}" 15)"
  VERSION_PULL_INTERVAL_SECONDS="$(normalize_interval "${VERSION_PULL_INTERVAL_SECONDS:-15}" 15)"
}

load_agent_env

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
  value="${value%%/*}"
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
  "bytesInTotal": ${bytes_in:-0},
  "bytesOutTotal": ${bytes_out:-0},
  "currentConnections": ${connections:-0},
  "cpuUsagePercent": ${cpu:-null},
  "memoryUsagePercent": ${memory:-null},
  "heartbeatIntervalSeconds": ${HEARTBEAT_INTERVAL_SECONDS:-15},
  "versionPullIntervalSeconds": ${VERSION_PULL_INTERVAL_SECONDS:-15},
  "warpStatus": $(json_escape "$warp_status_value"),
  "warpIpv6": $(json_escape "$warp_ipv6_value"),
  "warpEndpoint": $(json_escape "$warp_endpoint_value"),
  "argoStatus": $(json_escape "$argo_status_value"),
  "argoDomain": $(json_escape "$argo_domain_value"),
  "storageTotalBytes": ${storage_total:-0},
  "storageUsedBytes": ${storage_used:-0},
  "storageUsagePercent": ${storage_percent:-null},
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

  self_update_if_needed "${agent_version:-}" "${install_url:-}" || return 1

  if [ "${needs_update:-0}" = "1" ] && [ -n "${release_id:-}" ] && [ -n "${apply_url:-}" ] && { [ "${release_status:-}" = "pending" ] || [ "${release_status:-}" = "applying" ]; }; then
    apply_release "$release_id" "$apply_url" || true
  fi
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
      heartbeat
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
- Network type: $NODE_NETWORK_TYPE
- Agent env: $AGENT_ENV_FILE
- Runtime config root: $ETC_DIR/runtime
- Heartbeat interval: $HEARTBEAT_INTERVAL_SECONDS s
- Version pull interval: $VERSION_PULL_INTERVAL_SECONDS s
- Mandatory bootstrap:
$([ "$NODE_NETWORK_TYPE" = "public" ] && printf '%s' "TLS certificate -> $BOOTSTRAP_CERT_PATH (CF DNS token uses lego DNS challenge; otherwise lego standalone challenge)" || printf '%s' "Argo -> $STATE_DIR/argo/domain")
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
run_network_bootstrap
if ! write_service; then
  start_agent_background
fi
cleanup_tmp_dir
print_summary
