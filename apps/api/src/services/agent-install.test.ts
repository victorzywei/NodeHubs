import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildAgentInstallScript,
  buildAgentReconcileEnv,
  buildDeployCommand,
  buildReleaseApplyScript,
  buildUninstallCommand,
} from './agent-install'
import { renderReleaseArtifact } from './release-renderer'
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
    installWarp: false,
    warpLicenseKey: '',
    cfDnsToken: '',
    argoTunnelToken: '',
    argoTunnelDomain: '',
    argoTunnelPort: 2053,
    configRevision: 2,
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

function toWslPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const driveMatch = normalized.match(/^([A-Za-z]):(\/.*)$/)
  if (!driveMatch) return normalized
  return `/mnt/${driveMatch[1].toLowerCase()}${driveMatch[2]}`
}

let cachedBashSyntaxRunner: { command: string; args: string[] } | null | undefined

function bashSyntaxRunner(filePath: string): { command: string; args: string[] } | null {
  if (cachedBashSyntaxRunner !== undefined) {
    const resolvedPath = process.platform === 'win32' ? toWslPath(filePath) : filePath
    return cachedBashSyntaxRunner
      ? { command: cachedBashSyntaxRunner.command, args: [...cachedBashSyntaxRunner.args, resolvedPath] }
      : null
  }

  if (process.platform === 'win32') {
    const probe = spawnSync('wsl', ['bash', '-lc', 'exit 0'], { encoding: 'utf8' })
    if (probe.status === 0) {
      cachedBashSyntaxRunner = {
        command: 'wsl',
        args: ['bash', '-n'],
      }
      return { command: cachedBashSyntaxRunner.command, args: [...cachedBashSyntaxRunner.args, toWslPath(filePath)] }
    }
    cachedBashSyntaxRunner = null
    return null
  }

  const probe = spawnSync('bash', ['-lc', 'exit 0'], { encoding: 'utf8' })
  if (probe.status === 0) {
    cachedBashSyntaxRunner = {
      command: 'bash',
      args: ['-n'],
    }
    return { command: cachedBashSyntaxRunner.command, args: [...cachedBashSyntaxRunner.args, filePath] }
  }
  cachedBashSyntaxRunner = null
  return null
}

function expectScriptToPassBashSyntax(script: string, fileName: string): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'nodehubsapi-shell-'))
  const scriptPath = join(tempDir, fileName)
  writeFileSync(scriptPath, script, 'utf8')

  try {
    const runner = bashSyntaxRunner(scriptPath)
    if (!runner) {
      throw new Error('No Bash runtime available for shell syntax validation.')
    }

    const result = spawnSync(runner.command, runner.args, {
      encoding: 'utf8',
    })

    expect(result.status, result.stderr || result.stdout).toBe(0)
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
}

describe('agent install scripts', () => {
  it('builds a parameterized deploy command', () => {
    const command = buildDeployCommand({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
      networkType: 'public',
      primaryDomain: 'edge.example.com',
      backupDomain: 'backup.example.com',
      entryIp: '203.0.113.1',
      githubMirrorUrl: 'https://ghproxy.example.com/https://github.com',
      installWarp: true,
      warpLicenseKey: 'warp-license',
      heartbeatIntervalSeconds: 30,
      versionPullIntervalSeconds: 60,
      cfDnsToken: 'cf-token',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

    expect(command).toContain("INSTALL_URL='https://control.example.com/api/system/install-script'")
    expect(command).toContain("--api-base 'https://control.example.com'")
    expect(command).toContain("--node-id 'node_1'")
    expect(command).toContain('--install-warp')
    expect(command).toContain("--warp-license-key 'warp-license'")
    expect(command).toContain('fi | bash -s --')
  })

  it('builds a generic installer with network, runtime, and warp steps', () => {
    const script = buildAgentInstallScript({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
      networkType: 'public',
      primaryDomain: 'edge.example.com',
      backupDomain: 'backup.example.com',
      entryIp: '203.0.113.1',
      githubMirrorUrl: 'https://ghproxy.example.com/https://github.com',
      installWarp: true,
      warpLicenseKey: 'warp-license',
      heartbeatIntervalSeconds: 30,
      versionPullIntervalSeconds: 60,
      cfDnsToken: 'cf-token',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

    expect(script).toContain('parse_args() {')
    expect(script).toContain('run_step() {')
    expect(script).toContain('Starting nodehubsapi install:')
    expect(script).toContain('Step ${INSTALL_STEP_INDEX}: ${label}')
    expect(script).toContain('recompute_bootstrap_tls_domains')
    expect(script).toContain("NODE_INSTALL_WARP=1")
    expect(script).toContain("NODE_WARP_LICENSE_KEY='warp-license'")
    expect(script).toContain("HEARTBEAT_INTERVAL_SECONDS_DEFAULT='30'")
    expect(script).toContain("VERSION_PULL_INTERVAL_SECONDS_DEFAULT='60'")
    expect(script).toContain('run_network_bootstrap')
    expect(script).toContain('install_runtime_binaries')
    expect(script).toContain('ensure_warp_bootstrap')
    expect(script).toContain('configure_background_agent_startup')
    expect(script).toContain('install_xray_binary')
    expect(script).toContain('install_sing_box_binary')
    expect(script).toContain('runtime_binary_path() {')
    expect(script).toContain('"$path" version >/dev/null 2>&1')
    expect(script).toContain('Existing $name binary is present but not runnable; reinstalling.')
    expect(script).toContain('install_warp_cli')
    expect(script).toContain('ExecStart=/bin/sh -lc \'exec ${cloudflared_bin} tunnel --url "\\$ARGO_ORIGIN_URL" --edge-ip-version auto --no-autoupdate --protocol http2 >>"\\$ARGO_LOG_FILE" 2>&1\'')
    expect(script).toContain('curl -fL --http1.1 --connect-timeout 20 --retry 3 --retry-delay 1 --retry-all-errors "$resolved_url" -o "$target"')
    expect(script).toContain('/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env')
    expect(script).not.toContain('hooks/bootstrap.d')
  })

  it('renders shell scripts that pass bash syntax checks', () => {
    const installScript = buildAgentInstallScript({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
      networkType: 'public',
      primaryDomain: 'edge.example.com',
      backupDomain: 'backup.example.com',
      entryIp: '203.0.113.1',
      githubMirrorUrl: 'https://ghproxy.example.com/https://github.com',
      installWarp: true,
      warpLicenseKey: 'warp-license',
      heartbeatIntervalSeconds: 30,
      versionPullIntervalSeconds: 60,
      cfDnsToken: 'cf-token',
      argoTunnelToken: '',
      argoTunnelDomain: '',
      argoTunnelPort: 2053,
    })

    const artifact = renderReleaseArtifact({
      releaseId: 'rel_1',
      revision: 2,
      kind: 'runtime',
      configRevision: 2,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
    })
    const releaseScript = buildReleaseApplyScript(artifact)

    expectScriptToPassBashSyntax(installScript, 'agent-install.sh')
    expectScriptToPassBashSyntax(releaseScript, 'release-apply.sh')
  }, 15000)

  it('builds reconcile env documents for shell sourcing', () => {
    const body = buildAgentReconcileEnv({
      nodeId: 'node_1',
      needsUpdate: true,
      currentReleaseRevision: 1,
      desiredReleaseRevision: 2,
      releaseId: 'rel_1',
      applyUrl: 'https://control.example.com/apply',
      status: 'pending',
      agentVersion: '0.1.3',
      installUrl: 'https://control.example.com/install',
    })

    expect(body).toContain('needs_update=1')
    expect(body).toContain("apply_url='https://control.example.com/apply'")
    expect(body).toContain("agent_version='0.1.3'")
    expect(body).toContain("install_url='https://control.example.com/install'")
  })

  it('builds an uninstall command that removes services and files', () => {
    const command = buildUninstallCommand()

    expect(command).toContain('Stopping services and background processes.')
    expect(command).toContain('nodehubsapi-cloudflared.service')
    expect(command).toContain('warp-svc')
    expect(command).toContain('remove_autostart_block "$HOME/.profile"')
    expect(command).toContain('rm -rf /etc/nodehubsapi /opt/nodehubsapi "$HOME/.config/nodehubsapi" "$HOME/.local/share/nodehubsapi"')
  })

  it('builds runtime apply scripts that reuse installed runtime binaries and restart services', () => {
    const artifact = renderReleaseArtifact({
      releaseId: 'rel_1',
      revision: 2,
      kind: 'runtime',
      configRevision: 2,
      createdAt: '2026-03-06T00:00:00.000Z',
      message: 'ship it',
      summary: 'template update',
      node: createNode(),
      templates: [createTemplate()],
    })

    const script = buildReleaseApplyScript(artifact)

    expect(script).toContain('RUNTIME_PLAN_COUNT=')
    expect(script).toContain('set -Eeuo pipefail')
    expect(script).toContain('load_apply_context')
    expect(script).toContain('attach_apply_log')
    expect(script).toContain('log "Stopping runtime kernels."')
    expect(script).toContain('stop_runtime_kernels')
    expect(script).toContain('log "Writing runtime files."')
    expect(script).toContain('write_runtime_files')
    expect(script).toContain('log "Applying runtime configuration."')
    expect(script).toContain('apply_runtime_plans')
    expect(script).toContain('resolve_runtime_install_path() {')
    expect(script).toContain('Runtime binary not found for $RUNTIME_ENGINE.')
    expect(script).toContain('SYSTEMD_DIR="${SYSTEMD_DIR:-}"')
    expect(script).toContain('SYSTEMD_WANTED_BY="${SYSTEMD_WANTED_BY:-}"')
    expect(script).toContain('RUNTIME_CONFIG_PATH="${ETC_DIR}/runtime/sing-box.json"')
    expect(script).toContain('cp "$ETC_DIR/runtime/release.json" "$STATE_DIR/releases/current.json"')
    expect(script).not.toContain('Publish a bootstrap release to install it.')
    expect(script).not.toContain('hooks/bootstrap.d')
    expect(script).not.toContain('run_hooks')
    expect(script).not.toContain('refresh_agent_installation_if_needed')
    expect(script).not.toContain('schedule_agent_restart_if_needed')
    expect(script).not.toContain('detect_execution_mode')
    expect(script).not.toContain('ensure_tls_certificate')
    expect(script).not.toContain('prepare_runtime_plans')
    expect(script).not.toContain('ensure_runtime_binary_ready')
    expect(script).not.toContain('Installing runtime binary:')
    expect(script).not.toContain('ack_release "applying"')
  })
})
