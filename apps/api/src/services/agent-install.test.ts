import { describe, expect, it } from 'vitest'
import { buildAgentInstallScript, buildAgentReconcileEnv, buildDeployCommand, buildReleaseApplyScript } from './agent-install'
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
    expect(script).toContain('install_user_login_autostart')
    expect(script).toContain('.bash_profile')
    expect(script).toContain('value="${value//$\'\\n\'/\\\\n}"')
    expect(script).not.toContain("printf '\\\"' | awk")
    expect(script).not.toContain('awk -v load=')
    expect(script).toContain('self_update_if_needed')
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
    expect(script).not.toContain('RUNTIME_DOWNLOAD_BASE_URL=')
    expect(script).toContain('APPLY_LOG_FILE="$STATE_DIR/releases/apply-$RELEASE_ID.log"')
    expect(script).toContain('"applyLog": $(json_escape "$apply_log")')
    expect(script).not.toContain('awk -v load=')
    expect(script).toContain('schedule_agent_restart_if_needed')
    expect(script).toContain('if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_WARP" = "1" ]; then')
    expect(script).toContain('apply_bootstrap_runtime_binaries')
    expect(script).toContain('ensure_sing_box_binary_for_warp() {')
    expect(script).toContain('generate wg-keypair')
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
    expect(script).toContain('expected_runtime_version_output() {')
    expect(script).toContain('runtime_binary_is_current() {')
    expect(script).toContain('Installing runtime binary: $RUNTIME_ENGINE $RUNTIME_VERSION')
    expect(script).toContain("https://github.com/XTLS/Xray-core/releases/download/${xray_tag}/${asset_name}")
    expect(script).not.toContain('https://github.com/XTLS/Xray-core/releases/latest/download/${asset_name}')
  })
})
