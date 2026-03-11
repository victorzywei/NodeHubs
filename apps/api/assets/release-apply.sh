#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_ID=__RELEASE_ID__
RELEASE_REVISION=__RELEASE_REVISION__
RELEASE_KIND=__RELEASE_KIND__
RUNTIME_PLAN_COUNT=__RUNTIME_PLAN_COUNT__
ETC_DIR="${ETC_DIR:-/etc/nodehubsapi}"
STATE_DIR="${STATE_DIR:-/opt/nodehubsapi}"
RUNTIME_BIN_DIR="${RUNTIME_BIN_DIR:-/usr/local/bin}"
INSTALL_MODE="${INSTALL_MODE:-}"
USE_SYSTEMD="${USE_SYSTEMD:-0}"
SYSTEMCTL_USER_FLAG="${SYSTEMCTL_USER_FLAG:-}"
SYSTEMD_DIR="${SYSTEMD_DIR:-}"
SYSTEMD_WANTED_BY="${SYSTEMD_WANTED_BY:-}"
APPLY_LOG_FILE=""
RUNTIME_ENGINE=""
RUNTIME_CONFIG_PATH=""
RUNTIME_SERVICE_NAME=""
RUNTIME_SERVICE_FILE=""
RUNTIME_INSTALL_PATH=""

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

run_systemctl() {
  if [ "$USE_SYSTEMD" != "1" ]; then
    return 1
  fi
  systemctl $SYSTEMCTL_USER_FLAG "$@"
}

load_apply_context() {
  [ -n "$INSTALL_MODE" ] || {
    echo "INSTALL_MODE is missing from agent install context." >&2
    exit 1
  }
  [ -n "$ETC_DIR" ] || {
    echo "ETC_DIR is missing from agent install context." >&2
    exit 1
  }
  [ -n "$STATE_DIR" ] || {
    echo "STATE_DIR is missing from agent install context." >&2
    exit 1
  }
  [ -n "$RUNTIME_BIN_DIR" ] || {
    echo "RUNTIME_BIN_DIR is missing from agent install context." >&2
    exit 1
  }

  if [ "$INSTALL_MODE" = "user" ]; then
    SYSTEMCTL_USER_FLAG="--user"
    SYSTEMD_DIR="${SYSTEMD_DIR:-$HOME/.config/systemd/user}"
    SYSTEMD_WANTED_BY="${SYSTEMD_WANTED_BY:-default.target}"
  else
    SYSTEMCTL_USER_FLAG=""
    SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
    SYSTEMD_WANTED_BY="${SYSTEMD_WANTED_BY:-multi-user.target}"
  fi

  mkdir -p "$ETC_DIR" "$STATE_DIR" "$RUNTIME_BIN_DIR"
}

attach_apply_log() {
  if command -v tee >/dev/null 2>&1; then
    exec > >(tee -a "$APPLY_LOG_FILE") 2>&1
    return 0
  fi
  exec >>"$APPLY_LOG_FILE" 2>&1
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

resolve_runtime_install_path() {
  local binary_name candidate
  case "$RUNTIME_ENGINE" in
    sing-box) binary_name="sing-box" ;;
    xray) binary_name="xray" ;;
    *)
      echo "Unsupported runtime engine: $RUNTIME_ENGINE" >&2
      return 1
      ;;
  esac

  candidate=""
  if [ -x "$RUNTIME_BIN_DIR/$binary_name" ]; then
    candidate="$RUNTIME_BIN_DIR/$binary_name"
  elif [ -x "/usr/local/bin/$binary_name" ]; then
    candidate="/usr/local/bin/$binary_name"
  else
    candidate="$(command -v "$binary_name" 2>/dev/null || true)"
  fi

  if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
    echo "Runtime binary not found for $RUNTIME_ENGINE. Install $binary_name on the node before applying releases." >&2
    return 1
  fi

  RUNTIME_INSTALL_PATH="$candidate"
  log "Using runtime binary: $RUNTIME_ENGINE -> $RUNTIME_INSTALL_PATH"
}

runtime_exec_args() {
  case "$RUNTIME_ENGINE" in
    sing-box)
      printf 'run -c %s' "$RUNTIME_CONFIG_PATH"
      ;;
    xray)
      printf 'run -config %s' "$RUNTIME_CONFIG_PATH"
      ;;
    *)
      echo "Unsupported runtime engine: $RUNTIME_ENGINE" >&2
      return 1
      ;;
  esac
}

write_runtime_files() {
__RUNTIME_FILE_BLOCKS__
}

write_runtime_service() {
  if [ "$USE_SYSTEMD" != "1" ]; then
    return 0
  fi
  local exec_args
  exec_args="$(runtime_exec_args)"
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
  exec_args="$(runtime_exec_args)"
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
    run_systemctl enable "$RUNTIME_SERVICE_NAME.service" >/dev/null
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
__RUNTIME_APPLY_BLOCKS__
}

fail_apply() {
  local code=$?
  warn "Release apply failed with exit code $code."
  ack_release "failed" "release apply failed"
  exit "$code"
}

main() {
  load_apply_context
  trap fail_apply ERR

  mkdir -p "$ETC_DIR/runtime" "$ETC_DIR/certs" "$STATE_DIR/releases" "$STATE_DIR/runtime"
  APPLY_LOG_FILE="$STATE_DIR/releases/apply-$RELEASE_ID.log"
  : > "$APPLY_LOG_FILE"
  attach_apply_log
  log "Release apply start: release=$RELEASE_ID revision=$RELEASE_REVISION kind=$RELEASE_KIND"
  log "Release apply mode: $INSTALL_MODE"

  log "Stopping runtime kernels."
  stop_runtime_kernels
  log "Writing runtime files."
  write_runtime_files
  log "Applying runtime configuration."
  apply_runtime_plans
  cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"
  ack_release "healthy" "release applied"
  trap - ERR
}

main "$@"
