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
    installWarp: false,
    installArgo: false,
    configRevision: 2,
    bootstrapRevision: 1,
    desiredReleaseRevision: 2,
    currentReleaseRevision: 1,
    currentReleaseStatus: 'healthy',
    lastSeenAt: null,
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

    expect(command).toContain('bash -lc')
    expect(command).toContain('TMP_FILE="$(mktemp)"')
    expect(command).not.toContain('| bash')
  })

  it('builds a generic installer without package manager dependencies', () => {
    const script = buildAgentInstallScript({
      publicBaseUrl: 'https://control.example.com/',
      nodeId: 'node_1',
      agentToken: 'token_123',
    })

    expect(script).toContain('/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env')
    expect(script).toContain('curl')
    expect(script).toContain('wget')
    expect(script).toContain('AGENT_VERSION=')
    expect(script).toContain('self_update_if_needed')
    expect(script).not.toContain('apt-get install')
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
      agentVersion: '0.1.0',
      installUrl: 'https://control.example.com/install',
    })

    expect(body).toContain("needs_update=1")
    expect(body).toContain("apply_url='https://control.example.com/apply'")
    expect(body).toContain("agent_version='0.1.0'")
    expect(body).toContain("install_url='https://control.example.com/install'")
  })

  it('builds release apply scripts that install runtime binaries and write config files', () => {
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
    }, buildRuntimeCatalog())

    const script = buildReleaseApplyScript(artifact)

    expect(script).toContain('RUNTIME_DOWNLOAD_BASE_URL=')
    expect(script).toContain('resolve_runtime_arch')
    expect(script).toContain('systemctl restart "$RUNTIME_SERVICE_NAME.service"')
    expect(script).toContain('/etc/nodehubsapi/runtime/sing-box.json')
    expect(script).toContain('refresh_agent_installation_if_needed')
    expect(script).toContain('schedule_agent_restart_if_needed')
    expect(script).toContain('if [ "$RELEASE_KIND" = "bootstrap" ] && [ "$BOOTSTRAP_INSTALL_WARP" = "1" ]; then')
  })
})
