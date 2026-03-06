<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type {
  NodeRecord,
  ReleaseRecord,
  SubscriptionRecord,
  SystemStatus,
  TemplatePreset,
  TemplateRecord,
  TrafficSample,
} from '@contracts/index'
import {
  createNode,
  createSubscription,
  createTemplate,
  getNodeInstallScript,
  getSystemStatus,
  listNodeReleases,
  listNodeTraffic,
  listNodes,
  listSubscriptions,
  listTemplateCatalog,
  listTemplates,
  publishNode,
} from './lib/api'

const STORAGE_KEY = 'nodehubsapi_admin_key'

const numberFormatter = new Intl.NumberFormat('en-US')
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const adminKey = ref(localStorage.getItem(STORAGE_KEY) || 'dev-admin-key')
const loading = ref(false)
const notice = ref('')

const status = ref<SystemStatus | null>(null)
const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const templateCatalog = ref<TemplatePreset[]>([])
const subscriptions = ref<SubscriptionRecord[]>([])
const selectedNodeId = ref('')
const releases = ref<ReleaseRecord[]>([])
const traffic = ref<TrafficSample[]>([])
const installScript = ref('')
const publishTemplateIds = ref<string[]>([])
const presetId = ref('')

const nodeForm = reactive({
  name: '',
  nodeType: 'vps',
  region: '',
  primaryDomain: '',
  backupDomain: '',
  entryIp: '',
  installWarp: false,
  installArgo: false,
})

const templateForm = reactive({
  name: '',
  engine: 'sing-box',
  protocol: 'vless',
  transport: 'ws',
  tlsMode: 'tls',
  notes: '',
  defaultsJson: `{
  "serverPort": 443,
  "path": "/ws",
  "uuid": "00000000-0000-4000-8000-000000000001"
}`,
})

const subscriptionForm = reactive({
  name: '',
  enabled: true,
})

const selectedNode = computed(() => nodes.value.find((item) => item.id === selectedNodeId.value) || null)
const publishTemplates = computed(() => templates.value.filter((item) => publishTemplateIds.value.includes(item.id)))
const activeSubscriptionCount = computed(() => subscriptions.value.filter((item) => item.enabled).length)
const selectedTemplateSummary = computed(
  () => publishTemplates.value.map((item) => item.name).join(', ') || 'No templates selected',
)
const subscriptionLinks = computed(() => {
  const baseUrl = status.value?.publicBaseUrl || ''
  return subscriptions.value.map((item) => ({
    ...item,
    url: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/sub/${item.token}` : '',
  }))
})
const overviewMetrics = computed(() => {
  const summary = status.value?.summary
  const totalInbound = summary?.totalBytesIn ?? nodes.value.reduce((total, node) => total + node.bytesInTotal, 0)
  const totalOutbound = summary?.totalBytesOut ?? nodes.value.reduce((total, node) => total + node.bytesOutTotal, 0)

  return [
    {
      label: 'Managed nodes',
      value: formatNumber(summary?.nodeCount ?? nodes.value.length),
      note: `${formatNumber(summary?.onlineCount ?? 0)} online now`,
    },
    {
      label: 'Release artifacts',
      value: formatNumber(summary?.releaseCount ?? 0),
      note: `${formatNumber(templates.value.length)} templates available`,
    },
    {
      label: 'Inbound traffic',
      value: formatBytes(totalInbound),
      note: `Outbound ${formatBytes(totalOutbound)}`,
    },
    {
      label: 'Subscriptions',
      value: formatNumber(subscriptions.value.length),
      note: `${formatNumber(activeSubscriptionCount.value)} active feeds`,
    },
  ]
})
const stackFacts = computed(() => [
  {
    label: 'Storage mode',
    value: status.value?.mode || 'unknown',
    note: `Database ${status.value?.databaseDriver || 'n/a'}`,
  },
  {
    label: 'Artifacts',
    value: status.value?.artifactDriver || 'unknown',
    note: status.value?.publicBaseUrl ? 'Public delivery origin is configured' : 'Public base URL is missing',
  },
  {
    label: 'Snapshot time',
    value: formatDateTime(status.value?.now),
    note: status.value?.appVersion ? `App ${status.value.appVersion}` : 'Version unavailable',
  },
])
const selectedNodeHealth = computed(() => describeNodeHealth(selectedNode.value))
const selectedNodeFacts = computed(() => {
  if (!selectedNode.value) return []

  return [
    {
      label: 'Node type',
      value: selectedNode.value.nodeType.toUpperCase(),
      note: selectedNode.value.region || 'Region not set',
    },
    {
      label: 'Primary endpoint',
      value: selectedNode.value.primaryDomain || selectedNode.value.entryIp || 'Pending configuration',
      note: selectedNode.value.backupDomain || 'No backup domain configured',
    },
    {
      label: 'Last heartbeat',
      value: formatDateTime(selectedNode.value.lastSeenAt),
      note: selectedNodeHealth.value.detail,
    },
    {
      label: 'Runtime version',
      value: selectedNode.value.protocolRuntimeVersion || 'Unknown',
      note: `Connections ${formatNumber(selectedNode.value.currentConnections)}`,
    },
  ]
})
const selectedNodeMetrics = computed(() => {
  if (!selectedNode.value) return []

  return [
    {
      label: 'Current release',
      value: `r${selectedNode.value.currentReleaseRevision}`,
      note: selectedNode.value.currentReleaseStatus,
    },
    {
      label: 'Desired release',
      value: `r${selectedNode.value.desiredReleaseRevision}`,
      note:
        selectedNode.value.desiredReleaseRevision > selectedNode.value.currentReleaseRevision
          ? 'Rollout queued'
          : 'Runtime in sync',
    },
    {
      label: 'Inbound',
      value: formatBytes(selectedNode.value.bytesInTotal),
      note: `Connections ${formatNumber(selectedNode.value.currentConnections)}`,
    },
    {
      label: 'Outbound',
      value: formatBytes(selectedNode.value.bytesOutTotal),
      note: selectedNode.value.protocolRuntimeVersion || 'Runtime version pending',
    },
    {
      label: 'CPU load',
      value: formatPercent(selectedNode.value.cpuUsagePercent),
      note: `Memory ${formatPercent(selectedNode.value.memoryUsagePercent)}`,
    },
    {
      label: 'Last change',
      value: formatDateTime(selectedNode.value.updatedAt),
      note: `Created ${formatDateTime(selectedNode.value.createdAt)}`,
    },
  ]
})

function formatNumber(value: number | null | undefined): string {
  return numberFormatter.format(value ?? 0)
}

function formatBytes(value: number | null | undefined): string {
  let amount = value ?? 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  const decimals = amount >= 100 || unitIndex === 0 ? 0 : 1
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return 'n/a'
  return `${value.toFixed(1)}%`
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'No data'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid time'
  return dateTimeFormatter.format(date)
}

function formatClock(value: string | null | undefined): string {
  if (!value) return '--:--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return timeFormatter.format(date)
}

function isNodeOnline(node: NodeRecord): boolean {
  if (!node.lastSeenAt) return false
  const heartbeatAt = Date.parse(node.lastSeenAt)
  if (Number.isNaN(heartbeatAt)) return false
  return Date.now() - heartbeatAt < 5 * 60 * 1000
}

function describeNodeHealth(node: NodeRecord | null): {
  label: string
  tone: 'healthy' | 'warning' | 'critical' | 'neutral'
  detail: string
} {
  if (!node) {
    return {
      label: 'No node selected',
      tone: 'neutral',
      detail: 'Pick a node from the fleet rail to inspect releases and runtime state.',
    }
  }

  if (node.currentReleaseStatus === 'failed') {
    return {
      label: 'Release failed',
      tone: 'critical',
      detail: 'The latest rollout did not finish healthy and needs operator attention.',
    }
  }

  if (node.currentReleaseStatus === 'pending' || node.currentReleaseStatus === 'applying') {
    return {
      label: 'Update in progress',
      tone: 'warning',
      detail: 'A publish action is currently moving through the node pipeline.',
    }
  }

  if (node.desiredReleaseRevision > node.currentReleaseRevision) {
    return {
      label: 'Update pending',
      tone: 'warning',
      detail: 'Desired release revision is newer than the runtime that is currently applied.',
    }
  }

  if (isNodeOnline(node) && node.currentReleaseStatus === 'healthy') {
    return {
      label: 'Healthy',
      tone: 'healthy',
      detail: 'Telemetry is fresh and the applied release matches the desired runtime.',
    }
  }

  if (isNodeOnline(node)) {
    return {
      label: 'Heartbeat live',
      tone: 'warning',
      detail: 'The node is reachable, but runtime health has not settled into a healthy state yet.',
    }
  }

  return {
    label: 'Heartbeat stale',
    tone: 'neutral',
    detail: 'No fresh telemetry was received during the recent heartbeat window.',
  }
}

function ensureTemplateSelection(): void {
  const validIds = new Set(templates.value.map((item) => item.id))
  publishTemplateIds.value = publishTemplateIds.value.filter((id) => validIds.has(id))
  if (publishTemplateIds.value.length === 0) {
    publishTemplateIds.value = templates.value.slice(0, 2).map((item) => item.id)
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  notice.value = ''
  try {
    await action()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Request failed'
  }
}

async function loadDashboard(): Promise<void> {
  loading.value = true
  notice.value = ''
  localStorage.setItem(STORAGE_KEY, adminKey.value)

  try {
    const [statusData, nodeRows, templateRows, subscriptionRows, catalogRows] = await Promise.all([
      getSystemStatus(adminKey.value),
      listNodes(adminKey.value),
      listTemplates(adminKey.value),
      listSubscriptions(adminKey.value),
      listTemplateCatalog(adminKey.value),
    ])

    status.value = statusData
    nodes.value = nodeRows
    templates.value = templateRows
    subscriptions.value = subscriptionRows
    templateCatalog.value = catalogRows
    ensureTemplateSelection()

    if (!selectedNodeId.value && nodeRows.length > 0) {
      selectedNodeId.value = nodeRows[0].id
    }

    if (selectedNodeId.value) {
      await inspectNode(selectedNodeId.value)
    } else {
      releases.value = []
      traffic.value = []
      installScript.value = ''
    }
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Failed to load dashboard'
  } finally {
    loading.value = false
  }
}

async function inspectNode(nodeId: string): Promise<void> {
  selectedNodeId.value = nodeId
  installScript.value = ''
  const [releaseRows, trafficRows] = await Promise.all([
    listNodeReleases(adminKey.value, nodeId),
    listNodeTraffic(adminKey.value, nodeId),
  ])
  releases.value = releaseRows
  traffic.value = trafficRows
}

function applyPreset(): void {
  const preset = templateCatalog.value.find((item) => item.id === presetId.value)
  if (!preset) return
  Object.assign(templateForm, {
    name: preset.name,
    engine: preset.engine,
    protocol: preset.protocol,
    transport: preset.transport,
    tlsMode: preset.tlsMode,
    notes: preset.notes,
    defaultsJson: JSON.stringify(preset.defaults, null, 2),
  })
}

async function submitNode(): Promise<void> {
  await runAction(async () => {
    await createNode(adminKey.value, nodeForm)
    Object.assign(nodeForm, {
      name: '',
      nodeType: 'vps',
      region: '',
      primaryDomain: '',
      backupDomain: '',
      entryIp: '',
      installWarp: false,
      installArgo: false,
    })
    await loadDashboard()
  })
}

async function submitTemplate(): Promise<void> {
  await runAction(async () => {
    let defaults = {}
    try {
      defaults = JSON.parse(templateForm.defaultsJson)
    } catch {
      throw new Error('Template defaults must be valid JSON')
    }

    await createTemplate(adminKey.value, {
      name: templateForm.name,
      engine: templateForm.engine,
      protocol: templateForm.protocol,
      transport: templateForm.transport,
      tlsMode: templateForm.tlsMode,
      notes: templateForm.notes,
      defaults,
    })

    Object.assign(templateForm, {
      name: '',
      engine: 'sing-box',
      protocol: 'vless',
      transport: 'ws',
      tlsMode: 'tls',
      notes: '',
      defaultsJson: `{
  "serverPort": 443,
  "path": "/ws",
  "uuid": "00000000-0000-4000-8000-000000000001"
}`,
    })
    presetId.value = ''
    await loadDashboard()
  })
}

async function submitSubscription(): Promise<void> {
  await runAction(async () => {
    await createSubscription(adminKey.value, {
      ...subscriptionForm,
      visibleNodeIds: selectedNode.value ? [selectedNode.value.id] : [],
    })
    Object.assign(subscriptionForm, {
      name: '',
      enabled: true,
    })
    await loadDashboard()
  })
}

function togglePublishTemplate(templateId: string, enabled: boolean): void {
  if (enabled) {
    publishTemplateIds.value = Array.from(new Set([...publishTemplateIds.value, templateId]))
    return
  }
  publishTemplateIds.value = publishTemplateIds.value.filter((id) => id !== templateId)
}

function handlePublishCheckbox(event: Event, templateId: string): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  togglePublishTemplate(templateId, target.checked)
}

async function publishSelected(kind: 'runtime' | 'bootstrap'): Promise<void> {
  if (!selectedNode.value) return
  const nodeId = selectedNode.value.id
  await runAction(async () => {
    await publishNode(adminKey.value, nodeId, {
      kind,
      templateIds: publishTemplateIds.value,
      message: `dashboard publish ${kind}`,
    })
    await inspectNode(nodeId)
    await loadDashboard()
  })
}

async function loadInstallScript(): Promise<void> {
  if (!selectedNode.value) return
  const nodeId = selectedNode.value.id
  await runAction(async () => {
    installScript.value = await getNodeInstallScript(adminKey.value, nodeId)
  })
}

onMounted(() => {
  void loadDashboard()
})
</script>

<template>
  <div class="app-shell">
    <header class="panel topbar">
      <div class="brand-block">
        <p class="eyebrow">newnodeshub</p>
        <h1>Deployment control center</h1>
        <p class="lead">
          Operate edge and single-VPS nodes from one workspace. Releases, bootstrap scripts, protocol templates,
          and public subscriptions stay visible in the same control surface.
        </p>

        <div class="topbar-facts">
          <div class="fact-chip">
            <strong>Mode</strong>
            <span>{{ status?.mode || 'unknown' }}</span>
          </div>
          <div class="fact-chip">
            <strong>Database</strong>
            <span>{{ status?.databaseDriver || 'n/a' }}</span>
          </div>
          <div class="fact-chip">
            <strong>Artifacts</strong>
            <span>{{ status?.artifactDriver || 'n/a' }}</span>
          </div>
        </div>
      </div>

      <div class="topbar-side">
        <div class="access-panel">
          <div>
            <p class="section-label">Access control</p>
            <h2>Admin session</h2>
            <p class="panel-copy">
              Refresh the full snapshot after every structural change to keep node telemetry and release state in
              sync.
            </p>
          </div>

          <label class="field">
            <span>Admin key</span>
            <input v-model="adminKey" type="password" placeholder="Enter admin key" />
          </label>

          <button class="primary-button primary-button--block" :disabled="loading" @click="loadDashboard()">
            {{ loading ? 'Refreshing snapshot...' : 'Refresh dashboard snapshot' }}
          </button>
        </div>

        <div class="topbar-note">
          <p class="section-label">Delivery origin</p>
          <strong>{{ status?.publicBaseUrl || 'Public base URL not configured' }}</strong>
          <span>Subscriptions are built from this public endpoint.</span>
        </div>
      </div>
    </header>

    <p v-if="notice" class="notice-banner">{{ notice }}</p>

    <main class="dashboard">
      <section class="overview-grid">
        <article class="panel hero-card">
          <div class="panel-header">
            <div>
              <p class="section-label">Operations overview</p>
              <h2>Fleet status at a glance</h2>
              <p class="panel-copy">
                This view prioritizes node coverage, release volume, traffic footprint, and subscription exposure so
                operators can decide where to act first.
              </p>
            </div>
            <span class="status-pill" :class="`status-pill--${status?.summary.onlineCount ? 'healthy' : 'neutral'}`">
              {{ status?.summary.onlineCount ? 'Nodes online' : 'Awaiting heartbeat' }}
            </span>
          </div>

          <div class="metric-tile-grid">
            <article v-for="metric in overviewMetrics" :key="metric.label" class="metric-tile">
              <span>{{ metric.label }}</span>
              <strong>{{ metric.value }}</strong>
              <small>{{ metric.note }}</small>
            </article>
          </div>

          <div class="hero-footer">
            <div class="hero-footer-item">
              <span>Selected node</span>
              <strong>{{ selectedNode?.name || 'No node selected' }}</strong>
            </div>
            <div class="hero-footer-item">
              <span>Template publish set</span>
              <strong>{{ selectedTemplateSummary }}</strong>
            </div>
            <div class="hero-footer-item">
              <span>Snapshot captured</span>
              <strong>{{ formatDateTime(status?.now) }}</strong>
            </div>
          </div>
        </article>

        <article class="panel system-panel">
          <div class="panel-header">
            <div>
              <p class="section-label">Platform details</p>
              <h2>Delivery stack</h2>
            </div>
          </div>

          <ul class="facts-list">
            <li v-for="fact in stackFacts" :key="fact.label">
              <span>{{ fact.label }}</span>
              <strong>{{ fact.value }}</strong>
              <small>{{ fact.note }}</small>
            </li>
          </ul>
        </article>

        <article class="panel focus-panel">
          <div class="panel-header">
            <div>
              <p class="section-label">Active focus</p>
              <h2>{{ selectedNode?.name || 'Pick a node' }}</h2>
              <p class="panel-copy">{{ selectedNodeHealth.detail }}</p>
            </div>
            <span class="status-pill" :class="`status-pill--${selectedNodeHealth.tone}`">
              {{ selectedNodeHealth.label }}
            </span>
          </div>

          <ul v-if="selectedNodeFacts.length" class="facts-list">
            <li v-for="fact in selectedNodeFacts" :key="fact.label">
              <span>{{ fact.label }}</span>
              <strong>{{ fact.value }}</strong>
              <small>{{ fact.note }}</small>
            </li>
          </ul>

          <div v-else class="empty-state empty-state--inline">
            <strong>Node workspace is empty</strong>
            <span>Create a node or select an existing one to unlock publish and telemetry tools.</span>
          </div>
        </article>
      </section>

      <section class="workspace-grid">
        <div class="composer-column">
          <article class="panel form-panel">
            <div class="panel-header">
              <div>
                <p class="section-label">Provisioning</p>
                <h2>Create node</h2>
                <p class="panel-copy">Register a new edge or VPS endpoint before releases can be published.</p>
              </div>
              <span class="status-pill status-pill--neutral">Fleet</span>
            </div>

            <div class="form-grid">
              <input v-model="nodeForm.name" placeholder="Node name" />
              <select v-model="nodeForm.nodeType">
                <option value="vps">VPS</option>
                <option value="edge">Edge</option>
              </select>
              <input v-model="nodeForm.region" placeholder="Region" />
              <input v-model="nodeForm.primaryDomain" placeholder="Primary domain" />
              <input v-model="nodeForm.backupDomain" placeholder="Backup domain" />
              <input v-model="nodeForm.entryIp" placeholder="Entry IP" />
            </div>

            <div class="toggle-grid">
              <label class="toggle-card">
                <input v-model="nodeForm.installWarp" type="checkbox" />
                <span>Install WARP hooks</span>
              </label>
              <label class="toggle-card">
                <input v-model="nodeForm.installArgo" type="checkbox" />
                <span>Install Argo hooks</span>
              </label>
            </div>

            <button class="secondary-button secondary-button--block" @click="submitNode()">Save node</button>
          </article>

          <article class="panel form-panel">
            <div class="panel-header">
              <div>
                <p class="section-label">Protocol library</p>
                <h2>Create template</h2>
                <p class="panel-copy">
                  Start from a preset when possible, then refine transport, TLS mode, and runtime defaults.
                </p>
              </div>
              <span class="status-pill status-pill--neutral">Catalog</span>
            </div>

            <div class="form-grid">
              <select v-model="presetId" @change="applyPreset()">
                <option value="">Preset catalog</option>
                <option v-for="preset in templateCatalog" :key="preset.id" :value="preset.id">
                  {{ preset.name }}
                </option>
              </select>
              <input v-model="templateForm.name" placeholder="Template name" />
              <select v-model="templateForm.engine">
                <option value="sing-box">sing-box</option>
                <option value="xray">xray</option>
              </select>
              <input v-model="templateForm.protocol" placeholder="Protocol" />
              <input v-model="templateForm.transport" placeholder="Transport" />
              <select v-model="templateForm.tlsMode">
                <option value="none">none</option>
                <option value="tls">tls</option>
                <option value="reality">reality</option>
              </select>
              <input v-model="templateForm.notes" placeholder="Notes" />
            </div>

            <label class="field field--block">
              <span>Template defaults JSON</span>
              <textarea v-model="templateForm.defaultsJson" rows="8" class="code-area" />
            </label>

            <button class="secondary-button secondary-button--block" @click="submitTemplate()">Save template</button>
          </article>

          <article class="panel form-panel">
            <div class="panel-header">
              <div>
                <p class="section-label">Distribution</p>
                <h2>Create subscription</h2>
                <p class="panel-copy">
                  The subscription is generated against the currently selected node and only serves healthy state.
                </p>
              </div>
              <span class="status-pill status-pill--neutral">Public feed</span>
            </div>

            <div class="form-grid form-grid--single">
              <input v-model="subscriptionForm.name" placeholder="Subscription name" />
            </div>

            <label class="toggle-card">
              <input v-model="subscriptionForm.enabled" type="checkbox" />
              <span>Enabled</span>
            </label>

            <button class="secondary-button secondary-button--block" @click="submitSubscription()">
              Save subscription
            </button>
          </article>
        </div>

        <article class="panel node-workbench">
          <div class="panel-header">
            <div>
              <p class="section-label">Node workbench</p>
              <h2>Release and telemetry workspace</h2>
              <p class="panel-copy">
                Select a fleet member to compare applied revisions, push new releases, and inspect telemetry samples.
              </p>
            </div>

            <div class="action-row">
              <button class="secondary-button" :disabled="!selectedNode" @click="publishSelected('runtime')">
                Publish runtime
              </button>
              <button class="secondary-button" :disabled="!selectedNode" @click="publishSelected('bootstrap')">
                Publish bootstrap
              </button>
              <button class="secondary-button" :disabled="!selectedNode" @click="loadInstallScript()">
                Load install script
              </button>
            </div>
          </div>

          <div class="workbench-grid">
            <aside class="node-rail">
              <div>
                <p class="section-label">Fleet rail</p>
                <h3>{{ nodes.length ? 'Available nodes' : 'No nodes yet' }}</h3>
              </div>

              <div v-if="nodes.length" class="node-list">
                <button
                  v-for="node in nodes"
                  :key="node.id"
                  class="node-card"
                  :class="{ 'is-active': node.id === selectedNodeId }"
                  @click="inspectNode(node.id)"
                >
                  <div class="node-card__head">
                    <div>
                      <strong>{{ node.name }}</strong>
                      <p>{{ node.primaryDomain || node.entryIp || 'Endpoint pending' }}</p>
                    </div>
                    <span class="status-pill" :class="`status-pill--${describeNodeHealth(node).tone}`">
                      {{ describeNodeHealth(node).label }}
                    </span>
                  </div>

                  <div class="node-card__meta">
                    <span class="meta-chip">{{ node.nodeType }}</span>
                    <span class="meta-chip">{{ node.region || 'unassigned' }}</span>
                    <span class="meta-chip">cfg r{{ node.configRevision }}</span>
                    <span class="meta-chip">boot r{{ node.bootstrapRevision }}</span>
                  </div>
                </button>
              </div>

              <div v-else class="empty-state empty-state--inline">
                <strong>No nodes registered</strong>
                <span>Create the first node from the provisioning column to activate this workspace.</span>
              </div>
            </aside>

            <div v-if="selectedNode" class="node-stage">
              <div class="node-stage-header">
                <div>
                  <div class="title-row">
                    <h3>{{ selectedNode.name }}</h3>
                    <span class="status-pill" :class="`status-pill--${selectedNodeHealth.tone}`">
                      {{ selectedNodeHealth.label }}
                    </span>
                  </div>
                  <p class="panel-copy">
                    {{ selectedNode.primaryDomain || selectedNode.entryIp || 'Endpoint pending configuration' }}
                  </p>
                </div>
                <div class="node-stage-note">
                  <span>Last heartbeat</span>
                  <strong>{{ formatDateTime(selectedNode.lastSeenAt) }}</strong>
                </div>
              </div>

              <div class="node-metric-grid">
                <article v-for="metric in selectedNodeMetrics" :key="metric.label" class="mini-metric">
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value }}</strong>
                  <small>{{ metric.note }}</small>
                </article>
              </div>

              <section class="selection-panel">
                <div class="panel-header panel-header--compact">
                  <div>
                    <p class="section-label">Release scope</p>
                    <h3>Publish templates</h3>
                  </div>
                </div>

                <div class="tag-grid">
                  <label v-for="template in templates" :key="template.id" class="tag-check">
                    <input
                      :checked="publishTemplateIds.includes(template.id)"
                      type="checkbox"
                      @change="handlePublishCheckbox($event, template.id)"
                    />
                    <span>{{ template.name }}</span>
                  </label>
                </div>

                <span class="helper-copy">Selected templates: {{ selectedTemplateSummary }}</span>
              </section>

              <div class="timeline-grid">
                <section class="list-panel">
                  <div class="panel-header panel-header--compact">
                    <div>
                      <p class="section-label">Recent releases</p>
                      <h3>Artifact history</h3>
                    </div>
                  </div>

                  <ul v-if="releases.length" class="stack-list">
                    <li v-for="release in releases" :key="release.id">
                      <div class="list-row-head">
                        <strong>r{{ release.revision }}</strong>
                        <span
                          class="status-pill"
                          :class="`status-pill--${release.status === 'healthy' ? 'healthy' : release.status === 'failed' ? 'critical' : 'warning'}`"
                        >
                          {{ release.kind }} / {{ release.status }}
                        </span>
                      </div>
                      <p>{{ release.summary }}</p>
                      <small>{{ formatDateTime(release.createdAt) }}</small>
                    </li>
                  </ul>

                  <div v-else class="empty-state empty-state--inline">
                    <strong>No releases yet</strong>
                    <span>Publish runtime or bootstrap artifacts to start the release timeline.</span>
                  </div>
                </section>

                <section class="list-panel">
                  <div class="panel-header panel-header--compact">
                    <div>
                      <p class="section-label">Telemetry</p>
                      <h3>Recent samples</h3>
                    </div>
                  </div>

                  <ul v-if="traffic.length" class="stack-list">
                    <li v-for="sample in traffic" :key="sample.at">
                      <div class="list-row-head">
                        <strong>{{ formatClock(sample.at) }}</strong>
                        <span class="meta-chip">conn {{ formatNumber(sample.currentConnections) }}</span>
                      </div>
                      <p>Inbound {{ formatBytes(sample.bytesInTotal) }} / Outbound {{ formatBytes(sample.bytesOutTotal) }}</p>
                      <small>CPU {{ formatPercent(sample.cpuUsagePercent) }} / Memory {{ formatPercent(sample.memoryUsagePercent) }}</small>
                    </li>
                  </ul>

                  <div v-else class="empty-state empty-state--inline">
                    <strong>No telemetry samples</strong>
                    <span>Heartbeat and traffic data will appear here after the node reports in.</span>
                  </div>
                </section>
              </div>

              <label v-if="installScript" class="field field--block">
                <span>Install script preview</span>
                <textarea :value="installScript" rows="16" readonly class="code-area" />
              </label>
            </div>

            <div v-else class="empty-state empty-state--large">
              <strong>Select a node to continue</strong>
              <span>The workbench shows release history, live telemetry, and install artifacts for the active node.</span>
            </div>
          </div>
        </article>
      </section>

      <section class="resource-grid">
        <article class="panel resource-panel">
          <div class="panel-header">
            <div>
              <p class="section-label">Template library</p>
              <h2>Available protocol presets</h2>
            </div>
            <span class="status-pill status-pill--neutral">{{ templates.length }} templates</span>
          </div>

          <ul v-if="templates.length" class="resource-list">
            <li v-for="template in templates" :key="template.id" class="resource-item">
              <div class="resource-item__head">
                <div>
                  <strong>{{ template.name }}</strong>
                  <p>{{ template.notes || 'No operator notes attached.' }}</p>
                </div>
                <span class="status-pill status-pill--neutral">{{ template.engine }}</span>
              </div>
              <div class="resource-meta">
                <span>{{ template.protocol }}/{{ template.transport }}/{{ template.tlsMode }}</span>
                <span>Updated {{ formatDateTime(template.updatedAt) }}</span>
              </div>
            </li>
          </ul>

          <div v-else class="empty-state empty-state--inline">
            <strong>No templates created</strong>
            <span>Save the first protocol template to enable publish actions for selected nodes.</span>
          </div>
        </article>

        <article class="panel resource-panel">
          <div class="panel-header">
            <div>
              <p class="section-label">Subscriptions</p>
              <h2>Public feed endpoints</h2>
            </div>
            <span class="status-pill status-pill--neutral">{{ subscriptions.length }} feeds</span>
          </div>

          <ul v-if="subscriptionLinks.length" class="resource-list">
            <li v-for="subscription in subscriptionLinks" :key="subscription.id" class="resource-item">
              <div class="resource-item__head">
                <div>
                  <strong>{{ subscription.name }}</strong>
                  <p>{{ subscription.enabled ? 'Enabled for delivery' : 'Disabled from public delivery' }}</p>
                </div>
                <span class="status-pill" :class="`status-pill--${subscription.enabled ? 'healthy' : 'neutral'}`">
                  {{ subscription.enabled ? 'enabled' : 'disabled' }}
                </span>
              </div>
              <div class="resource-meta">
                <span>{{ subscription.visibleNodeIds.length }} visible nodes</span>
                <span>Updated {{ formatDateTime(subscription.updatedAt) }}</span>
              </div>
              <p class="resource-url">{{ subscription.url || 'Public base URL not configured' }}</p>
            </li>
          </ul>

          <div v-else class="empty-state empty-state--inline">
            <strong>No subscriptions created</strong>
            <span>Create a subscription to generate a public endpoint from healthy node state.</span>
          </div>
        </article>
      </section>
    </main>
  </div>
</template>
