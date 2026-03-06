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
const subscriptionLinks = computed(() => {
  const baseUrl = status.value?.publicBaseUrl || ''
  return subscriptions.value.map((item) => ({
    ...item,
    url: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/sub/${item.token}` : '',
  }))
})

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
  <div class="page-shell">
    <aside class="hero-panel">
      <p class="eyebrow">nodehubsapi</p>
      <h1>Dual deploy control plane</h1>
      <p class="hero-copy">
        Fresh control plane for Cloudflare and single-VPS Docker. Runtime updates and bootstrap updates are
        separated, releases generate real artifacts, and public subscriptions only read healthy current state.
      </p>

      <label class="field">
        <span>Admin Key</span>
        <input v-model="adminKey" type="password" placeholder="Enter admin key" />
      </label>

      <button class="primary-button" :disabled="loading" @click="loadDashboard()">
        {{ loading ? 'Loading...' : 'Refresh dashboard' }}
      </button>

      <p v-if="notice" class="notice">{{ notice }}</p>
    </aside>

    <main class="content-grid">
      <section class="card status-card">
        <div class="card-head">
          <h2>System status</h2>
          <span class="pill">{{ status?.mode || 'unknown' }}</span>
        </div>
        <div class="metric-grid">
          <div>
            <span class="metric-label">Nodes</span>
            <strong>{{ status?.summary.nodeCount ?? 0 }}</strong>
          </div>
          <div>
            <span class="metric-label">Online</span>
            <strong>{{ status?.summary.onlineCount ?? 0 }}</strong>
          </div>
          <div>
            <span class="metric-label">Templates</span>
            <strong>{{ status?.summary.templateCount ?? 0 }}</strong>
          </div>
          <div>
            <span class="metric-label">Releases</span>
            <strong>{{ status?.summary.releaseCount ?? 0 }}</strong>
          </div>
        </div>
      </section>

      <section class="card form-card">
        <div class="card-head">
          <h2>Create node</h2>
          <span class="pill">VPS or edge</span>
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
          <label class="toggle"><input v-model="nodeForm.installWarp" type="checkbox" />Install WARP hooks</label>
          <label class="toggle"><input v-model="nodeForm.installArgo" type="checkbox" />Install Argo hooks</label>
        </div>
        <button class="secondary-button" @click="submitNode()">Save node</button>
      </section>

      <section class="card form-card">
        <div class="card-head">
          <h2>Create template</h2>
          <span class="pill">Protocol template</span>
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
        <label class="field">
          <span>Template defaults JSON</span>
          <textarea v-model="templateForm.defaultsJson" rows="8" class="code-area" />
        </label>
        <button class="secondary-button" @click="submitTemplate()">Save template</button>
      </section>

      <section class="card form-card">
        <div class="card-head">
          <h2>Create subscription</h2>
          <span class="pill">Healthy only</span>
        </div>
        <div class="form-grid">
          <input v-model="subscriptionForm.name" placeholder="Subscription name" />
          <label class="toggle"><input v-model="subscriptionForm.enabled" type="checkbox" />Enabled</label>
        </div>
        <button class="secondary-button" @click="submitSubscription()">Save subscription</button>
      </section>

      <section class="card list-card">
        <div class="card-head">
          <h2>Nodes</h2>
          <span class="pill">{{ nodes.length }}</span>
        </div>
        <div class="list-rows">
          <button
            v-for="node in nodes"
            :key="node.id"
            class="list-row"
            :class="{ active: node.id === selectedNodeId }"
            @click="inspectNode(node.id)"
          >
            <div>
              <strong>{{ node.name }}</strong>
              <span>{{ node.nodeType }} | {{ node.region || 'unassigned' }}</span>
            </div>
            <div class="row-metrics">
              <span>cfg r{{ node.configRevision }}</span>
              <span>boot r{{ node.bootstrapRevision }}</span>
            </div>
          </button>
        </div>
      </section>

      <section class="card detail-card">
        <div class="card-head">
          <h2>Node detail</h2>
          <div class="action-group">
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

        <template v-if="selectedNode">
          <div class="detail-grid">
            <div>
              <span class="metric-label">Current release</span>
              <strong>r{{ selectedNode.currentReleaseRevision }}</strong>
            </div>
            <div>
              <span class="metric-label">Desired release</span>
              <strong>r{{ selectedNode.desiredReleaseRevision }}</strong>
            </div>
            <div>
              <span class="metric-label">Bytes in</span>
              <strong>{{ selectedNode.bytesInTotal }}</strong>
            </div>
            <div>
              <span class="metric-label">Bytes out</span>
              <strong>{{ selectedNode.bytesOutTotal }}</strong>
            </div>
          </div>

          <div class="field">
            <span>Publish templates</span>
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
            <span class="helper-copy">
              Selected templates: {{ publishTemplates.map((item) => item.name).join(', ') || 'none' }}
            </span>
          </div>

          <div class="split-grid">
            <div>
              <h3>Recent releases</h3>
              <ul class="compact-list">
                <li v-for="release in releases" :key="release.id">
                  <strong>r{{ release.revision }}</strong>
                  <span>{{ release.kind }} | {{ release.status }}</span>
                  <span>{{ release.summary }}</span>
                </li>
              </ul>
            </div>
            <div>
              <h3>Recent telemetry</h3>
              <ul class="compact-list">
                <li v-for="sample in traffic" :key="sample.at">
                  <strong>{{ sample.at.slice(11, 19) }}</strong>
                  <span>in {{ sample.bytesInTotal }} | out {{ sample.bytesOutTotal }}</span>
                  <span>conn {{ sample.currentConnections }} | mem {{ sample.memoryUsagePercent ?? 'n/a' }}</span>
                </li>
              </ul>
            </div>
          </div>

          <label v-if="installScript" class="field top-gap">
            <span>Install script preview</span>
            <textarea :value="installScript" rows="16" readonly class="code-area" />
          </label>
        </template>

        <p v-else class="empty-state">Create a node first, then inspect it here.</p>
      </section>

      <section class="card list-card">
        <div class="card-head">
          <h2>Templates</h2>
          <span class="pill">{{ templates.length }}</span>
        </div>
        <ul class="compact-list">
          <li v-for="template in templates" :key="template.id">
            <strong>{{ template.name }}</strong>
            <span>{{ template.engine }} | {{ template.protocol }}/{{ template.transport }}/{{ template.tlsMode }}</span>
          </li>
        </ul>
      </section>

      <section class="card list-card">
        <div class="card-head">
          <h2>Subscriptions</h2>
          <span class="pill">{{ subscriptions.length }}</span>
        </div>
        <ul class="compact-list">
          <li v-for="subscription in subscriptionLinks" :key="subscription.id">
            <strong>{{ subscription.name }}</strong>
            <span>{{ subscription.enabled ? 'enabled' : 'disabled' }}</span>
            <span>{{ subscription.url || 'public base URL not configured' }}</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
