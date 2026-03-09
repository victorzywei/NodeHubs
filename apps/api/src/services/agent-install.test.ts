import { describe, expect, it } from 'vitest'
import {
  buildAgentInstallScript,
  buildAgentReconcileEnv,
  buildDeployCommand,
  buildReleaseApplyScript,
  buildUninstallCommand,
} from './agent-install'
import { renderReleaseArtifact } from './release-renderer'
import { buildRuntimeCatalog } from './runtime-catalog'
import type { NodeRecord, TemplateRecord } from '@contracts/index'

function createNode(): NodeRecord {
  return {
    id: 'node_1',
    name: 'Tokyo A',
    nodeType: 'vps',
    region: 'ap-northeast',
    tags: ['prod'],
    networkType: 'public',
    primaryDomain: 'edge.example.com',
    backupDomain: '',
    entryIp: '203.0.113.1',
    githubMirrorUrl: '',
    warpLicenseKey: '',
    cfDnsToken: '',
    argoTunnelToken: '',
    argoTunnelDomain: '',
    argoTunnelPort: 2053,
    configRevision: 2,
    bootstrapRevision: 1,
    desiredReleaseRevision: 2,
    currentReleaseRevision: 1,
    currentReleaseStatus: 'healthy',
    lastSeenAt: null,
    heartbeatIntervalSeconds: 15,
    versionPullIntervalSeconds: 15,
    cpuUsagePercent: null,
    memoryUsagePercent: null,
    bytesInTotal: 0,
    bytesOutTotal: 0,
    currentConnections: 0,
    protocolRuntimeVersion: '',
    updatedAt: '2026-03-06T00:00:00.000Z',
    createdAt: '2026-03-06T00:00:00.000Z',
  }
}

function createTemplate(): TemplateRecord {
  return {
    id: 'tpl_1',
    name: 'VLESS edge',
    engine: 'sing-box',
    protocol: 'vless',
    transport: 'ws',
    tlsMode: 'tls',
    warpExit: false,
    warpRouteMode: 'all',
    defaults: {
      serverPort: 443,
      path: '/ws',
      host: 'cdn.example.com',
      sni: 'edge.example.com',
      uuid: '11111111-1111-4111-8111-111111111111',
    },
    notes: '',
    updatedAt: '2026-03-06T00:00:00.000Z',
    createdAt: '2026-03-06T00:00:00.000Z',
  }
}

describe('agent install scripts', () => {
  it('builds a deploy command that fails closed on download errors', () => {
    const command = buildDeployCommand({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
    })

    expect(command).toContain("URL='https://control.example.com/api/nodes/agent/install?nodeId=node_1'")
    expect(command).toContain('TOKEN_HEADER=')
    expect(command).not.toContain('then;')
    expect(command).toContain('fi | bash')
  })

  it('builds a generic installer without package manager dependencies', () => {
    const script = buildAgentInstallScript({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
      networkType: 'public',
      primaryDomain: 'edge.example.com',
      backupDomain: 'backup.example.com',
      entryIp: '203.0.113.1',
      githubMirrorUrl: 'https://ghproxy.example.com/https://github.com',
      cfDnsToken: 'cf-token',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

    expect(script).toContain('/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env')
    expect(script).toContain('curl')
    expect(script).toContain('wget')
    expect(script).toContain('AGENT_VERSION=')
    expect(script).toContain("NODE_NETWORK_TYPE='public'")
    expect(script).toContain('run_network_bootstrap')
    expect(script).toContain('Running mandatory network bootstrap: TLS certificate.')
    expect(script).toContain('ensure_tls_certificate')
    expect(script).toContain('issue_standalone_certificate')
    expect(script).toContain('Cloudflare DNS token detected; lego DNS challenge will be used.')
    expect(script).toContain('Existing TLS certificate is self-signed; replacing via lego.')
    expect(script).not.toContain('Generated fallback self-signed certificate')
    expect(script).toContain('log_stderr() {')
    expect(script).toContain('log_stderr "Reusing existing lego binary: $target"')
    expect(script).toContain('log_stderr "Reusing existing cloudflared binary: $target"')
    expect(script).toContain('--http.port :80')
    expect(script).toContain('HEARTBEAT_INTERVAL_SECONDS=15')
    expect(script).toContain('VERSION_PULL_INTERVAL_SECONDS=15')
    expect(script).toContain("cat >\"$AGENT_BIN\" <<'NODESHUB_AGENT_BIN_EOF'")
    expect(script).toContain('ensure_downloader() {')
    expect(script).toContain('self_heal_background_services')
    expect(script).toContain('log() {')
    expect(script).toContain('warn() {')
    expect(script).toContain('install_user_login_autostart')
    expect(script).toContain('install_system_boot_autostart')
    expect(script).toContain('/etc/rc.local')
    expect(script).toContain('manual restart required (no systemd boot hook detected)')
    expect(script).toContain('.bash_profile')
    expect(script).toContain('value="${value//$\'\\n\'/\\\\n}"')
    expect(script).not.toContain("printf '\\\"' | awk")
    expect(script).not.toContain('awk -v load=')
    expect(script).toContain('self_update_if_needed')
    expect(script).toContain('warn "Heartbeat upload failed for node $NODE_ID."')
    expect(script).toContain('warn "Reconcile fetch failed for node $NODE_ID."')
    expect(script).toContain('warn "Release apply failed: release=$release_id"')
    expect(script).toContain('warn "Reconcile apply step failed: release=$release_id status=${release_status:-unknown}"')
    expect(script).toContain('cpu_core_count() {')
    expect(script).toContain('memory_usage_bytes() {')
    expect(script).toContain('permission_mode() {')
    expect(script).toContain('runtime_status_for() {')
    expect(script).toContain('"cpuCoreCount": ${cpu_cores:-null}')
    expect(script).toContain('"memoryTotalBytes": ${memory_total:-0}')
    expect(script).toContain('"memoryUsedBytes": ${memory_used:-0}')
    expect(script).toContain('"permissionMode": $(json_escape "$permission_mode_value")')
    expect(script).toContain('"singBoxVersion": $(json_escape "$sing_box_version_value")')
    expect(script).toContain('"singBoxStatus": $(json_escape "$sing_box_status_value")')
    expect(script).toContain('"xrayVersion": $(json_escape "$xray_version_value")')
    expect(script).toContain('"xrayStatus": $(json_escape "$xray_status_value")')
    expect(script).toContain('"warpIpv4": $(json_escape "$warp_ipv4_value")')
    expect(script).toContain('"warpAccountType": $(json_escape "$warp_account_type_value")')
    expect(script).toContain('"warpTunnelProtocol": $(json_escape "$warp_tunnel_protocol_value")')
    expect(script).not.toContain('sudo ')
    expect(script).not.toContain('jq')
  })

  it('builds reconcile env documents for shell sourcing', () => {
    const body = buildAgentReconcileEnv({
      nodeId: 'node_1',
      needsUpdate: true,
      currentReleaseRevision: 1,
      desiredReleaseRevision: 2,
      releaseId: 'rel_1',
      applyUrl: 'https://control.example.com/apply',
      artifactUrl: 'https://control.example.com/artifact',
      status: 'pending',
      agentVersion: '0.1.3',
      installUrl: 'https://control.example.com/install',
    })

    expect(body).toContain("needs_update=1")
    expect(body).toContain("apply_url='https://control.example.com/apply'")
    expect(body).toContain("agent_version='0.1.3'")
    expect(body).toContain("install_url='https://control.example.com/install'")
  })

  it('builds an uninstall command that stops services, clears autostart hooks, and removes all managed files', () => {
    const command = buildUninstallCommand()

    expect(command).toContain('Stopping services and background processes.')
    expect(command).toContain('nodehubsapi-cloudflared.service')
    expect(command).toContain('systemctl --user disable "$service"')
    expect(command).toContain('cloudflared tunnel --url')
    expect(command).toContain('"warp-svc"')
    expect(command).toContain('/usr/local/bin/lego')
    expect(command).toContain('remove_autostart_block "$HOME/.profile"')
    expect(command).toContain('remove_autostart_block "/etc/rc.local"')
    expect(command).toContain('rm -f /usr/local/bin/nodehubsapi-agent /usr/local/bin/sing-box /usr/local/bin/xray /usr/local/bin/cloudflared /usr/local/bin/lego')
    expect(command).toContain('rm -rf /etc/nodehubsapi /opt/nodehubsapi "$HOME/.config/nodehubsapi" "$HOME/.local/share/nodehubsapi"')
    expect(command).toContain('Uninstall completed. nodehubsapi files, services, and runtime artifacts were removed.')
  })

  it('builds runtime apply scripts that require an installed runtime binary and write config files', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_1',
      revision: 2,
      kind: 'runtime',
      configRevision: 2,
      bootstrapRevision: 1,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'runtime update',
      node: createNode(),
      templates: [createTemplate()],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 15,
        versionPullIntervalSeconds: 15,
        installSingBox: false,
        installXray: false,
      },
    }, buildRuntimeCatalog())

    const script = buildReleaseApplyScript(artifact)

    expect(script).toContain('RUNTIME_PLAN_COUNT=')
    expect(script).toContain('resolve_runtime_arch')
    expect(script).toContain('prepare_runtime_plans')
    expect(script).toContain('stop_runtime_kernels')
    expect(script).toContain('apply_runtime_plans')
    expect(script).toContain('systemctl stop nodehubsapi-runtime-sing-box.service nodehubsapi-runtime-xray.service')
    expect(script).toContain('ensure_runtime_binary_ready() {')
    expect(script).toContain('Runtime binary missing for $RUNTIME_ENGINE: $RUNTIME_INSTALL_PATH. Publish a bootstrap release to install it.')
    expect(script).toContain('RUNTIME_CONFIG_PATH="${ETC_DIR}/runtime/sing-box.json"')
    expect(script).toContain('RUNTIME_SERVICE_FILE="${SYSTEMD_DIR}/nodehubsapi-runtime-sing-box.service"\n  ensure_runtime_binary_ready')
    expect(script).toContain('RUNTIME_SERVICE_FILE="${SYSTEMD_DIR}/nodehubsapi-runtime-sing-box.service"\n  resolve_runtime_install_path\n  write_runtime_service\n  restart_runtime_service')
    expect(script).not.toContain('RUNTIME_SERVICE_FILE="${SYSTEMD_DIR}/nodehubsapi-runtime-sing-box.service"\n  resolve_runtime_install_path\n  install_runtime_binary')
    expect(script).toContain('refresh_agent_installation_if_needed')
    expect(script).toContain('apply_agent_schedule_settings')
    expect(script).toContain('BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS=')
    expect(script).toContain('BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS=')
    expect(script).toContain('if [ "$RELEASE_KIND" = "runtime" ]; then')
    expect(script).toContain('cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"')
    expect(script).not.toContain('RUNTIME_DOWNLOAD_BASE_URL=')
    expect(script).toContain('APPLY_LOG_FILE="$STATE_DIR/releases/apply-$RELEASE_ID.log"')
    expect(script).toContain('"applyLog": $(json_escape "$apply_log")')
    expect(script).not.toContain('awk -v load=')
    expect(script).toContain('schedule_agent_restart_if_needed')
    expect(script).toContain('if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_WARP" = "1" ]; then')
    expect(script).toContain('apply_bootstrap_runtime_binaries')
    expect(script).toContain('install_warp_cli_debian() {')
    expect(script).toContain('install_warp_cli_rpm() {')
    expect(script).toContain('install_warp_cli() {')
    expect(script).toContain('run_warp_cli() {')
    expect(script).toContain('warp_cli_account_type() {')
    expect(script).toContain('wait_for_warp_connected() {')
    expect(script).toContain('wait_for_warp_service_ready() {')
    expect(script).toContain('warp_service_running() {')
    expect(script).toContain('start_warp_service_background() {')
    expect(script).toContain('https://pkg.cloudflareclient.com/')
    expect(script).toContain('cloudflare-warp')
    expect(script).toContain('systemctl enable --now warp-svc')
    expect(script).toContain('nohup "$warp_svc_bin" >"$log_file" 2>&1 &')
    expect(script).toContain('run_warp_cli registration new')
    expect(script).toContain('while [ "$attempt" -lt 3 ]; do')
    expect(script).toContain('run_warp_cli registration license "$NODE_WARP_LICENSE_KEY"')
    expect(script).toContain('wait_for_warp_service_ready || return 1')
    expect(script).toContain('run_warp_cli connect')
    expect(script).toContain('wait_for_warp_connected')
    expect(script).toContain('warp-cli is still connecting; bootstrap will continue and let the daemon finish in background.')
    expect(script).toContain('Failed to apply the provided WARP License Key.')
    expect(script).toContain('warp-cli connect command failed. Current status:')
    expect(script).toContain('warp-cli account type: $account_type')
    expect(script).toContain('Official warp-cli bootstrap completed.')
    expect(script).not.toContain('ensure_sing_box_binary_for_warp() {')
    expect(script).not.toContain('generate wg-keypair')
    expect(script).not.toContain('has_ipv6_default_route() {')
    expect(script).not.toContain('resolve_host_ipv4() {')
    expect(script).not.toContain('update_saved_warp_endpoint() {')
    expect(script).toContain('json_get_number() {')
    expect(script).toContain('Issued TLS certificate via lego standalone HTTP challenge.')
    expect(script).not.toContain('BOOTSTRAP_INSTALL_ARGO')
    expect(script).not.toContain('wireguard-tools')
  })

  it('builds bootstrap apply scripts that can install sing-box and xray binaries', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_bootstrap',
      revision: 3,
      kind: 'bootstrap',
      configRevision: 2,
      bootstrapRevision: 2,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'bootstrap binaries',
      summary: 'bootstrap update',
      node: createNode(),
      templates: [],
      bootstrapOptions: {
        installWarp: false,
        warpLicenseKey: '',
        heartbeatIntervalSeconds: 30,
        versionPullIntervalSeconds: 90,
        installSingBox: true,
        installXray: true,
      },
    }, buildRuntimeCatalog())

    const script = buildReleaseApplyScript(artifact)

    expect(script).toContain('BOOTSTRAP_INSTALL_SING_BOX=1')
    expect(script).toContain('BOOTSTRAP_INSTALL_XRAY=1')
    expect(script).toContain("BOOTSTRAP_HEARTBEAT_INTERVAL_SECONDS='30'")
    expect(script).toContain("BOOTSTRAP_VERSION_PULL_INTERVAL_SECONDS='90'")
    expect(script).toContain("NODE_WARP_LICENSE_KEY=''")
    expect(script).toContain("RUNTIME_BINARY_NAME='sing-box'")
    expect(script).toContain("RUNTIME_BINARY_NAME='xray'")
    expect(script).toContain('if [ "$RELEASE_KIND" = "bootstrap" ]; then\n    apply_bootstrap_runtime_binaries')
    expect(script).not.toContain("cat >\"${ETC_DIR}/runtime/release.json\"")
    expect(script).toContain('expected_runtime_version_output() {')
    expect(script).toContain('runtime_binary_is_current() {')
    expect(script).toContain('Installing runtime binary: $RUNTIME_ENGINE $RUNTIME_VERSION')
    expect(script).toContain("https://github.com/XTLS/Xray-core/releases/download/${xray_tag}/${asset_name}")
    expect(script).not.toContain('https://github.com/XTLS/Xray-core/releases/latest/download/${asset_name}')
    expect(script).toContain('write_runtime_files() {\n:\n}')
  })
})
