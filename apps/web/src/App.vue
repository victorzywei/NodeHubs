<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import {
  DEFAULT_WARP_LOCAL_PROXY_PORT,
  isNodeOnline,
  type SystemStatus,
  type NodeRecord,
  type TemplateRecord,
  type SubscriptionRecord,
  type ReleaseLogRecord,
  type ReleaseRecord,
  type ReleasePreviewRecord,
} from '@contracts/index'
import QRCode from 'qrcode'
import nodehubIcon from './nodehub.png'
import * as api from './lib/api'
import {
  PanelApiError,
  getPanelSession,
  isLocalPanelMode,
  listBackendProfiles,
  loginToPanel,
  logoutFromPanel,
  saveBackendProfiles as savePanelBackendProfiles,
} from './lib/panel-api'
import {
  BACKEND_PROFILES_STORAGE_KEY,
  CURRENT_BACKEND_STORAGE_KEY,
  LEGACY_ADMIN_KEY_STORAGE_KEY,
  createBackendProfileId,
  normalizeBackendApiBase,
  sanitizeBackendProfiles,
  type BackendProfile,
} from './shared/backend-profiles'

type UiTheme = 'midnight' | 'legacy'

interface BackendDraft {
  name: string
  apiBaseUrl: string
  adminKey: string
}

const THEME_STORAGE_KEY = 'nh_ui_theme'
function resolveDefaultBackendApiBase() {
  const envApiBaseUrl = normalizeBackendApiBase(import.meta.env.VITE_API_BASE || '')
  if (envApiBaseUrl) return envApiBaseUrl
  if (typeof window !== 'undefined' && window.location.origin) {
    return normalizeBackendApiBase(window.location.origin)
  }
  return ''
}

function createDefaultBackendProfile(): BackendProfile | null {
  const apiBaseUrl = resolveDefaultBackendApiBase()
  const legacyAdminKey = localStorage.getItem(LEGACY_ADMIN_KEY_STORAGE_KEY) || ''
  if (!apiBaseUrl && !legacyAdminKey) return null

  return {
    id: createBackendProfileId(),
    name: import.meta.env.VITE_API_BASE ? '默认后端' : '当前站点',
    apiBaseUrl,
    adminKey: legacyAdminKey,
  }
}

function loadLegacyBackendProfiles(): BackendProfile[] {
  try {
    const raw = localStorage.getItem(BACKEND_PROFILES_STORAGE_KEY)
    if (raw) {
      const profiles = sanitizeBackendProfiles(JSON.parse(raw))
      if (profiles.length > 0) {
        return profiles
      }
    }
  } catch {
    // Ignore broken local storage payloads during one-time migration.
  }

  const fallback = createDefaultBackendProfile()
  return fallback ? [fallback] : []
}

function clearLegacyBackendStorage(removeProfiles = true) {
  if (removeProfiles) {
    localStorage.removeItem(BACKEND_PROFILES_STORAGE_KEY)
  }
  localStorage.removeItem(LEGACY_ADMIN_KEY_STORAGE_KEY)
}

function resolveInitialBackendId(profiles: BackendProfile[], preferredId = ''): string {
  const stored = preferredId || localStorage.getItem(CURRENT_BACKEND_STORAGE_KEY) || ''
  if (profiles.some((profile) => profile.id === stored)) {
    return stored
  }
  return profiles[0]?.id || ''
}

function createEmptyBackendDraft(profile?: Partial<BackendProfile>): BackendDraft {
  return {
    name: profile?.name || '',
    apiBaseUrl: profile?.apiBaseUrl || '',
    adminKey: profile?.adminKey || '',
  }
}

function getBackendBaseLabel(profile: BackendProfile | null): string {
  if (!profile) return '未配置后端'
  return profile.apiBaseUrl || '同源站点'
}

function getBackendOptionLabel(profile: BackendProfile): string {
  return profile.name + ' - ' + getBackendBaseLabel(profile)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? (error.message || fallback) : fallback
}
// ---- State ----
const backendProfiles = ref<BackendProfile[]>([])
const currentBackendId = ref(localStorage.getItem(CURRENT_BACKEND_STORAGE_KEY) || '')
const currentBackend = computed(() => backendProfiles.value.find((profile) => profile.id === currentBackendId.value) || backendProfiles.value[0] || null)
const adminKey = ref('')
const loggedIn = ref(false)
const currentPage = ref<'dashboard'|'nodes'|'templates'|'subscriptions'>('dashboard')
const loading = ref(false)
const error = ref('')
const panelReady = ref(false)
const panelAuthenticated = ref(false)
const panelLoading = ref(false)
const panelError = ref('')
const panelPassword = ref('')
const backendProfilesLoading = ref(false)
const uiTheme = ref<UiTheme>((localStorage.getItem(THEME_STORAGE_KEY) as UiTheme) || 'midnight')
const showBackendModal = ref(false)
const editingBackendId = ref('')
const backendDraft = ref<BackendDraft>(createEmptyBackendDraft())

api.setApiBase('')

// Data
const status = ref<SystemStatus|null>(null)
const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const subscriptions = ref<SubscriptionRecord[]>([])

// Modals
const showCreateNode = ref(false)
const showCreateTemplate = ref(false)
const showCreateSub = ref(false)
const showSubscriptionQr = ref(false)
const showPublishRelease = ref(false)
const showReleaseLog = ref(false)
const selectedNode = ref<NodeRecord|null>(null)
const nodeReleases = ref<ReleaseRecord[]>([])
const selectedReleaseLog = ref<ReleaseLogRecord|null>(null)
const selectedReleaseLogNode = ref<NodeRecord|null>(null)
const releaseLogLoading = ref(false)
const deployCommand = ref('')
const uninstallCommand = ref('')
const publishNode = ref<NodeRecord|null>(null)
const publishTemplateIds = ref<string[]>([])
const publishMessage = ref('')
const publishingRelease = ref(false)
const publishPreview = ref<ReleasePreviewRecord|null>(null)
const publishPreviewLoading = ref(false)
const publishPreviewError = ref('')
const editingSubscriptionId = ref('')
const subscriptionQrTitle = ref('')
const subscriptionQrUrl = ref('')
const subscriptionQrDataUrl = ref('')
const subscriptionQrLoading = ref(false)
let publishPreviewRequestId = 0

// Toast
const toasts = ref<{id:number,type:string,msg:string}[]>([])
let toastId = 0
function toast(type:string, msg:string) {
  const id = ++toastId
  toasts.value.push({id,type,msg})
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 4000)
}

function applyTheme(theme: UiTheme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

function setUiTheme(theme: UiTheme) {
  uiTheme.value = theme
}

function setBackendProfiles(nextProfiles: BackendProfile[], preferredId = currentBackendId.value) {
  backendProfiles.value = nextProfiles
  const nextBackendId = resolveInitialBackendId(nextProfiles, preferredId)
  persistCurrentBackendId(nextBackendId)
  syncCurrentBackendApiBase()
  adminKey.value = currentBackend.value?.adminKey || ''
  if (!showBackendModal.value) {
    backendDraft.value = createEmptyBackendDraft(currentBackend.value || undefined)
  }
}

async function persistBackendProfiles(nextProfiles: BackendProfile[], preferredId = currentBackendId.value) {
  const result = await savePanelBackendProfiles(nextProfiles)
  setBackendProfiles(result.profiles, preferredId)
  clearLegacyBackendStorage(!isLocalPanelMode())
  return result.profiles
}

function persistCurrentBackendId(nextBackendId: string) {
  currentBackendId.value = nextBackendId
  if (nextBackendId) {
    localStorage.setItem(CURRENT_BACKEND_STORAGE_KEY, nextBackendId)
    return
  }
  localStorage.removeItem(CURRENT_BACKEND_STORAGE_KEY)
}

function syncCurrentBackendApiBase() {
  api.setApiBase(currentBackend.value?.apiBaseUrl || '')
}

async function updateCurrentBackendAdminKey(nextAdminKey: string) {
  const activeBackend = currentBackend.value
  if (!activeBackend) return
  await persistBackendProfiles(backendProfiles.value.map((profile) => (
    profile.id === activeBackend.id
      ? { ...profile, adminKey: nextAdminKey }
      : profile
  )), activeBackend.id)
}

async function loadPanelBackendProfiles() {
  backendProfilesLoading.value = true
  try {
    const result = await listBackendProfiles()
    let nextProfiles = result.profiles

    if (nextProfiles.length === 0) {
      const legacyProfiles = loadLegacyBackendProfiles()
      if (legacyProfiles.length > 0) {
        const seeded = await savePanelBackendProfiles(legacyProfiles)
        nextProfiles = seeded.profiles
        clearLegacyBackendStorage(!isLocalPanelMode())
      }
    }

    setBackendProfiles(nextProfiles)
    panelError.value = ''
  } catch (panelApiError) {
    if (panelApiError instanceof PanelApiError && panelApiError.status === 401) {
      panelAuthenticated.value = false
      panelError.value = '面板会话已过期，请重新解锁。'
      return
    }

    panelError.value = getErrorMessage(panelApiError, '加载后端配置失败')
    throw panelApiError
  } finally {
    backendProfilesLoading.value = false
  }
}

async function unlockPanel() {
  if (!panelPassword.value.trim()) {
    panelError.value = '请输入面板密码'
    return
  }

  panelLoading.value = true
  panelError.value = ''

  try {
    await loginToPanel(panelPassword.value)
    panelAuthenticated.value = true
    panelPassword.value = ''
    await loadPanelBackendProfiles()
    if (currentBackend.value?.adminKey) {
      await login()
    }
  } catch (panelApiError) {
    panelError.value = getErrorMessage(panelApiError, '面板解锁失败')
  } finally {
    panelReady.value = true
    panelLoading.value = false
  }
}

async function initializePanel() {
  panelLoading.value = true
  panelError.value = ''

  try {
    panelAuthenticated.value = await getPanelSession()
    if (panelAuthenticated.value) {
      await loadPanelBackendProfiles()
      if (currentBackend.value?.adminKey) {
        await login()
      }
    }
  } catch (panelApiError) {
    panelError.value = getErrorMessage(panelApiError, '面板初始化失败')
  } finally {
    panelReady.value = true
    panelLoading.value = false
  }
}

async function logoutPanel() {
  adminKey.value = ''
  clearLoadedData()
  try {
    await logoutFromPanel()
  } catch {
    // Best effort panel logout.
  }
  panelAuthenticated.value = false
  panelPassword.value = ''
  panelError.value = ''
  setBackendProfiles([], '')
  closeBackendModal()
}

function clearLoadedData() {
  loggedIn.value = false
  error.value = ''
  status.value = null
  nodes.value = []
  templates.value = []
  subscriptions.value = []
  selectedNode.value = null
  nodeReleases.value = []
  deployCommand.value = ''
  uninstallCommand.value = ''
  closeReleaseLog()
  closePublishRelease()
  closeSubscriptionQr()
  closeTemplateModal()
  closeSubscriptionModal()
  showCreateNode.value = false
}

async function switchBackend(backendId: string, reconnect = true) {
  if (!backendId) return
  persistCurrentBackendId(backendId)
  syncCurrentBackendApiBase()
  adminKey.value = currentBackend.value?.adminKey || ''
  clearLoadedData()
  if (reconnect && adminKey.value) {
    await login()
  }
}

async function onBackendSelectionChange(backendId: string) {
  if (!backendId || backendId === currentBackendId.value) return
  await switchBackend(backendId)
}

function openCreateBackendModal() {
  editingBackendId.value = ''
  backendDraft.value = createEmptyBackendDraft({
    apiBaseUrl: currentBackend.value?.apiBaseUrl || api.getApiBase(),
  })
  showBackendModal.value = true
}

function openEditBackendModal(profile: BackendProfile | null = currentBackend.value) {
  if (!profile) return
  editingBackendId.value = profile.id
  backendDraft.value = createEmptyBackendDraft(profile)
  showBackendModal.value = true
}

function closeBackendModal() {
  showBackendModal.value = false
  editingBackendId.value = ''
  backendDraft.value = createEmptyBackendDraft(currentBackend.value || undefined)
}

async function submitBackendProfile() {
  const nextProfile = {
    name: backendDraft.value.name.trim() || ('后端 ' + (backendProfiles.value.length + (editingBackendId.value ? 0 : 1))),
    apiBaseUrl: normalizeBackendApiBase(backendDraft.value.apiBaseUrl),
    adminKey: backendDraft.value.adminKey,
  }

  try {
    if (editingBackendId.value) {
      const targetId = editingBackendId.value
      await persistBackendProfiles(backendProfiles.value.map((profile) => (
        profile.id === targetId
          ? { ...profile, ...nextProfile }
          : profile
      )), targetId)
      closeBackendModal()
      toast('success', '后端已更新')
      if (targetId === currentBackendId.value) {
        await switchBackend(targetId, loggedIn.value || Boolean(nextProfile.adminKey))
      }
      return
    }

    const createdProfile: BackendProfile = {
      id: createBackendProfileId(),
      ...nextProfile,
    }
    await persistBackendProfiles([...backendProfiles.value, createdProfile], createdProfile.id)
    closeBackendModal()
    toast('success', '后端已添加')
    await switchBackend(createdProfile.id, Boolean(createdProfile.adminKey))
  } catch (submitError) {
    toast('error', getErrorMessage(submitError, '保存后端配置失败'))
  }
}

async function deleteCurrentBackendProfile() {
  const targetId = editingBackendId.value || currentBackendId.value
  const targetProfile = backendProfiles.value.find((profile) => profile.id === targetId)
  if (!targetProfile) return
  if (backendProfiles.value.length <= 1) {
    toast('error', '至少保留一个后端')
    return
  }
  const confirmed = window.confirm('确认删除后端“' + targetProfile.name + '”吗？')
  if (!confirmed) return

  try {
    const nextProfiles = backendProfiles.value.filter((profile) => profile.id !== targetId)
    await persistBackendProfiles(nextProfiles, nextProfiles[0]?.id || '')
    closeBackendModal()
    toast('success', '后端已删除')

    if (targetId === currentBackendId.value) {
      const nextBackendId = nextProfiles[0]?.id || ''
      await switchBackend(nextBackendId, Boolean(nextProfiles[0]?.adminKey))
    }
  } catch (deleteError) {
    toast('error', getErrorMessage(deleteError, '删除后端配置失败'))
  }
}

// ---- Auth ----
async function login() {
  if (!currentBackend.value) {
    error.value = '请先添加后端配置'
    return
  }
  loading.value = true; error.value = ''
  syncCurrentBackendApiBase()
  try {
    const s = await api.getSystemStatus(adminKey.value)
    status.value = s; loggedIn.value = true
    await updateCurrentBackendAdminKey(adminKey.value)
    clearLegacyBackendStorage(!isLocalPanelMode())
    await loadAll()
  } catch (e:any) { error.value = e.message || '连接认证失败' }
  loading.value = false
}

async function logout() {
  try {
    await updateCurrentBackendAdminKey('')
  } catch {
    // Ignore persisted key cleanup failures during logout.
  }
  adminKey.value = ''
  clearLegacyBackendStorage(!isLocalPanelMode())
  clearLoadedData()
}

// ---- Data Loading ----
function findNodeById(nodeList: NodeRecord[], nodeId: string | null | undefined) {
  if (!nodeId) return null
  return nodeList.find((node) => node.id === nodeId) || null
}

function syncNodeSelections(nextNodes: NodeRecord[]) {
  if (selectedNode.value) selectedNode.value = findNodeById(nextNodes, selectedNode.value.id)
  if (selectedReleaseLogNode.value) selectedReleaseLogNode.value = findNodeById(nextNodes, selectedReleaseLogNode.value.id)
  if (publishNode.value) publishNode.value = findNodeById(nextNodes, publishNode.value.id)
}

async function refreshNodesData() {
  const nextNodes = await api.listNodes(adminKey.value)
  nodes.value = nextNodes
  syncNodeSelections(nextNodes)
  return nextNodes
}

async function loadAll() {
  loading.value = true
  try {
    const [n, t, s] = await Promise.all([
      api.listNodes(adminKey.value),
      api.listTemplates(adminKey.value),
      api.listSubscriptions(adminKey.value),
    ])
    nodes.value = n; templates.value = t; subscriptions.value = s
    syncNodeSelections(n)
  } catch (e:any) { toast('error', e.message) }
  loading.value = false
}

async function refreshStatus() {
  try { status.value = await api.getSystemStatus(adminKey.value) } catch {}
}

function getTimestamp(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function sortByCreatedAtDesc<T extends { createdAt: string }>(records: T[]) {
  return [...records].sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt))
}

// ---- Node Actions ----
const DEFAULT_GITHUB_MIRROR_URL = 'https://gh-proxy.org'

function createDefaultNewNode() {
  return {
    name:'', nodeType:'vps' as 'vps'|'edge', region:'',
    networkType:'public' as 'public'|'noPublicIp',
    primaryDomain:'', backupDomain:'', entryIp:'',
    useGithubMirror:false, githubMirrorUrl:'',
    installWarp:false,
    warpLicenseKey:'',
    heartbeatIntervalSeconds:15,
    versionPullIntervalSeconds:15,
    cfDnsToken:'',
    argoTunnelToken:'',
    argoTunnelDomain:'',
    argoTunnelPort:2053,
  }
}

const newNode = ref(createDefaultNewNode())

function ensureGithubMirrorUrl() {
  if (newNode.value.useGithubMirror && !newNode.value.githubMirrorUrl.trim()) {
    newNode.value.githubMirrorUrl = DEFAULT_GITHUB_MIRROR_URL
  }
}

function resetNewNode() {
  newNode.value = createDefaultNewNode()
}

async function createNode() {
  const n = newNode.value
  const githubMirrorUrl = n.useGithubMirror ? (n.githubMirrorUrl.trim() || DEFAULT_GITHUB_MIRROR_URL) : ''
  try {
    await api.createNode(adminKey.value, {
      name: n.name,
      nodeType: n.nodeType,
      region: n.region,
      networkType: n.networkType,
      primaryDomain: n.networkType === 'public' ? n.primaryDomain.trim() : '',
      backupDomain: n.networkType === 'public' ? n.backupDomain.trim() : '',
      entryIp: n.networkType === 'public' ? n.entryIp.trim() : '',
      githubMirrorUrl,
      installWarp: n.installWarp,
      warpLicenseKey: n.installWarp ? n.warpLicenseKey.trim() : '',
      heartbeatIntervalSeconds: n.heartbeatIntervalSeconds || 15,
      versionPullIntervalSeconds: n.versionPullIntervalSeconds || 15,
      cfDnsToken: n.networkType === 'public' ? n.cfDnsToken.trim() : '',
      argoTunnelToken: n.networkType === 'noPublicIp' ? n.argoTunnelToken.trim() : '',
      argoTunnelDomain: n.networkType === 'noPublicIp' ? n.argoTunnelDomain.trim() : '',
      argoTunnelPort: n.networkType === 'noPublicIp' ? (n.argoTunnelPort || 2053) : 2053,
    })
    showCreateNode.value = false
    resetNewNode()
    toast('success', '节点创建成功'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

async function selectNode(n: NodeRecord) {
  selectedNode.value = n; deployCommand.value = ''; uninstallCommand.value = ''
  try { nodeReleases.value = await api.listNodeReleases(adminKey.value, n.id) } catch { nodeReleases.value = [] }
}

async function loadDeployCommand() {
  if (!selectedNode.value) return
  try {
    const result = await api.getNodeDeployCommand(adminKey.value, selectedNode.value.id)
    deployCommand.value = result.command
  } catch (e:any) { toast('error', e.message) }
}

async function loadUninstallCommand() {
  if (!selectedNode.value) return
  try {
    const result = await api.getNodeUninstallCommand(adminKey.value, selectedNode.value.id)
    uninstallCommand.value = result.command
  } catch (e:any) { toast('error', e.message) }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => toast('success', '已复制到剪贴板')).catch(() => toast('error', '复制失败'))
}

function closeReleaseLog() {
  showReleaseLog.value = false
  releaseLogLoading.value = false
  selectedReleaseLog.value = null
  selectedReleaseLogNode.value = null
}

async function openReleaseLog(node: NodeRecord, releaseId: string) {
  showReleaseLog.value = true
  releaseLogLoading.value = true
  selectedReleaseLog.value = null
  selectedReleaseLogNode.value = node
  try {
    selectedReleaseLog.value = await api.getNodeReleaseLog(adminKey.value, node.id, releaseId)
  } catch (e:any) {
    closeReleaseLog()
    toast('error', e.message || '加载版本日志失败')
  } finally {
    releaseLogLoading.value = false
  }
}

async function openNodeReleaseLog(node: NodeRecord, revision?: number) {
  const targetRevision = revision && revision > 0
    ? revision
    : Math.max(Number(node.currentReleaseRevision || 0), Number(node.desiredReleaseRevision || 0))
  if (targetRevision <= 0) {
    toast('error', '当前节点还没有可查看的版本日志')
    return
  }

  let releases = selectedNode.value?.id === node.id ? nodeReleases.value : []
  let release = releases.find((item) => Number(item.revision || 0) === targetRevision)

  if (!release) {
    try {
      releases = await api.listNodeReleases(adminKey.value, node.id)
      if (selectedNode.value?.id === node.id) {
        nodeReleases.value = releases
      }
      release = releases.find((item) => Number(item.revision || 0) === targetRevision)
    } catch (e:any) {
      toast('error', e.message || '加载版本列表失败')
      return
    }
  }

  if (!release) {
    toast('error', `未找到版本 r${targetRevision} 的日志`)
    return
  }

  await openReleaseLog(node, release.id)
}

function joinCheckCommand(parts: string[]) {
  return parts.filter(Boolean).join('; ')
}

function buildCheckCommand(parts: string[]) {
  return joinCheckCommand([
    'ETC_DIR=/etc/nodehubsapi',
    '[ -d "$ETC_DIR" ] || ETC_DIR="$HOME/.config/nodehubsapi"',
    'STATE_DIR=/opt/nodehubsapi',
    '[ -d "$STATE_DIR" ] || STATE_DIR="$HOME/.local/share/nodehubsapi"',
    ...parts,
  ])
}

function buildServiceStatusCommand(service: string, processPattern: string) {
  return `systemctl status ${service} --no-pager 2>/dev/null || systemctl --user status ${service} --no-pager 2>/dev/null || pgrep -af "${processPattern}" || echo "${processPattern} not running"`
}

function buildServiceLogCommand(service: string, fallback: string) {
  return `journalctl -u ${service} -n 120 --no-pager 2>/dev/null || journalctl --user -u ${service} -n 120 --no-pager 2>/dev/null || tail -n 120 "${fallback}" 2>/dev/null || echo "missing: ${fallback}"`
}

function buildRuntimeCheckCommand(
  {
    title,
    description,
    label,
    service,
    processPattern,
    configFile,
    logFile,
  }: {
    title: string
    description: string
    label: string
    service: string
    processPattern: string
    configFile: string
    logFile: string
  },
) {
  return {
    title,
    description,
    command: buildCheckCommand([
      `echo '== ${label} config =='`,
      `sed -n '1,120p' "$ETC_DIR/runtime/${configFile}" 2>/dev/null || echo "missing: $ETC_DIR/runtime/${configFile}"`,
      'echo',
      `echo '== ${label} process =='`,
      `pgrep -af "${processPattern}" 2>/dev/null || echo "${processPattern} not running"`,
      'echo',
      `echo '== ${label} status =='`,
      buildServiceStatusCommand(service, processPattern),
      'echo',
      `echo '== ${label} log =='`,
      buildServiceLogCommand(service, `$STATE_DIR/runtime/${logFile}`),
    ]),
  }
}

function getNodeCheckCommands(node: NodeRecord) {
  const commands = [
    {
      title: 'Agent 全量排查',
      description: '单行查看 agent 参数、状态和最近日志。',
      command: buildCheckCommand([
        `echo '== agent.env =='`,
        `sed -n '1,120p' "$ETC_DIR/agent.env" 2>/dev/null || echo "missing: $ETC_DIR/agent.env"`,
        'echo',
        `echo '== agent process =='`,
        `pgrep -af "nodehubsapi-agent" 2>/dev/null || echo "nodehubsapi-agent not running"`,
        'echo',
        `echo '== agent status =='`,
        buildServiceStatusCommand('nodehubsapi-agent.service', 'nodehubsapi-agent'),
        'echo',
        `echo '== agent log =='`,
        buildServiceLogCommand('nodehubsapi-agent.service', '$STATE_DIR/agent.log'),
      ]),
    },
    {
      title: 'Agent 心跳连接测试',
      description: '单行使用当前 agent 环境对 heartbeat 接口发起真实请求。',
      command: buildCheckCommand([
        '[ -f "$ETC_DIR/agent.env" ] && . "$ETC_DIR/agent.env"',
        `if [ -n "\${API_BASE:-}" ] && [ -n "\${NODE_ID:-}" ] && [ -n "\${AGENT_TOKEN:-}" ] && command -v curl >/dev/null 2>&1; then PAYLOAD="{\\"nodeId\\":\\"$NODE_ID\\",\\"bytesInTotal\\":0,\\"bytesOutTotal\\":0,\\"currentConnections\\":0,\\"heartbeatIntervalSeconds\\":\${HEARTBEAT_INTERVAL_SECONDS:-15},\\"versionPullIntervalSeconds\\":\${VERSION_PULL_INTERVAL_SECONDS:-15}}"; curl -fsS -X POST -H "Content-Type: application/json" -H "X-Agent-Token: $AGENT_TOKEN" "$API_BASE/api/nodes/agent/heartbeat" --data "$PAYLOAD"; else echo 'missing API_BASE/NODE_ID/AGENT_TOKEN or curl'; fi`,
      ]),
    },
    {
      title: 'WARP 全量排查',
      description: '单行查看 warp-svc、warp-cli、本地代理模式和监听端口。',
      command: buildCheckCommand([
        `echo '== warp-svc status =='`,
        buildServiceStatusCommand('warp-svc.service', 'warp-svc'),
        'echo',
        `echo '== warp-svc log =='`,
        buildServiceLogCommand('warp-svc.service', '$STATE_DIR/warp/warp-svc.log'),
        'echo',
        `echo '== warp-cli status =='`,
        `command -v warp-cli >/dev/null 2>&1 && (warp-cli --accept-tos registration show 2>/dev/null || warp-cli registration show 2>/dev/null || true; echo; warp-cli --accept-tos status 2>/dev/null || warp-cli status 2>/dev/null || true) || echo 'warp-cli not installed'`,
        'echo',
        `echo '== warp-cli settings =='`,
        `command -v warp-cli >/dev/null 2>&1 && (warp-cli --accept-tos settings 2>/dev/null || warp-cli settings 2>/dev/null || true) || echo 'warp-cli not installed'`,
        'echo',
        `echo '== local proxy listener =='`,
        `ss -ltnp 2>/dev/null | grep ':${DEFAULT_WARP_LOCAL_PROXY_PORT}[[:space:]]' || netstat -ltnp 2>/dev/null | grep ':${DEFAULT_WARP_LOCAL_PROXY_PORT}[[:space:]]' || echo 'port ${DEFAULT_WARP_LOCAL_PROXY_PORT} not listening'`,
      ]),
    },
    buildRuntimeCheckCommand({
      title: 'sing-box 参数和日志',
      description: '单行查看 sing-box 配置、进程参数、状态和日志。',
      label: 'sing-box',
      service: 'nodehubsapi-runtime-sing-box.service',
      processPattern: 'sing-box',
      configFile: 'sing-box.json',
      logFile: 'sing-box.log',
    }),
    buildRuntimeCheckCommand({
      title: 'xray 参数和日志',
      description: '单行查看 xray 配置、进程参数、状态和日志。',
      label: 'xray',
      service: 'nodehubsapi-runtime-xray.service',
      processPattern: 'xray',
      configFile: 'xray.json',
      logFile: 'xray.log',
    }),
    {
      title: '版本拉取 / 应用排查',
      description: '单行查看 reconcile 返回、本地版本文件和最新应用日志。',
      command: buildCheckCommand([
        '[ -f "$ETC_DIR/agent.env" ] && . "$ETC_DIR/agent.env"',
        `echo '== reconcile env =='`,
        `if [ -n "\${API_BASE:-}" ] && [ -n "\${NODE_ID:-}" ] && [ -n "\${AGENT_TOKEN:-}" ] && command -v curl >/dev/null 2>&1; then curl -fsSL -H "X-Agent-Token: $AGENT_TOKEN" "$API_BASE/api/nodes/agent/reconcile?nodeId=$NODE_ID&format=env" || true; else echo 'missing API_BASE/NODE_ID/AGENT_TOKEN or curl'; fi`,
        'echo',
        `echo '== local release metadata =='`,
        `sed -n '1,120p' "$ETC_DIR/runtime/release.json" 2>/dev/null || echo "missing: $ETC_DIR/runtime/release.json"`,
        `[ -f "$STATE_DIR/releases/current.json" ] && sed -n '1,120p' "$STATE_DIR/releases/current.json" || echo "missing: $STATE_DIR/releases/current.json"`,
        'echo',
        `echo '== release files =='`,
        `ls -lah "$STATE_DIR/releases" 2>/dev/null || echo "missing: $STATE_DIR/releases"`,
        `LATEST_APPLY_LOG="$(ls -1t "$STATE_DIR"/releases/apply-*.log 2>/dev/null | head -n 1)"`,
        `[ -n "$LATEST_APPLY_LOG" ] && echo "== latest apply log: $LATEST_APPLY_LOG ==" && tail -n 120 "$LATEST_APPLY_LOG" || echo 'no apply log found'`,
      ]),
    },
  ]

  if (node.networkType === 'public') {
    commands.push({
      title: 'TLS 证书排查',
      description: '单行查看证书文件和证书有效期。',
      command: buildCheckCommand([
        `echo '== cert files =='`,
        `ls -lah "$ETC_DIR/certs" 2>/dev/null || echo "missing: $ETC_DIR/certs"`,
        'echo',
        `echo '== cert detail =='`,
        `[ -f "$ETC_DIR/certs/server.crt" ] && openssl x509 -in "$ETC_DIR/certs/server.crt" -noout -issuer -subject -dates || echo "missing: $ETC_DIR/certs/server.crt"`,
      ]),
    })
  } else {
    commands.push({
      title: 'Argo 参数和最新日志',
      description: '单行查看 cloudflared 参数、最新域名、状态和日志。',
      command: buildCheckCommand([
        `echo '== cloudflared env =='`,
        `sed -n '1,120p' "$ETC_DIR/cloudflared.env" 2>/dev/null || echo "missing: $ETC_DIR/cloudflared.env"`,
        'echo',
        `echo '== latest argo domain =='`,
        `ARGO_DOMAIN="$(grep -ao 'https://[a-z0-9-]*\\.trycloudflare\\.com' "$STATE_DIR/argo/cloudflared.log" 2>/dev/null | tail -n 1 | sed 's|https://||')"; [ -n "$ARGO_DOMAIN" ] && echo "$ARGO_DOMAIN" || cat "$STATE_DIR/argo/domain" 2>/dev/null || echo 'argo domain not found'`,
        'echo',
        `echo '== cloudflared process =='`,
        `pgrep -af "cloudflared" 2>/dev/null || echo 'cloudflared not running'`,
        'echo',
        `echo '== cloudflared status =='`,
        buildServiceStatusCommand('nodehubsapi-cloudflared.service', 'cloudflared'),
        'echo',
        `echo '== cloudflared log =='`,
        buildServiceLogCommand('nodehubsapi-cloudflared.service', '$STATE_DIR/argo/cloudflared.log'),
      ]),
    })
  }

  return commands
}

async function publishRelease(nodeId: string) {
  try {
    await api.publishNode(adminKey.value, nodeId, { kind:'runtime', templateIds: templates.value.map(t=>t.id) })
    toast('success', '发布成功'); await loadAll(); await refreshStatus()
    if (selectedNode.value?.id === nodeId) await selectNode(selectedNode.value)
  } catch (e:any) { toast('error', e.message) }
}

async function deleteNodeById(nodeId: string, nodeName: string) {
  const confirmed = window.confirm(`Confirm deleting node "${nodeName}"? This cannot be undone.`)
  if (!confirmed) return
  try {
    await api.deleteNode(adminKey.value, nodeId)
    if (selectedNode.value?.id === nodeId) {
      selectedNode.value = null
      nodeReleases.value = []
      deployCommand.value = ''
      uninstallCommand.value = ''
    }
    toast('success', 'Node deleted')
    await loadAll()
    await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

// ---- Template Actions ----
const catalogPresets = ref<any[]>([])
const editingTemplateId = ref('')

function createEmptyTemplate() {
  return {
    name:'', engine:'xray' as 'sing-box'|'xray',
    protocol:'vless', transport:'ws', tlsMode:'none' as 'none'|'tls'|'reality',
    warpExit:false, warpRouteMode:'all' as 'all'|'ipv4'|'ipv6',
    defaults:{} as Record<string,unknown>, notes:''
  }
}

const newTemplate = ref(createEmptyTemplate())
const realitySniMode = ref<'random'|'manual'>('random')
const realityFingerprintOptions = [
  { value: 'chrome', label: 'chrome' },
  { value: 'firefox', label: 'firefox' },
  { value: 'edge', label: 'edge' },
  { value: 'safari', label: 'safari' },
  { value: 'ios', label: 'ios' },
  { value: 'android', label: 'android' },
]
const defaultRealityFingerprint = 'chrome'
const defaultRealityFlow = 'xtls-rprx-vision'
const defaultWireguardServerAddress = '10.66.0.1/24'
const defaultWireguardClientAddress = '10.66.0.2/32'
const defaultWireguardClientAllowedIps = '0.0.0.0/0, ::/0'
const defaultWireguardDns = '1.1.1.1, 8.8.8.8'
const defaultWireguardMtu = 1408
const defaultWireguardPort = 51820

type TemplateDefaultField = {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'number' | 'boolean'
  generator?: string
  list?: string
  options?: Array<{ value: string; label: string }>
  readonly?: boolean
}

const sampleSecrets = new Set([
  'replace-me',
  'replace_me',
  'replace-me-base64-key',
  'your-password',
  'changeme',
  'change-me',
  'password',
])

const sampleRealitySnis = [
  'www.microsoft.com',
  'www.apple.com',
  'www.intel.com',
  'www.oracle.com',
  'www.ibm.com',
  'www.nvidia.com',
]

function detectRealitySniMode(defaults: Record<string, unknown>) {
  const sni = String(defaults['sni'] || '').trim().toLowerCase()
  if (!sni) return 'random' as const
  return sampleRealitySnis.some((item) => item.toLowerCase() === sni) ? 'random' as const : 'manual' as const
}

function resetTemplateForm() {
  editingTemplateId.value = ''
  newTemplate.value = createEmptyTemplate()
  realitySniMode.value = 'random'
}

function closeTemplateModal() {
  showCreateTemplate.value = false
  resetTemplateForm()
}

// Protocol options based on engine
const protocolOptions = computed(() => {
  return [
    { value:'vless', label:'VLESS' },
    { value:'vmess', label:'VMESS' },
    { value:'trojan', label:'Trojan' },
    { value:'shadowsocks', label:'Shadowsocks' },
    { value:'hysteria2', label:'Hysteria2' },
    { value:'wireguard', label:'WireGuard' },
  ]
})

// Transport options based on protocol
const transportOptions = computed(() => {
  const p = newTemplate.value.protocol
  if (p === 'hysteria2') return [{ value:'hysteria2', label:'Hysteria2 (QUIC)' }]
  if (p === 'wireguard') return [{ value:'wireguard', label:'WireGuard (UDP)' }]
  return [
    { value:'tcp', label:'TCP' },
    { value:'ws', label:'WebSocket' },
    { value:'grpc', label:'gRPC' },
    { value:'xhttp', label:'XHTTP' },
  ]
})

// TLS options based on protocol/transport
const tlsOptions = computed(() => {
  const p = newTemplate.value.protocol
  if (p === 'hysteria2') return [{ value:'tls', label:'TLS' }]
  if (p === 'shadowsocks') return [{ value:'none', label:'None' }]
  if (p === 'wireguard') return [{ value:'none', label:'None' }]
  const opts = [
    { value:'none', label:'None' },
    { value:'tls', label:'TLS' },
  ]
  if (p === 'vless' && newTemplate.value.transport === 'tcp') {
    opts.push({ value:'reality', label:'Reality' })
  }
  return opts
})

// Dynamic fields for template defaults
const templateDefaultFields = computed(() => {
  const p = newTemplate.value.protocol
  const t = newTemplate.value.transport
  const tls = newTemplate.value.tlsMode
  const fields: TemplateDefaultField[] = []

  // Port
  fields.push({ key:'serverPort', label:'端口', placeholder: p === 'wireguard' ? String(defaultWireguardPort) : '443', type:'number' })

  if (p === 'wireguard') {
    fields.push({ key:'serverPrivateKey', label:'服务端私钥', placeholder:'点击 Generate Keypair 自动生成', generator:'wg-server-keypair' })
    fields.push({ key:'serverPublicKey', label:'服务端公钥', placeholder:'自动生成或手动填写' })
    fields.push({ key:'clientPrivateKey', label:'客户端私钥', placeholder:'点击 Generate Keypair 自动生成', generator:'wg-client-keypair' })
    fields.push({ key:'clientPublicKey', label:'客户端公钥', placeholder:'自动生成或手动填写' })
    fields.push({ key:'presharedKey', label:'预共享密钥', placeholder:'可选，base64' })
    fields.push({ key:'serverAddress', label:'服务端地址', placeholder: defaultWireguardServerAddress })
    fields.push({ key:'clientAddress', label:'客户端地址', placeholder: defaultWireguardClientAddress })
    fields.push({ key:'peerAllowedIps', label:'服务端允许 IPs', placeholder: defaultWireguardClientAddress })
    fields.push({ key:'clientAllowedIps', label:'客户端 AllowedIPs', placeholder: defaultWireguardClientAllowedIps })
    fields.push({ key:'dns', label:'DNS', placeholder: defaultWireguardDns })
    fields.push({ key:'mtu', label:'MTU', placeholder:String(defaultWireguardMtu), type:'number' })
    fields.push({ key:'persistentKeepalive', label:'Keepalive (秒)', placeholder:'可选，例如 25', type:'number' })
  }

  // UUID for vless/vmess
  if (p === 'vless' || p === 'vmess') {
    fields.push({ key:'uuid', label:'UUID', placeholder:'点击 Generate 自动生成', generator:'uuid' })
  }
  // Password for trojan/ss/hy2
  if (p === 'trojan' || p === 'shadowsocks' || p === 'hysteria2') {
    fields.push({ key:'password', label:'密码', placeholder:'点击 Generate 自动生成', generator:'random-password' })
  }
  // SS method
  if (p === 'shadowsocks') {
    fields.push({ key:'method', label:'加密方式', placeholder:'例如 2022-blake3-aes-128-gcm' })
  }
  // WS/XHTTP path
  if (t === 'ws' || t === 'xhttp') {
    fields.push({ key:'path', label:'路径', placeholder: t === 'ws' ? '/ws' : '/' })
    fields.push({ key:'host', label:'Host', placeholder: '需要填写服务器域名，例如 node.example.com' })
  }
  // gRPC service name
  if (t === 'grpc') {
    fields.push({ key:'serviceName', label:'Service Name', placeholder:'grpc' })
  }
  // TLS SNI
  if (tls === 'tls' || tls === 'reality' || p === 'hysteria2') {
    fields.push({
      key:'sni',
      label:'SNI',
      placeholder: tls === 'reality'
        ? (realitySniMode.value === 'random'
          ? '随机选择大陆可访问的海外网站域名'
          : '手动填写海外网站域名，例如 www.microsoft.com')
        : '需要填写服务器证书域名，例如 node.example.com',
      list: tls === 'reality' ? 'reality-sni-list' : undefined,
      readonly: tls === 'reality' && realitySniMode.value === 'random',
    })
  }
  // VLESS flow for Reality
  if (p === 'vless' && tls === 'reality') {
    fields.push({ key:'flow', label:'Flow', placeholder:'Reality 建议 xtls-rprx-vision' })
  }
  // Reality keys
  if (tls === 'reality') {
    fields.push({ key:'fingerprint', label:'Reality 指纹', placeholder:'chrome', options: realityFingerprintOptions })
    fields.push({ key:'realityPrivateKey', label:'Reality 私钥', placeholder:'点击 Generate Keypair 自动生成', generator:'x25519' })
    fields.push({ key:'realityPublicKey', label:'Reality 公钥', placeholder:'点击 Generate Keypair 自动生成' })
    fields.push({ key:'realityShortId', label:'Reality ShortId', placeholder:'点击 Generate 自动生成', generator:'shortId' })
  }
  // Hysteria2 bandwidth
  if (p === 'hysteria2') {
    fields.push({ key:'upMbps', label:'上行带宽 (Mbps)', placeholder:'100', type:'number' })
    fields.push({ key:'downMbps', label:'下行带宽 (Mbps)', placeholder:'100', type:'number' })
  }
  // VMESS alterId
  if (p === 'vmess') {
    fields.push({ key:'alterId', label:'AlterId', placeholder:'0', type:'number' })
  }

  return fields
})

function getTemplateDefaultDisplayValue(key: string) {
  const value = (newTemplate.value.defaults as Record<string, unknown>)[key]
  if (Array.isArray(value)) return value.join(',')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null || value === undefined) return ''
  return String(value)
}

function setTemplateDefaultValue(key: string, rawValue: string, type?: TemplateDefaultField['type']) {
  if (type === 'number') {
    ;(newTemplate.value.defaults as Record<string, unknown>)[key] = rawValue === '' ? '' : Number(rawValue)
    return
  }
  if (type === 'boolean') {
    ;(newTemplate.value.defaults as Record<string, unknown>)[key] = rawValue === 'true'
    return
  }
  ;(newTemplate.value.defaults as Record<string, unknown>)[key] = rawValue
}

// Watch protocol changes and auto-fix transport/tls
watch(() => newTemplate.value.protocol, (p) => {
  if (p === 'wireguard') {
    newTemplate.value.transport = 'wireguard'
    newTemplate.value.tlsMode = 'none'
  } else if (p === 'hysteria2') {
    newTemplate.value.transport = 'hysteria2'
    newTemplate.value.tlsMode = 'tls'
    if (newTemplate.value.engine !== 'sing-box') newTemplate.value.engine = 'sing-box'
  } else if (p === 'shadowsocks') {
    newTemplate.value.tlsMode = 'none'
    if (newTemplate.value.transport === 'hysteria2') newTemplate.value.transport = 'tcp'
    if (newTemplate.value.transport === 'wireguard') newTemplate.value.transport = 'tcp'
  } else {
    if (newTemplate.value.transport === 'hysteria2') newTemplate.value.transport = 'tcp'
    if (newTemplate.value.transport === 'wireguard') newTemplate.value.transport = 'tcp'
  }
  void hydrateTemplateDefaults('repair')
})

watch(
  () => `${newTemplate.value.transport}:${newTemplate.value.tlsMode}:${String(newTemplate.value.defaults['method'] || '')}`,
  () => {
    void hydrateTemplateDefaults('repair')
  },
)

watch(() => newNode.value.useGithubMirror, (enabled) => {
  if (enabled) ensureGithubMirrorUrl()
})

async function openCreateTemplate() {
  resetTemplateForm()
  showCreateTemplate.value = true
  try { catalogPresets.value = await api.listTemplateCatalog(adminKey.value) } catch {}
  await hydrateTemplateDefaults('repair')
}

async function applyPreset(p: any) {
  newTemplate.value = {
    name: p.name, engine: p.engine, protocol: p.protocol,
    transport: p.transport, tlsMode: p.tlsMode,
    warpExit: p.warpExit === true,
    warpRouteMode: p.warpRouteMode === 'ipv4' || p.warpRouteMode === 'ipv6' ? p.warpRouteMode : 'all',
    defaults: p.defaults ? { ...p.defaults } : {}, notes: p.notes || ''
  }
  realitySniMode.value = detectRealitySniMode(newTemplate.value.defaults)
  await hydrateTemplateDefaults('force')
}

async function submitTemplate() {
  try {
    await hydrateTemplateDefaults('repair')
    if (editingTemplateId.value) {
      await api.updateTemplate(adminKey.value, editingTemplateId.value, newTemplate.value)
      toast('success', '模板更新成功')
    } else {
      await api.createTemplate(adminKey.value, newTemplate.value)
      toast('success', '模板创建成功')
    }
    closeTemplateModal()
    await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

// ---- Generators ----
function generateUUID() {
  if (typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function generateRandomHex(bytes: number) {
  const arr = new Uint8Array(bytes)
  window.crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateBase64(bytes: number) {
  const arr = new Uint8Array(bytes)
  window.crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...Array.from(arr)))
}

function generateRandomSecret(bytes = 24) {
  return generateRandomHex(bytes)
}

function getShadowsocks2022KeyBytes(method: string) {
  switch (method.trim().toLowerCase()) {
    case '2022-blake3-aes-128-gcm':
      return 16
    case '2022-blake3-aes-256-gcm':
      return 32
    case '2022-blake3-chacha20-poly1305':
      return 32
    default:
      return 0
  }
}

function generateTemplatePassword() {
  if (newTemplate.value.protocol === 'shadowsocks') {
    const method = String(newTemplate.value.defaults['method'] || '2022-blake3-aes-128-gcm')
    const ss2022KeyBytes = getShadowsocks2022KeyBytes(method)
    if (ss2022KeyBytes > 0) {
      return generateBase64(ss2022KeyBytes)
    }
  }
  return generateRandomSecret(24)
}

function isPlaceholderSecret(value: unknown) {
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return !normalized || sampleSecrets.has(normalized)
}

function isSampleUuid(value: unknown) {
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return !normalized || normalized === '00000000-0000-4000-8000-000000000001' || normalized === '00000000-0000-4000-8000-000000000002' || normalized === '00000000-0000-4000-8000-000000000003'
}

function isRealityShortId(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{2,32}$/i.test(value.trim())
}

function isRealityPlaceholder(value: unknown) {
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return !normalized || normalized === 'replace-me' || normalized === 'replace_me'
}

function pickRealitySni() {
  const bytes = new Uint8Array(1)
  window.crypto.getRandomValues(bytes)
  return sampleRealitySnis[bytes[0] % sampleRealitySnis.length] || sampleRealitySnis[0]
}

function setRealitySniMode(mode: 'random'|'manual') {
  realitySniMode.value = mode
  if (mode === 'random') {
    newTemplate.value.defaults['sni'] = pickRealitySni()
  }
}

function randomizeRealitySni() {
  newTemplate.value.defaults['sni'] = pickRealitySni()
}

async function hydrateTemplateDefaults(mode: 'repair' | 'force' = 'repair') {
  const nextDefaults = { ...newTemplate.value.defaults }
  const shouldWrite = (current: unknown, invalid: boolean) => mode === 'force' || invalid
  const protocol = newTemplate.value.protocol
  const tlsMode = newTemplate.value.tlsMode

  if (protocol === 'vless' || protocol === 'vmess') {
    if (shouldWrite(nextDefaults['uuid'], isSampleUuid(nextDefaults['uuid']))) {
      nextDefaults['uuid'] = generateUUID()
    }
  }

  if (protocol === 'trojan' || protocol === 'hysteria2' || protocol === 'shadowsocks') {
    if (shouldWrite(nextDefaults['password'], isPlaceholderSecret(nextDefaults['password']))) {
      nextDefaults['password'] = generateTemplatePassword()
    }
  }

  if (protocol === 'shadowsocks' && !String(nextDefaults['method'] || '').trim()) {
    nextDefaults['method'] = '2022-blake3-aes-128-gcm'
    if (mode === 'force' || isPlaceholderSecret(nextDefaults['password'])) {
      nextDefaults['password'] = generateTemplatePassword()
    }
  }

  if (protocol === 'wireguard') {
    if (shouldWrite(nextDefaults['serverAddress'], !String(nextDefaults['serverAddress'] || '').trim())) {
      nextDefaults['serverAddress'] = defaultWireguardServerAddress
    }
    if (shouldWrite(nextDefaults['clientAddress'], !String(nextDefaults['clientAddress'] || '').trim())) {
      nextDefaults['clientAddress'] = defaultWireguardClientAddress
    }
    if (shouldWrite(nextDefaults['peerAllowedIps'], !String(nextDefaults['peerAllowedIps'] || '').trim())) {
      nextDefaults['peerAllowedIps'] = String(nextDefaults['clientAddress'] || defaultWireguardClientAddress)
    }
    if (shouldWrite(nextDefaults['clientAllowedIps'], !String(nextDefaults['clientAllowedIps'] || '').trim())) {
      nextDefaults['clientAllowedIps'] = defaultWireguardClientAllowedIps
    }
    if (shouldWrite(nextDefaults['dns'], !String(nextDefaults['dns'] || '').trim())) {
      nextDefaults['dns'] = defaultWireguardDns
    }
    if (shouldWrite(nextDefaults['mtu'], !String(nextDefaults['mtu'] || '').trim())) {
      nextDefaults['mtu'] = defaultWireguardMtu
    }
  }

  if (tlsMode === 'reality') {
    if (shouldWrite(nextDefaults['realityShortId'], !isRealityShortId(nextDefaults['realityShortId']))) {
      nextDefaults['realityShortId'] = generateRandomHex(8)
    }
    if (shouldWrite(nextDefaults['flow'], !String(nextDefaults['flow'] || '').trim())) {
      nextDefaults['flow'] = defaultRealityFlow
    }
    if (shouldWrite(nextDefaults['fingerprint'], !String(nextDefaults['fingerprint'] || '').trim())) {
      nextDefaults['fingerprint'] = defaultRealityFingerprint
    }
    const currentSni = String(nextDefaults['sni'] || '').trim()
    if ((realitySniMode.value === 'random' && (mode === 'force' || !currentSni || currentSni.startsWith('例如 ')))
      || (!currentSni || currentSni.startsWith('例如 '))) {
      nextDefaults['sni'] = pickRealitySni()
    }
    if (mode === 'force' || isRealityPlaceholder(nextDefaults['realityPrivateKey']) || isRealityPlaceholder(nextDefaults['realityPublicKey'])) {
      await generateRealityKeys(nextDefaults)
    }
  }

  newTemplate.value.defaults = nextDefaults
}

async function generateRealityKeys(targetDefaults = newTemplate.value.defaults) {
  try {
    const keyPair = await window.crypto.subtle.generateKey({ name: "X25519" } as any, true, ["deriveBits"])
    const pubKeyBuf = await window.crypto.subtle.exportKey("raw", (keyPair as any).publicKey)
    const privKeyBuf = await window.crypto.subtle.exportKey("pkcs8", (keyPair as any).privateKey)
    const privRaw = new Uint8Array(privKeyBuf).slice(-32) // extract raw 32 bytes from pkcs8
    const toBase64Url = (buf: Uint8Array) => btoa(String.fromCharCode(...Array.from(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    targetDefaults['realityPublicKey'] = toBase64Url(new Uint8Array(pubKeyBuf))
    targetDefaults['realityPrivateKey'] = toBase64Url(privRaw)
    if (targetDefaults === newTemplate.value.defaults) {
      toast('success', 'Generated new Reality key pair')
    }
  } catch (e) {
    if (targetDefaults === newTemplate.value.defaults) {
      toast('error', '当前浏览器不支持 X25519 密钥生成，请手动输入')
    }
  }
}

async function generateWireguardKeypair() {
  const keyPair = await window.crypto.subtle.generateKey({ name: "X25519" } as any, true, ["deriveBits"])
  const pubKeyBuf = await window.crypto.subtle.exportKey("raw", (keyPair as any).publicKey)
  const privKeyBuf = await window.crypto.subtle.exportKey("pkcs8", (keyPair as any).privateKey)
  const privRaw = new Uint8Array(privKeyBuf).slice(-32)
  const toBase64 = (buf: Uint8Array) => btoa(String.fromCharCode(...Array.from(buf)))
  return {
    publicKey: toBase64(new Uint8Array(pubKeyBuf)),
    privateKey: toBase64(privRaw),
  }
}

async function generateWireguardKeys(kind: 'server' | 'client', targetDefaults = newTemplate.value.defaults) {
  try {
    const pair = await generateWireguardKeypair()
    if (kind === 'server') {
      targetDefaults['serverPublicKey'] = pair.publicKey
      targetDefaults['serverPrivateKey'] = pair.privateKey
    } else {
      targetDefaults['clientPublicKey'] = pair.publicKey
      targetDefaults['clientPrivateKey'] = pair.privateKey
    }
    if (targetDefaults === newTemplate.value.defaults) {
      toast('success', `Generated new WireGuard ${kind} key pair`)
    }
  } catch (e) {
    if (targetDefaults === newTemplate.value.defaults) {
      toast('error', '当前浏览器不支持 WireGuard 密钥生成，请手动输入')
    }
  }
}

function handleGenerate(type: string) {
  if (type === 'uuid') {
    newTemplate.value.defaults['uuid'] = generateUUID()
  } else if (type === 'random-password') {
    newTemplate.value.defaults['password'] = generateTemplatePassword()
  } else if (type === 'shortId') {
    newTemplate.value.defaults['realityShortId'] = generateRandomHex(8)
  } else if (type === 'x25519') {
    generateRealityKeys()
  } else if (type === 'wg-server-keypair') {
    generateWireguardKeys('server')
  } else if (type === 'wg-client-keypair') {
    generateWireguardKeys('client')
  }
}

async function openEditTemplate(template: TemplateRecord) {
  editingTemplateId.value = template.id
  newTemplate.value = {
    name: template.name,
    engine: template.engine,
    protocol: template.protocol,
    transport: template.transport,
    tlsMode: template.tlsMode,
    warpExit: template.warpExit,
    warpRouteMode: template.warpRouteMode,
    defaults: { ...(template.defaults || {}) },
    notes: template.notes || '',
  }
  realitySniMode.value = detectRealitySniMode(newTemplate.value.defaults)
  showCreateTemplate.value = true
  if (catalogPresets.value.length === 0) {
    try { catalogPresets.value = await api.listTemplateCatalog(adminKey.value) } catch {}
  }
  await hydrateTemplateDefaults('repair')
}

async function deleteEditingTemplate() {
  if (!editingTemplateId.value) return
  const currentTemplate = templates.value.find((item) => item.id === editingTemplateId.value)
  const confirmed = window.confirm(`Confirm deleting template "${currentTemplate?.name || editingTemplateId.value}"? This cannot be undone.`)
  if (!confirmed) return
  try {
    await api.deleteTemplate(adminKey.value, editingTemplateId.value)
    closeTemplateModal()
    toast('success', '模板删除成功')
    await loadAll()
    await refreshStatus()
  } catch (e:any) {
    toast('error', e.message)
  }
}

// ---- Subscription Actions ----
function createEmptySubscription() {
  return { name:'', enabled:true, visibleNodeIds:[] as string[] }
}

const newSub = ref(createEmptySubscription())

function resetSubscriptionForm() {
  editingSubscriptionId.value = ''
  newSub.value = createEmptySubscription()
}

function closeSubscriptionModal() {
  showCreateSub.value = false
  resetSubscriptionForm()
}

function openCreateSubscription() {
  resetSubscriptionForm()
  showCreateSub.value = true
}

function openEditSubscription(subscription: SubscriptionRecord) {
  editingSubscriptionId.value = subscription.id
  newSub.value = {
    name: subscription.name,
    enabled: subscription.enabled,
    visibleNodeIds: [...subscription.visibleNodeIds],
  }
  showCreateSub.value = true
}

async function submitSubscription() {
  try {
    if (editingSubscriptionId.value) {
      await api.updateSubscription(adminKey.value, editingSubscriptionId.value, newSub.value)
      toast('success', '订阅更新成功')
    } else {
      await api.createSubscription(adminKey.value, newSub.value)
      toast('success', '订阅创建成功')
    }
    closeSubscriptionModal()
    await loadAll()
    await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

async function deleteEditingSubscription() {
  if (!editingSubscriptionId.value) return
  const current = subscriptions.value.find((item) => item.id === editingSubscriptionId.value)
  const confirmed = window.confirm(`确认删除订阅 "${current?.name || editingSubscriptionId.value}"？此操作不可恢复。`)
  if (!confirmed) return
  try {
    await api.deleteSubscription(adminKey.value, editingSubscriptionId.value)
    closeSubscriptionModal()
    toast('success', '订阅删除成功')
    await loadAll()
    await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

async function openSubscriptionQr(subscription: SubscriptionRecord, format: string, label: string) {
  const url = getSubscriptionUrl(subscription.token, format)
  copyToClipboard(url)
  showSubscriptionQr.value = true
  subscriptionQrTitle.value = `${subscription.name} / ${label}`
  subscriptionQrUrl.value = url
  subscriptionQrDataUrl.value = ''
  subscriptionQrLoading.value = true
  try {
    subscriptionQrDataUrl.value = await QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  } catch (e:any) {
    toast('error', e.message || '二维码生成失败')
  } finally {
    subscriptionQrLoading.value = false
  }
}

function closeSubscriptionQr() {
  showSubscriptionQr.value = false
  subscriptionQrTitle.value = ''
  subscriptionQrUrl.value = ''
  subscriptionQrDataUrl.value = ''
  subscriptionQrLoading.value = false
}

// Subscription URL helper
function getSubscriptionUrl(token: string, format: string) {
  const base = status.value?.publicBaseUrl || window.location.origin
  return `${base}/sub/${token}?format=${format}`
}

function getSubscriptionVisibleNodesLabel(subscription: SubscriptionRecord) {
  if (subscription.visibleNodeIds.length === 0) return '全部'
  const names = subscription.visibleNodeIds
    .map((nodeId) => nodes.value.find((node) => node.id === nodeId)?.name || nodeId)
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

async function openPublishRelease(node: NodeRecord) {
  publishNode.value = node
  publishMessage.value = ''
  publishPreview.value = null
  publishPreviewError.value = ''
  // Default to all templates, then try to use the current version's template selection
  publishTemplateIds.value = templates.value.map((template) => template.id)
  showPublishRelease.value = true
  try {
    const releases = await api.listNodeReleases(adminKey.value, node.id)
    if (releases.length > 0) {
      const latestRelease = releases[0]
      if (latestRelease.templateIds && latestRelease.templateIds.length > 0) {
        // Only keep template IDs that still exist
        const existingIds = new Set(templates.value.map((t) => t.id))
        const validIds = latestRelease.templateIds.filter((id) => existingIds.has(id))
        if (validIds.length > 0) {
          publishTemplateIds.value = validIds
        }
      }
    }
  } catch {
    // Silently fall back to all templates selected
  }
}

function closePublishRelease() {
  showPublishRelease.value = false
  publishNode.value = null
  publishTemplateIds.value = []
  publishMessage.value = ''
  publishPreview.value = null
  publishPreviewError.value = ''
  publishPreviewLoading.value = false
  publishPreviewRequestId += 1
}

function togglePublishTemplate(templateId: string) {
  if (publishTemplateIds.value.includes(templateId)) {
    publishTemplateIds.value = publishTemplateIds.value.filter((id) => id !== templateId)
    return
  }
  publishTemplateIds.value = [...publishTemplateIds.value, templateId]
}

function toggleAllPublishTemplates() {
  if (publishTemplateIds.value.length === templates.value.length) {
    publishTemplateIds.value = []
    return
  }
  publishTemplateIds.value = sortedTemplates.value.map((template) => template.id)
}

async function loadPublishPreview() {
  if (!publishNode.value) {
    publishPreview.value = null
    publishPreviewError.value = ''
    publishPreviewLoading.value = false
    return
  }
  if (publishTemplateIds.value.length === 0) {
    publishPreview.value = null
    publishPreviewError.value = ''
    publishPreviewLoading.value = false
    return
  }

  const requestId = ++publishPreviewRequestId
  publishPreviewLoading.value = true
  publishPreviewError.value = ''
  try {
    const preview = await api.previewNodeRelease(adminKey.value, publishNode.value.id, {
      templateIds: publishTemplateIds.value,
      message: publishMessage.value.trim(),
    })
    if (requestId !== publishPreviewRequestId) return
    publishPreview.value = preview
  } catch (e:any) {
    if (requestId !== publishPreviewRequestId) return
    publishPreview.value = null
    publishPreviewError.value = e.message || 'Preview failed'
  } finally {
    if (requestId === publishPreviewRequestId) {
      publishPreviewLoading.value = false
    }
  }
}

async function publishSelectedRelease() {
  if (!publishNode.value) return
  if (publishTemplateIds.value.length === 0) {
    toast('error', 'Select at least one template')
    return
  }
  try {
    publishingRelease.value = true
    await api.publishNode(adminKey.value, publishNode.value.id, {
      templateIds: publishTemplateIds.value,
      message: publishMessage.value.trim(),
    })
    const selectedNodeId = selectedNode.value?.id
    toast('success', '发布成功')
    closePublishRelease()
    await loadAll()
    await refreshStatus()
    if (selectedNodeId) {
      const latestNode = nodes.value.find((node) => node.id === selectedNodeId)
      if (latestNode) await selectNode(latestNode)
    }
  } catch (e:any) { toast('error', e.message) }
  finally { publishingRelease.value = false }
}

// Helpers
function formatBytes(b: number) {
  if (b === 0) return '0 B'
  const k = 1024, s = ['B','KB','MB','GB','TB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i]
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return `${Number(value).toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`
}

function getUsagePercent(used: number | null | undefined, total: number | null | undefined, fallback?: number | null) {
  const normalizedTotal = Number(total || 0)
  const normalizedUsed = Number(used || 0)
  if (normalizedTotal > 0) {
    return Math.max(0, Math.min(100, (normalizedUsed / normalizedTotal) * 100))
  }
  if (fallback === null || fallback === undefined || !Number.isFinite(Number(fallback))) return null
  return Math.max(0, Math.min(100, Number(fallback)))
}

function getCpuMetricText(n: NodeRecord) {
  const cores = n.cpuCoreCount ? `${n.cpuCoreCount} 核` : '-'
  const usage = formatPercent(n.cpuUsagePercent, 1)
  return usage === '-' ? cores : `${cores} / ${usage}`
}

function getMemoryMetricText(n: NodeRecord) {
  const total = Number(n.memoryTotalBytes || 0)
  const used = Number(n.memoryUsedBytes || 0)
  const usage = getUsagePercent(used, total, n.memoryUsagePercent)
  if (total > 0) {
    return `${formatBytes(used)} / ${formatBytes(total)} / ${formatPercent(usage, 2)}`
  }
  return formatPercent(n.memoryUsagePercent, 2)
}

function getStorageMetricText(n: NodeRecord) {
  const total = Number(n.storageTotalBytes || 0)
  const used = Number(n.storageUsedBytes || 0)
  const usage = getUsagePercent(used, total, n.storageUsagePercent)
  if (total > 0) {
    return `${formatBytes(used)} / ${formatBytes(total)} / ${formatPercent(usage, 2)}`
  }
  return formatPercent(n.storageUsagePercent, 2)
}

function getCpuUsagePercent(n: NodeRecord) {
  return getUsagePercent(null, null, n.cpuUsagePercent)
}

function getMemoryUsagePercent(n: NodeRecord) {
  return getUsagePercent(n.memoryUsedBytes, n.memoryTotalBytes, n.memoryUsagePercent)
}

function getStorageUsagePercent(n: NodeRecord) {
  return getUsagePercent(n.storageUsedBytes, n.storageTotalBytes, n.storageUsagePercent)
}

function getProgressTone(value: number | null) {
  if (value === null) return 'success'
  if (value > 80) return 'danger'
  if (value > 50) return 'warning'
  return 'success'
}

function isOnline(n: NodeRecord) {
  return isNodeOnline(n.lastSeenAt, n.heartbeatIntervalSeconds)
}

function getNodeDomainDisplay(n: NodeRecord) {
  if (n.networkType === 'noPublicIp') {
    return n.argoDomain || n.argoTunnelDomain || '-'
  }
  const domains = [n.primaryDomain, n.backupDomain].filter(Boolean)
  return domains.length > 0 ? domains.join(' / ') : '-'
}

function isWarpRunning(n: NodeRecord) {
  const warpStatus = (n.warpStatus || '').toLowerCase()
  return warpStatus.includes('running')
}

function getWarpStatusText(n: NodeRecord) {
  const warpStatus = (n.warpStatus || '').trim().toLowerCase()
  if (warpStatus.includes('running')) return 'Running'
  if (warpStatus.includes('installed')) return 'Installed'
  return 'Not Installed'
}

function getWarpAccountTypeText(n: NodeRecord) {
  return (n.warpAccountType || '').trim() || '-'
}

function getWarpTunnelProtocolText(n: NodeRecord) {
  return (n.warpTunnelProtocol || '').trim() || '-'
}

function getNodePermissionText(n: NodeRecord) {
  if (n.permissionMode === 'root') return 'root'
  if (n.permissionMode === 'user') return '用户态'
  return '未上报'
}

function extractRuntimeVersion(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const versionMatch = raw.match(/\b\d+\.\d+\.\d+(?:[.-][0-9A-Za-z]+)*\b/)
  if (versionMatch) return `version ${versionMatch[0]}`
  return raw
}

function getRuntimeKernelStatusText(status: string | null | undefined) {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return '未上报'
  if (normalized.includes('running')) return 'running'
  if (normalized.includes('stopping')) return 'stopping'
  if (normalized.includes('not_installed')) return '未安装'
  return normalized
}

function getRuntimeKernelText(n: NodeRecord, engine: 'sing-box' | 'xray') {
  const version = engine === 'sing-box'
    ? extractRuntimeVersion(n.singBoxVersion)
    : extractRuntimeVersion(n.xrayVersion)
  const rawStatus = engine === 'sing-box' ? n.singBoxStatus : n.xrayStatus
  const status = getRuntimeKernelStatusText(rawStatus)
  if (version && rawStatus) return `${version} ${status}`
  if (version) return version
  return status
}

function getReleaseStatusText(status: string | null | undefined) {
  switch (status) {
    case 'healthy':
      return '成功'
    case 'failed':
      return '失败'
    case 'pending':
      return '待部署'
    case 'applying':
      return '部署中'
    default:
      return '未上报'
  }
}

function getReleaseStatusClass(status: string | null | undefined) {
  switch (status) {
    case 'healthy':
      return 'healthy'
    case 'failed':
      return 'failed'
    case 'pending':
      return 'pending'
    case 'applying':
      return 'applying'
    default:
      return 'offline'
  }
}

function getNodeVersionLabel(n: NodeRecord) {
  const revision = Math.max(Number(n.currentReleaseRevision || 0), Number(n.desiredReleaseRevision || 0))
  return revision > 0 ? `r${revision}` : '---'
}

function getNodeDeployStatusText(n: NodeRecord) {
  return n.currentReleaseStatus === 'idle' ? '未部署' : getReleaseStatusText(n.currentReleaseStatus)
}

function getNodeDeployStatusClass(n: NodeRecord) {
  return n.currentReleaseStatus === 'idle' ? 'offline' : getReleaseStatusClass(n.currentReleaseStatus)
}

function getNodeVersionToneClass(n: NodeRecord) {
  if (getNodeVersionLabel(n) === '---') return 'offline'
  return getNodeDeployStatusClass(n)
}

function normalizeIntervalSeconds(value: unknown, fallback = 15) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(5, Math.min(3600, Math.trunc(parsed)))
}

function getNodeHeartbeatInterval(node: NodeRecord | null) {
  return normalizeIntervalSeconds(node?.heartbeatIntervalSeconds, 15)
}

function getNodeVersionPullInterval(node: NodeRecord | null) {
  return normalizeIntervalSeconds(node?.versionPullIntervalSeconds, 15)
}

const publishBlocked = computed(() => publishTemplateIds.value.length === 0)
const allPublishTemplatesSelected = computed(() => templates.value.length > 0 && publishTemplateIds.value.length === templates.value.length)
const sortedNodes = computed(() => sortByCreatedAtDesc(nodes.value))
const sortedTemplates = computed(() => sortByCreatedAtDesc(templates.value))
const sortedSubscriptions = computed(() => sortByCreatedAtDesc(subscriptions.value))
const dashboardNodes = computed(() => sortedNodes.value.slice(0, 5))

function getTemplatePortDisplay(template: TemplateRecord) {
  const defaults = template.defaults || {}
  const configuredPort = Number((defaults as Record<string, unknown>).serverPort ?? (defaults as Record<string, unknown>).port)
  if (Number.isFinite(configuredPort) && configuredPort > 0) {
    return String(Math.trunc(configuredPort))
  }
  if (template.protocol === 'wireguard') return String(defaultWireguardPort)
  return template.tlsMode === 'none' ? '80' : '443'
}

function getWarpLabel(n: NodeRecord) {
  const warpIpv4 = (n.warpIpv4 || '').trim()
  if (warpIpv4) return warpIpv4
  const warpIpv6 = (n.warpIpv6 || '').trim()
  if (warpIpv6) return warpIpv6
  const accountType = (n.warpAccountType || '').trim()
  if (accountType) return accountType
  return '---'
}

function getArgoStatusText(n: NodeRecord) {
  const argoStatus = (n.argoStatus || '').trim().toLowerCase()
  if (argoStatus.includes('running')) return 'Running'
  if (argoStatus.includes('installed')) return 'Installed'
  return 'Not Installed'
}

function isArgoRunning(n: NodeRecord) {
  const argoStatus = (n.argoStatus || '').toLowerCase()
  return argoStatus.includes('running')
}

function getStorageUsage(n: NodeRecord) {
  const total = Number(n.storageTotalBytes || 0)
  const used = Number(n.storageUsedBytes || 0)
  if (total <= 0) return '-'
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function timeAgo(d: string|null) {
  if (!d) return '从未'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return s + '秒前'
  if (s < 3600) return Math.floor(s/60) + 'm ago'
  if (s < 86400) return Math.floor(s/3600) + 'h ago'
  return Math.floor(s/86400) + '天前'
}

function formatDateTime(d: string | null) {
  if (!d) return '从未'
  const date = new Date(d)
  if (!Number.isFinite(date.getTime())) return '从未'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function isPage(page: 'dashboard'|'nodes'|'templates'|'subscriptions') {
  return currentPage.value === page
}

watch(
  [
    showPublishRelease,
    () => publishNode.value?.id || '',
    () => publishTemplateIds.value.join(','),
    publishMessage,
  ],
  ([visible]) => {
    if (!visible) return
    void loadPublishPreview()
  },
)

watch(uiTheme, (theme) => {
  applyTheme(theme)
}, { immediate: true })

const onlineCount = computed(() => nodes.value.filter(isOnline).length)

onMounted(() => {
  applyTheme(uiTheme.value)
  void initializePanel()
})
</script>

<template>
  <div class="theme-root" :data-theme="uiTheme">
  <!-- Toast -->
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span class="toast-message">{{ t.msg }}</span>
      <button class="toast-close" @click="toasts = toasts.filter(x=>x.id!==t.id)">×</button>
    </div>
  </div>

  <!-- Login -->
  <div v-if="!panelAuthenticated" class="login-page">
    <div class="login-card">
      <div class="theme-switcher login-theme-switcher">
        <button class="theme-chip" :class="{active: uiTheme==='legacy'}" @click="setUiTheme('legacy')">浅色</button>
        <button class="theme-chip" :class="{active: uiTheme==='midnight'}" @click="setUiTheme('midnight')">深色</button>
      </div>
      <div class="login-logo-row">
        <div class="login-logo">
          <img class="brand-logo-image" :src="nodehubIcon" alt="NodeHub" />
        </div>
        <div class="login-brand-name">NodeHub</div>
      </div>
      <p class="login-description">节点管理控制台</p>

      <div v-if="!panelReady" class="backend-panel login-backend-panel">
        <div class="backend-panel-title">面板访问</div>
        <p class="backend-form-hint">正在检查 Pages Functions 会话...</p>
      </div>

      <form v-else-if="!panelAuthenticated" @submit.prevent="unlockPanel">
        <div class="form-group">
          <label class="form-label">面板密码</label>
          <input class="form-input" type="password" v-model="panelPassword" placeholder="请输入 Pages Functions 中配置的密码" autofocus />
        </div>
        <p class="backend-form-hint" style="margin-bottom:12px">解锁后即可从 KV 加载和保存后端配置。</p>
        <p v-if="panelError" style="color:var(--color-danger);font-size:12px;margin-bottom:12px">{{ panelError }}</p>
        <button class="btn btn-primary w-full" type="submit" :disabled="panelLoading">
          {{ panelLoading ? '正在解锁...' : '解锁面板' }}
        </button>
      </form>
    </div>
  </div>

  <!-- Dashboard Layout -->
  <div v-else class="app-layout">
    <!-- Sidebar -->
    <aside class="app-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <img class="brand-logo-image" :src="nodehubIcon" alt="NodeHub" />
        </div>
        <div>
          <div class="sidebar-title">NodeHub</div>
          <div class="sidebar-version">v{{ status?.appVersion || '0.1.0' }}</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section-label">概览</div>
        <div class="nav-item" :class="{active: currentPage==='dashboard'}" @click="currentPage='dashboard'">
          <span class="nav-icon">📊</span><span>仪表盘</span>
        </div>
        <div class="nav-section-label">管理</div>
        <div class="nav-item" :class="{active: currentPage==='nodes'}" @click="currentPage='nodes'">
          <span class="nav-icon">🖥️</span><span>节点</span>
          <span class="nav-badge">{{ nodes.length }}</span>
        </div>
        <div class="nav-item" :class="{active: currentPage==='templates'}" @click="currentPage='templates'">
          <span class="nav-icon">📋</span><span>模板</span>
          <span class="nav-badge">{{ templates.length }}</span>
        </div>
        <div class="nav-item" :class="{active: currentPage==='subscriptions'}" @click="currentPage='subscriptions'">
          <span class="nav-icon">🔗</span><span>订阅</span>
          <span class="nav-badge">{{ subscriptions.length }}</span>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="backend-panel sidebar-backend-panel">
          <div class="backend-panel-header">
            <div>
              <div class="backend-panel-title">当前后端</div>
              <div class="backend-panel-meta">{{ currentBackend?.name || '未选择后端' }}</div>
            </div>
            <div class="backend-panel-actions">
              <button class="btn btn-secondary btn-xs" type="button" @click="openCreateBackendModal">新增</button>
              <button class="btn btn-secondary btn-xs" type="button" :disabled="!currentBackend" @click="openEditBackendModal()">编辑</button>
            </div>
          </div>
          <div class="backend-panel-base">{{ getBackendBaseLabel(currentBackend) }}</div>
          <select class="form-select backend-select" :value="currentBackendId" :disabled="backendProfilesLoading || backendProfiles.length === 0" @change="onBackendSelectionChange(($event.target as HTMLSelectElement).value)">
            <option v-if="backendProfiles.length === 0" value="">请先添加后端配置</option>
            <option v-for="profile in backendProfiles" :key="profile.id" :value="profile.id">{{ getBackendOptionLabel(profile) }}</option>
          </select>
          <p v-if="panelError" class="backend-form-hint" style="margin-top:10px;color:var(--color-danger)">{{ panelError }}</p>
        </div>
        <div class="sidebar-mode-badge" :class="status?.mode||'docker'">
          {{ status?.mode === 'cloudflare' ? 'Cloudflare 模式' : 'Docker 模式' }}
        </div>
        <div class="theme-switcher sidebar-theme-switcher">
          <button class="theme-chip" :class="{active: uiTheme==='legacy'}" @click="setUiTheme('legacy')">浅色</button>
          <button class="theme-chip" :class="{active: uiTheme==='midnight'}" @click="setUiTheme('midnight')">深色</button>
        </div>
        <button class="btn btn-ghost btn-sm mt-md" @click="logout" style="width:100%;justify-content:flex-start;gap:8px">
          <span>断开当前后端</span>
        </button>
        <button class="btn btn-ghost btn-sm" @click="logoutPanel" style="width:100%;justify-content:flex-start;gap:8px">
          <span>锁定面板</span>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="app-main">
      <div class="app-content">
        <div v-if="!loggedIn" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div>
                <h1 class="page-title">{{ backendProfilesLoading ? '正在加载后端' : currentBackend ? '连接后端' : '后端配置' }}</h1>
                <p class="page-subtitle">
                  {{
                    backendProfilesLoading
                      ? '正在从 KV 加载后端配置。'
                      : currentBackend
                        ? `面板已解锁，默认已选中 ${currentBackend.name}。`
                        : 'KV 中还没有保存任何后端配置。你现在可以暂时不连接后端，稍后再添加。'
                  }}
                </p>
              </div>
            </div>
          </div>

          <div class="card connection-state-card">
            <div v-if="backendProfilesLoading" class="empty-state">
              <div class="empty-state-icon">...</div>
              <div class="empty-state-title">正在加载后端配置</div>
              <div class="empty-state-text">请稍候，面板正在从 KV 读取已保存的后端。</div>
            </div>

            <div v-else-if="!currentBackend" class="empty-state">
              <div class="empty-state-icon">+</div>
              <div class="empty-state-title">还没有后端配置</div>
              <div class="empty-state-text">面板已经解锁。等你准备好之后，再添加第一个后端即可。</div>
              <button class="btn btn-primary" type="button" @click="openCreateBackendModal">添加后端</button>
            </div>

            <template v-else>
              <div class="card-header">
                <div>
                  <div class="card-title">{{ currentBackend.name }}</div>
                  <div class="card-subtitle">{{ getBackendBaseLabel(currentBackend) }}</div>
                </div>
                <div class="backend-panel-actions">
                  <button class="btn btn-secondary btn-xs" type="button" @click="openCreateBackendModal">新增</button>
                  <button class="btn btn-secondary btn-xs" type="button" @click="openEditBackendModal()">编辑</button>
                </div>
              </div>

              <form @submit.prevent="login">
                <div class="form-group">
                  <label class="form-label">管理密钥</label>
                  <input class="form-input" type="password" v-model="adminKey" placeholder="请输入当前后端的管理密钥" autofocus />
                </div>
                <p class="backend-form-hint" style="margin-bottom:12px">
                  现在切换后端时会停留在主工作区。如果这个后端已经保存过密钥，可以直接连接。
                </p>
                <p v-if="error" style="color:var(--color-danger);font-size:12px;margin-bottom:12px">{{ error }}</p>
                <div class="connection-state-actions">
                  <button class="btn btn-primary" type="submit" :disabled="loading">
                    {{ loading ? '正在连接...' : '连接后端' }}
                  </button>
                  <button class="btn btn-secondary" type="button" @click="openCreateBackendModal">管理后端</button>
                </div>
              </form>
            </template>
          </div>
        </div>

        <template v-else>

        <!-- Dashboard Page -->
        <div v-if="currentPage==='dashboard'" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">仪表盘</h1><p class="page-subtitle">{{ currentBackend?.name || '未命名后端' }} · {{ getBackendBaseLabel(currentBackend) }}</p></div>
              <button class="btn btn-secondary" @click="loadAll();refreshStatus()">刷新</button>
            </div>
          </div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-card-icon accent">🖥️</div>
              <div class="stat-value">{{ status?.summary.nodeCount ?? 0 }}</div>
              <div class="stat-label">节点总数</div>
              <div class="stat-glow accent"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon success">🟢</div>
              <div class="stat-value">{{ onlineCount }}</div>
              <div class="stat-label">在线节点</div>
              <div class="stat-glow success"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon info">📋</div>
              <div class="stat-value">{{ status?.summary.templateCount ?? 0 }}</div>
              <div class="stat-label">模板数量</div>
              <div class="stat-glow info"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon warning">📦</div>
              <div class="stat-value">{{ status?.summary.releaseCount ?? 0 }}</div>
              <div class="stat-label">发布次数</div>
              <div class="stat-glow warning"></div>
            </div>
          </div>
          <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
            <div class="card">
              <div class="card-header"><span class="card-title">入站流量</span></div>
              <div class="stat-value" style="font-size:22px">{{ formatBytes(status?.summary.totalBytesIn ?? 0) }}</div>
              <div class="stat-label">总入站流量</div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">出站流量</span></div>
              <div class="stat-value" style="font-size:22px">{{ formatBytes(status?.summary.totalBytesOut ?? 0) }}</div>
              <div class="stat-label">总出站流量</div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">数据库</span></div>
              <div class="stat-value" style="font-size:22px">{{ status?.databaseDriver ?? '-' }}</div>
              <div class="stat-label">{{ status?.artifactDriver ?? '-' }} 制品存储</div>
            </div>
          </div>
          <!-- Recent Nodes -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">最近节点</span>
              <button class="btn btn-sm btn-secondary" @click="currentPage='nodes'">查看全部 →</button>
            </div>
            <div class="table-wrapper" style="border:none;background:transparent">
              <table class="data-table node-table">
                <thead><tr>
                  <th>名称</th><th>类型</th><th>版本</th><th>地区</th><th>域名/Argo</th><th>最后在线</th><th>WARP IPv6</th><th>连接数</th><th>流量</th>
                </tr></thead>
                <tbody>
                  <tr v-for="n in dashboardNodes" :key="n.id" class="cursor-pointer" @click="selectNode(n)">
                    <td class="node-name" :class="isOnline(n) ? 'online' : 'offline'">{{ n.name }}</td>
                    <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                    <td>
                      <button
                        type="button"
                        class="release-revision"
                        :class="getNodeVersionToneClass(n)"
                        :disabled="getNodeVersionLabel(n) === '---'"
                        @click.stop="openNodeReleaseLog(n)"
                      >
                        {{ getNodeVersionLabel(n) }}
                      </button>
                    </td>
                    <td>{{ n.region || '-' }}</td>
                    <td class="text-mono truncate">{{ getNodeDomainDisplay(n) }}</td>
                    <td class="text-muted" :title="formatDateTime(n.lastSeenAt)">{{ formatDateTime(n.lastSeenAt) }}</td>
                    <td class="text-mono">{{ getWarpLabel(n) }}</td>
                    <td>{{ n.currentConnections }}</td>
                    <td class="text-muted" style="font-size:12px">↑{{ formatBytes(n.bytesOutTotal) }} ↓{{ formatBytes(n.bytesInTotal) }}</td>
                  </tr>
                  <tr v-if="dashboardNodes.length===0"><td colspan="9" class="text-center text-muted" style="padding:32px">暂无节点</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Nodes Page -->
        <div v-if="isPage('nodes')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">节点管理</h1><p class="page-subtitle">管理您的代理节点</p></div>
              <button class="btn btn-primary" @click="showCreateNode=true">+ 添加节点</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table node-table">
              <thead><tr>
                <th>名称</th><th>类型</th><th>版本</th><th>地区</th><th>域名/Argo</th><th>最后在线</th><th>WARP IPv6</th><th>连接数</th><th>流量</th><th>操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="n in sortedNodes" :key="n.id" class="cursor-pointer" @click="selectNode(n)">
                  <td class="node-name" :class="isOnline(n) ? 'online' : 'offline'">{{ n.name }}</td>
                  <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                  <td>
                    <button
                      type="button"
                      class="release-revision"
                      :class="getNodeVersionToneClass(n)"
                      :disabled="getNodeVersionLabel(n) === '---'"
                      @click.stop="openNodeReleaseLog(n)"
                    >
                      {{ getNodeVersionLabel(n) }}
                    </button>
                  </td>
                  <td>{{ n.region || '-' }}</td>
                  <td class="text-mono truncate">{{ getNodeDomainDisplay(n) }}</td>
                  <td class="text-muted" :title="`${timeAgo(n.lastSeenAt)} · ${formatDateTime(n.lastSeenAt)}`">{{ formatDateTime(n.lastSeenAt) }}</td>
                  <td class="text-mono">{{ getWarpLabel(n) }}</td>
                  <td>{{ n.currentConnections }}</td>
                  <td class="text-muted" style="font-size:12px">↑{{ formatBytes(n.bytesOutTotal) }} ↓{{ formatBytes(n.bytesInTotal) }}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-sm btn-secondary" @click.stop="openPublishRelease(n)">发布</button>
                      <button class="btn btn-sm btn-danger" @click.stop="deleteNodeById(n.id, n.name)">删除</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="nodes.length===0"><td colspan="10"><div class="empty-state"><div class="empty-state-icon">🖥️</div><div class="empty-state-title">暂无节点</div><div class="empty-state-text">添加您的第一个代理节点以开始使用</div><button class="btn btn-primary" @click="showCreateNode=true">+ 添加节点</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Templates Page -->
        <div v-if="isPage('templates')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">模板管理</h1><p class="page-subtitle">协议配置模板</p></div>
              <button class="btn btn-primary" @click="openCreateTemplate">+ 添加模板</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>名称</th><th>引擎</th><th>协议</th><th>传输</th><th>端口</th><th>TLS</th><th>WARP</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="t in sortedTemplates" :key="t.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ t.name }}</td>
                  <td><span class="tag" :class="{accent:t.engine==='sing-box'}">{{ t.engine }}</span></td>
                  <td>{{ t.protocol }}</td>
                  <td>{{ t.transport }}</td>
                  <td class="text-mono">{{ getTemplatePortDisplay(t) }}</td>
                  <td><span class="status-badge" :class="t.tlsMode==='reality'?'applying':t.tlsMode==='tls'?'healthy':'offline'">{{ t.tlsMode }}</span></td>
                  <td><span class="tag" :class="{accent:t.warpExit}">{{ t.warpExit ? `on/${t.warpRouteMode}` : 'off' }}</span></td>
                  <td class="text-muted">{{ timeAgo(t.createdAt) }}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-sm btn-secondary" @click="openEditTemplate(t)">编辑</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="templates.length===0"><td colspan="9"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">暂无模板</div><div class="empty-state-text">创建协议模板来配置您的节点</div><button class="btn btn-primary" @click="openCreateTemplate">+ 添加模板</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Subscriptions Page -->
        <div v-if="isPage('subscriptions')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">订阅管理</h1><p class="page-subtitle">管理订阅端点</p></div>
              <button class="btn btn-primary" @click="openCreateSubscription">+ 添加订阅</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>名称</th><th>令牌</th><th>状态</th><th>可见节点</th><th>创建时间</th><th>订阅地址</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="s in sortedSubscriptions" :key="s.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ s.name }}</td>
                  <td class="text-mono truncate">{{ s.token }}</td>
                  <td><span class="status-badge" :class="s.enabled?'online':'offline'"><span class="status-dot"></span>{{ s.enabled ? 'Enabled' : 'Disabled' }}</span></td>
                  <td>{{ getSubscriptionVisibleNodesLabel(s) }}</td>
                  <td class="text-muted">{{ timeAgo(s.createdAt) }}</td>
                  <td>
                    <div class="sub-url-actions">
                      <button class="btn btn-xs btn-secondary" @click="openSubscriptionQr(s, 'v2ray', 'V2Ray')" title="复制并显示 V2Ray 订阅二维码">V2Ray</button>
                      <button class="btn btn-xs btn-secondary" @click="openSubscriptionQr(s, 'clash', 'Clash')" title="复制并显示 Clash 订阅二维码">Clash</button>
                      <button class="btn btn-xs btn-secondary" @click="openSubscriptionQr(s, 'singbox', 'SingBox')" title="复制并显示 Sing-Box 订阅二维码">SingBox</button>
                      <button class="btn btn-xs btn-secondary" @click="openSubscriptionQr(s, 'wireguard', 'WireGuard')" title="复制并显示 WireGuard 订阅链接">WireGuard</button>
                      <button class="btn btn-xs btn-ghost" @click="openSubscriptionQr(s, 'plain', '通用')" title="复制并显示通用订阅二维码">通用</button>
                    </div>
                  </td>
                  <td><button class="btn btn-xs btn-secondary" @click="openEditSubscription(s)">编辑</button></td>
                </tr>
                <tr v-if="subscriptions.length===0"><td colspan="7"><div class="empty-state"><div class="empty-state-icon">🔗</div><div class="empty-state-title">暂无订阅</div><div class="empty-state-text">创建订阅以供客户端访问</div><button class="btn btn-primary" @click="openCreateSubscription">+ 添加订阅</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        </template>
      </div>
    </main>

    <div v-if="showBackendModal" class="modal-overlay" @mousedown.self="closeBackendModal">
      <div class="modal-content" style="max-width:520px">
        <div class="modal-header">
          <h3 class="modal-title">{{ editingBackendId ? '编辑后端' : '添加后端' }}</h3>
          <button class="modal-close-btn" @click="closeBackendModal">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">名称 *</label>
            <input class="form-input" v-model="backendDraft.name" placeholder="例如 东京 CF Worker / Docker-HK" />
          </div>
          <div class="form-group">
            <label class="form-label">API 基础地址</label>
            <input class="form-input" v-model="backendDraft.apiBaseUrl" placeholder="留空表示当前站点同源，例如 https://api.example.com" />
          </div>
          <div class="form-group">
            <label class="form-label">管理密钥</label>
            <input class="form-input" type="password" v-model="backendDraft.adminKey" placeholder="可选，保存后切换时会自动填入" />
          </div>
          <p class="backend-form-hint">支持 Docker/Node、Cloudflare Worker，或任何兼容当前 API 协议的后端。</p>
        </div>
        <div class="modal-footer" :style="{ justifyContent: editingBackendId && backendProfiles.length > 1 ? 'space-between' : 'flex-end' }">
          <button
            v-if="editingBackendId && backendProfiles.length > 1"
            class="btn btn-danger"
            style="--btn-bg:var(--color-danger);--btn-hover:var(--color-danger)"
            @click="deleteCurrentBackendProfile"
          >
            删除后端
          </button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" @click="closeBackendModal">取消</button>
            <button class="btn btn-primary" @click="submitBackendProfile">{{ editingBackendId ? '保存' : '添加并切换' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Node Detail Panel -->
    <template v-if="selectedNode">
      <div class="detail-overlay" @mousedown="selectedNode=null"></div>
      <aside class="detail-panel">
        <div class="detail-panel-header">
          <h2 style="font-size:16px;font-weight:700">{{ selectedNode.name }}</h2>
          <button class="modal-close-btn" @click="selectedNode=null">×</button>
        </div>
        <div class="detail-panel-body">
          <div class="detail-section">
            <div class="detail-section-title">基本信息</div>
            <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value text-mono">{{ selectedNode.id }}</span></div>
            <div class="detail-row"><span class="detail-label">类型</span><span class="detail-value"><span class="tag" :class="{accent:selectedNode.nodeType==='edge'}">{{ selectedNode.nodeType }}</span></span></div>
            <div class="detail-row"><span class="detail-label">地区</span><span class="detail-value">{{ selectedNode.region || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">网络类型</span><span class="detail-value"><span class="tag" :class="{accent:selectedNode.networkType==='noPublicIp'}">{{ selectedNode.networkType === 'noPublicIp' ? '无公网IP (Argo)' : '有公网IP' }}</span></span></div>
            <div class="detail-row"><span class="detail-label">主域名</span><span class="detail-value text-mono">{{ selectedNode.primaryDomain || '-' }}</span></div>
            <div class="detail-row" v-if="selectedNode.backupDomain"><span class="detail-label">备域名</span><span class="detail-value text-mono">{{ selectedNode.backupDomain }}</span></div>
            <div class="detail-row"><span class="detail-label">入口 IP</span><span class="detail-value text-mono">{{ selectedNode.entryIp || '-' }}</span></div>
            <div class="detail-row" v-if="selectedNode.argoTunnelDomain"><span class="detail-label">Argo 域名</span><span class="detail-value text-mono">{{ selectedNode.argoTunnelDomain }}</span></div>
            <div class="detail-row"><span class="detail-label">状态</span><span class="detail-value"><span class="status-badge" :class="isOnline(selectedNode)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(selectedNode)?'在线':'离线' }}</span></span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">运行与网络</div>
            <div class="detail-row"><span class="detail-label">权限</span><span class="detail-value">{{ getNodePermissionText(selectedNode) }}</span></div>
            <div class="detail-row"><span class="detail-label">sing-box</span><span class="detail-value text-mono">{{ getRuntimeKernelText(selectedNode, 'sing-box') }}</span></div>
            <div class="detail-row"><span class="detail-label">xray</span><span class="detail-value text-mono">{{ getRuntimeKernelText(selectedNode, 'xray') }}</span></div>
            <div class="detail-row"><span class="detail-label">心跳间隔</span><span class="detail-value">{{ getNodeHeartbeatInterval(selectedNode) }} 秒</span></div>
            <div class="detail-row"><span class="detail-label">拉取版本间隔</span><span class="detail-value">{{ getNodeVersionPullInterval(selectedNode) }} 秒</span></div>
            <div class="detail-row">
              <span class="detail-label">WARP</span>
              <span class="detail-value">
                <span class="warp-badge" :class="isWarpRunning(selectedNode) ? 'online' : 'offline'">{{ getWarpStatusText(selectedNode) }}</span>
              </span>
            </div>
            <div class="detail-row"><span class="detail-label">WARP IPv4</span><span class="detail-value text-mono">{{ selectedNode.warpIpv4 || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">WARP IPv6</span><span class="detail-value text-mono">{{ selectedNode.warpIpv6 || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">WARP Endpoint</span><span class="detail-value text-mono">{{ selectedNode.warpEndpoint || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">WARP Account</span><span class="detail-value">{{ getWarpAccountTypeText(selectedNode) }}</span></div>
            <div class="detail-row"><span class="detail-label">WARP Tunnel</span><span class="detail-value">{{ getWarpTunnelProtocolText(selectedNode) }}</span></div>
            <div class="detail-row">
              <span class="detail-label">Argo</span>
              <span class="detail-value">
                <span class="warp-badge" :class="isArgoRunning(selectedNode) ? 'online' : 'offline'">{{ getArgoStatusText(selectedNode) }}</span>
              </span>
            </div>
            <div class="detail-row"><span class="detail-label">Argo Domain</span><span class="detail-value text-mono">{{ selectedNode.argoDomain || selectedNode.argoTunnelDomain || '-' }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">心跳上报</div>
            <div class="detail-row"><span class="detail-label">最近心跳</span><span class="detail-value">{{ timeAgo(selectedNode.lastSeenAt) }}</span></div>
            <div class="detail-row"><span class="detail-label">最后在线时间</span><span class="detail-value">{{ formatDateTime(selectedNode.lastSeenAt) }}</span></div>
            <div class="detail-row"><span class="detail-label">CPU</span><span class="detail-value">{{ getCpuMetricText(selectedNode) }}</span></div>
            <div v-if="getCpuUsagePercent(selectedNode) !== null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="getProgressTone(getCpuUsagePercent(selectedNode))" :style="{width:getCpuUsagePercent(selectedNode)+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">内存</span><span class="detail-value">{{ getMemoryMetricText(selectedNode) }}</span></div>
            <div v-if="getMemoryUsagePercent(selectedNode) !== null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="getProgressTone(getMemoryUsagePercent(selectedNode))" :style="{width:getMemoryUsagePercent(selectedNode)+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">存储</span><span class="detail-value">{{ getStorageMetricText(selectedNode) }}</span></div>
            <div v-if="getStorageUsagePercent(selectedNode) !== null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="getProgressTone(getStorageUsagePercent(selectedNode))" :style="{width:getStorageUsagePercent(selectedNode)+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">连接数</span><span class="detail-value">{{ selectedNode.currentConnections }}</span></div>
            <div class="detail-row"><span class="detail-label">入站流量</span><span class="detail-value">{{ formatBytes(selectedNode.bytesInTotal) }}</span></div>
            <div class="detail-row"><span class="detail-label">出站流量</span><span class="detail-value">{{ formatBytes(selectedNode.bytesOutTotal) }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">发布记录 ({{ nodeReleases.length }})</div>
            <div class="text-muted" style="margin-bottom:8px;font-size:12px">点击版本号可查看该版本的应用日志。</div>
            <div v-for="r in nodeReleases.slice(0,5)" :key="r.id" class="card mb-md" style="padding:12px">
              <div class="flex items-center justify-between gap-sm">
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  style="padding:0;font-weight:600;font-size:13px"
                  @click.stop="openReleaseLog(selectedNode, r.id)"
                >
                  版本 #{{ r.revision }}
                </button>
                <span class="status-badge" :class="getReleaseStatusClass(r.status)">{{ getReleaseStatusText(r.status) }}</span>
              </div>
              <div class="text-muted" style="font-size:11px;margin-top:4px">{{ r.kind }} · {{ timeAgo(r.createdAt) }}</div>
              <div v-if="r.summary" style="font-size:12px;margin-top:4px;color:var(--color-text-secondary)">{{ r.summary }}</div>
            </div>
            <div v-if="nodeReleases.length===0" class="text-muted text-center" style="padding:16px;font-size:12px">暂无发布记录</div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">部署命令</div>
            <div class="text-muted" style="margin-bottom:8px;font-size:12px">
              一行命令安装并启动 agent。远端安装脚本会按网络类型执行必选初始化：有公网 IP 安装证书，无公网 IP 安装 Argo，并输出关键进度。
            </div>
            <button v-if="!deployCommand" class="btn btn-secondary btn-sm w-full" @click="loadDeployCommand">生成部署命令</button>
            <div v-else>
              <div class="code-block command-block" style="max-height:120px;font-size:11px">{{ deployCommand }}</div>
              <button class="btn btn-sm btn-primary mt-md w-full" @click="copyToClipboard(deployCommand)">📋 复制部署命令</button>
            </div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">一键卸载</div>
            <button v-if="!uninstallCommand" class="btn btn-danger btn-sm w-full" style="--btn-bg:var(--color-danger);--btn-hover:var(--color-danger)" @click="loadUninstallCommand">生成卸载命令</button>
            <div v-else>
              <div class="code-block command-block" style="max-height:120px;font-size:11px">{{ uninstallCommand }}</div>
              <button class="btn btn-sm btn-primary mt-md w-full" @click="copyToClipboard(uninstallCommand)">📋 复制卸载命令</button>
            </div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">检查命令</div>
            <div class="text-muted" style="margin-bottom:8px;font-size:12px">
              下列命令均为单行命令，可整行复制到 VPS 直接执行。
            </div>
            <div v-for="item in getNodeCheckCommands(selectedNode)" :key="item.title" class="card mb-md" style="padding:12px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                <div>
                  <div style="font-size:13px;font-weight:700">{{ item.title }}</div>
                  <div class="text-muted" style="margin-top:4px;font-size:12px">{{ item.description }}</div>
                </div>
                <button class="btn btn-secondary btn-xs" @click="copyToClipboard(item.command)">复制</button>
              </div>
              <div class="code-block command-block" style="margin-top:10px;max-height:180px;font-size:11px">{{ item.command }}</div>
            </div>
          </div>
        </div>
      </aside>
    </template>

    <div v-if="showReleaseLog" class="modal-overlay" @mousedown.self="closeReleaseLog">
      <div class="modal-content" style="max-width:880px">
        <div class="modal-header">
          <h3 class="modal-title">版本应用日志</h3>
          <button class="modal-close-btn" @click="closeReleaseLog">×</button>
        </div>
        <div class="modal-body" style="display:grid;gap:16px">
          <div v-if="releaseLogLoading" class="text-muted">日志加载中...</div>
          <template v-else-if="selectedReleaseLog">
            <div class="card" style="padding:14px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                <div>
                  <div style="font-size:15px;font-weight:700">{{ selectedReleaseLogNode?.name || '-' }} / r{{ selectedReleaseLog.revision }}</div>
                  <div class="text-muted text-mono" style="margin-top:4px">{{ selectedReleaseLog.id }}</div>
                </div>
                <span class="status-badge" :class="getReleaseStatusClass(selectedReleaseLog.status)">{{ getReleaseStatusText(selectedReleaseLog.status) }}</span>
              </div>
              <div class="text-muted" style="margin-top:8px;font-size:12px">{{ selectedReleaseLog.kind }} · {{ timeAgo(selectedReleaseLog.createdAt) }}</div>
              <div v-if="selectedReleaseLog.summary" style="margin-top:8px;font-size:12px;color:var(--color-text-secondary)">{{ selectedReleaseLog.summary }}</div>
              <div class="detail-row" style="margin-top:12px"><span class="detail-label">结果消息</span><span class="detail-value">{{ selectedReleaseLog.message || '-' }}</span></div>
              <div class="detail-row"><span class="detail-label">日志状态</span><span class="detail-value"><span class="status-badge" :class="getReleaseStatusClass(selectedReleaseLog.applyLogStatus)">{{ getReleaseStatusText(selectedReleaseLog.applyLogStatus) }}</span></span></div>
              <div class="detail-row"><span class="detail-label">日志更新时间</span><span class="detail-value">{{ selectedReleaseLog.applyLogUpdatedAt ? `${timeAgo(selectedReleaseLog.applyLogUpdatedAt)} (${selectedReleaseLog.applyLogUpdatedAt})` : '-' }}</span></div>
            </div>
            <div class="form-group">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
                <label class="form-label" style="margin:0">应用日志</label>
                <button class="btn btn-secondary btn-xs" :disabled="!selectedReleaseLog.applyLog" @click="copyToClipboard(selectedReleaseLog.applyLog)">复制日志</button>
              </div>
              <pre class="code-block" style="max-height:460px;overflow:auto;font-size:11px;white-space:pre-wrap">{{ selectedReleaseLog.applyLog || '暂无应用日志。只有 agent 实际开始应用该版本后，这里才会记录覆盖式日志。' }}</pre>
            </div>
          </template>
          <div v-else class="text-muted">未找到版本日志。</div>
        </div>
      </div>
    </div>

    <!-- Publish Release Modal -->
    <div v-if="showPublishRelease" class="modal-overlay" @mousedown.self="closePublishRelease">
      <div class="modal-content publish-release-modal">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">发布节点版本</h3>
            <div v-if="publishNode" class="text-muted" style="margin-top:4px;font-size:12px">{{ publishNode.name }}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn btn-secondary btn-sm" @click="closePublishRelease">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="publishingRelease || publishBlocked" @click="publishSelectedRelease">
              {{ publishingRelease ? '发布中...' : '确认发布' }}
            </button>
            <button class="modal-close-btn" @click="closePublishRelease">×</button>
          </div>
        </div>
        <div class="modal-body" style="display:grid;gap:16px">
          <template v-if="publishNode">
            <div class="form-group">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
                <label class="form-label" style="margin:0">模板选择</label>
                <button
                  v-if="templates.length"
                  type="button"
                  class="btn btn-xs btn-secondary"
                  @click="toggleAllPublishTemplates"
                >
                  {{ allPublishTemplatesSelected ? '取消全选' : '全选' }}
                </button>
              </div>
              <div v-if="templates.length===0" class="empty-state" style="padding:20px 12px">
                <div class="empty-state-title">暂无模板</div>
                <div class="empty-state-text" style="margin-bottom:0">请先创建协议模板。</div>
              </div>
              <div v-else class="publish-template-list">
                <label
                  v-for="template in sortedTemplates"
                  :key="template.id"
                  class="publish-template-row"
                  
                >
                  <input
                    type="checkbox"
                    class="form-checkbox"
                    :checked="publishTemplateIds.includes(template.id)"
                    
                    @change="togglePublishTemplate(template.id)"
                  />
                  <div class="publish-template-copy">
                    <div class="publish-template-name">{{ template.name }}</div>
                    <div class="publish-template-meta">{{ template.engine }} / {{ template.protocol }} / {{ template.transport }} / {{ template.tlsMode }}</div>
                  </div>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">配置预览</label>
              <div class="publish-preview">
                <div v-if="publishPreviewLoading" class="text-muted">预览生成中...</div>
                <div v-else-if="publishPreviewError" class="publish-preview-error">{{ publishPreviewError }}</div>
                <div v-else-if="publishPreview">
                  <div v-for="runtime in publishPreview.runtimePlans" :key="runtime.engine" class="publish-preview-file">
                    <div class="publish-preview-meta">内核 {{ runtime.engine }} / 入口 {{ runtime.entryConfigPath }}</div>
                    <div v-for="file in runtime.files" :key="`${runtime.engine}:${file.path}`" class="publish-preview-file">
                      <div class="publish-preview-file-head">{{ file.path }}</div>
                      <pre class="code-block publish-preview-code">{{ file.content }}</pre>
                    </div>
                  </div>
                </div>
                <div v-else class="text-muted">选择模板后自动生成预览</div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Create Node Modal -->
    <div v-if="showCreateNode" class="modal-overlay" @mousedown.self="showCreateNode=false">
      <div class="modal-content" style="max-width:600px">
        <div class="modal-header"><h3 class="modal-title">新建节点</h3><button class="modal-close-btn" @click="showCreateNode=false">×</button></div>
        <div class="modal-body" style="max-height:60vh;overflow-y:auto">
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newNode.name" placeholder="例如 US-West-01" /></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">类型</label><select class="form-select" v-model="newNode.nodeType"><option value="vps">VPS</option><option value="edge">Edge</option></select></div>
            <div class="form-group"><label class="form-label">地区</label><input class="form-input" v-model="newNode.region" placeholder="例如 us-west" /></div>
          </div>

          <!-- GitHub Mirror -->
          <div class="form-section-divider">扩展选项</div>
          <div class="form-checkbox-group mb-md">
            <input type="checkbox" class="form-checkbox" v-model="newNode.useGithubMirror" id="github-mirror">
            <label for="github-mirror" class="form-label" style="margin:0">使用 GitHub 镜像</label>
          </div>
          <div v-if="newNode.useGithubMirror" class="form-group">
            <label class="form-label">GitHub 镜像地址</label>
            <input class="form-input" v-model="newNode.githubMirrorUrl" @blur="ensureGithubMirrorUrl" placeholder="默认 https://gh-proxy.org，可自定义" />
          </div>

          <div class="form-section-divider">部署参数</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">心跳间隔（秒）</label>
              <input class="form-input" type="number" min="5" max="3600" step="1" v-model.number="newNode.heartbeatIntervalSeconds" />
            </div>
            <div class="form-group">
              <label class="form-label">拉取版本间隔（秒）</label>
              <input class="form-input" type="number" min="5" max="3600" step="1" v-model.number="newNode.versionPullIntervalSeconds" />
            </div>
          </div>
          <div class="form-checkbox-group mb-md">
            <input type="checkbox" class="form-checkbox" v-model="newNode.installWarp" id="node-install-warp">
            <label for="node-install-warp" class="form-label" style="margin:0">首次部署时安装 WARP（本地代理模式）</label>
          </div>
          <div v-if="newNode.installWarp" class="form-group">
            <label class="form-label">WARP License Key</label>
            <input class="form-input" v-model="newNode.warpLicenseKey" placeholder="可选，填写后会在首次部署时一起注册" />
            <div class="text-muted" style="margin-top:8px;font-size:12px">安装脚本会把 WARP 配置为本地 SOCKS5 代理，监听 <span class="text-mono">127.0.0.1:{{ DEFAULT_WARP_LOCAL_PROXY_PORT }}</span>，不会接管整机默认路由。</div>
          </div>

          <div class="form-section-divider">服务器网络</div>
          <div class="form-group">
            <label class="form-label">网络类型</label>
            <select class="form-select" v-model="newNode.networkType">
              <option value="public">有公网 IP</option>
              <option value="noPublicIp">无公网 IP (Argo 隧道)</option>
            </select>
          </div>

          <!-- Public IP options -->
          <template v-if="newNode.networkType==='public'">
            <div class="form-group"><label class="form-label">主域名</label><input class="form-input" v-model="newNode.primaryDomain" placeholder="node.example.com" /></div>
            <div class="form-group"><label class="form-label">备域名</label><input class="form-input" v-model="newNode.backupDomain" placeholder="node2.example.com（可选）" /></div>
            <div class="form-group"><label class="form-label">入口 IP</label><input class="form-input" v-model="newNode.entryIp" placeholder="1.2.3.4" /></div>
            <div class="form-group">
              <label class="form-label">Cloudflare DNS API Token</label>
              <input class="form-input" v-model="newNode.cfDnsToken" placeholder="可选，用于自动签发真实证书；留空则回退为自签名证书" />
            </div>
          </template>

          <!-- No Public IP (Argo) options -->
          <template v-if="newNode.networkType==='noPublicIp'">
            <div class="form-group">
              <label class="form-label">Argo Tunnel Token</label>
              <input class="form-input" v-model="newNode.argoTunnelToken" placeholder="可选，绑定固定 Tunnel 时填写" />
            </div>
            <div class="form-group">
              <label class="form-label">隧道域名</label>
              <input class="form-input" v-model="newNode.argoTunnelDomain" placeholder="可选，例如 tunnel.example.com" />
            </div>
            <div class="form-group">
              <label class="form-label">回源端口</label>
              <input class="form-input" type="number" v-model.number="newNode.argoTunnelPort" placeholder="2053" />
            </div>
          </template>

        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateNode=false">取消</button><button class="btn btn-primary" @click="createNode">创建</button></div>
      </div>
    </div>

    <!-- Create Template Modal -->
    <div v-if="showCreateTemplate" class="modal-overlay" @mousedown.self="closeTemplateModal">
      <div class="modal-content" style="max-width:640px">
        <div class="modal-header"><h3 class="modal-title">{{ editingTemplateId ? '编辑模板' : '新建模板' }}</h3><button class="modal-close-btn" @click="closeTemplateModal">×</button></div>
        <div class="modal-body" style="max-height:60vh;overflow-y:auto">
          <!-- Presets -->
          <div v-if="catalogPresets.length" class="mb-lg">
            <label class="form-label">从预设快速创建</label>
            <div class="preset-grid">
              <button v-for="p in catalogPresets" :key="p.id" class="preset-btn" @click="applyPreset(p)" :title="p.notes">
                <span class="preset-btn-name">{{ p.name }}</span>
                <span class="preset-btn-meta">{{ p.engine }} · {{ p.protocol }}</span>
              </button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newTemplate.name" placeholder="例如 VLESS-WS-TLS" /></div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">引擎</label>
              <select class="form-select" v-model="newTemplate.engine">
                <option value="xray">Xray</option>
                <option value="sing-box">Sing-Box</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">协议</label>
              <select class="form-select" v-model="newTemplate.protocol">
                <option v-for="o in protocolOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">传输方式</label>
              <select class="form-select" v-model="newTemplate.transport">
                <option v-for="o in transportOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">TLS 模式</label>
              <select class="form-select" v-model="newTemplate.tlsMode">
                <option v-for="o in tlsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <!-- Dynamic default fields -->
          <div class="form-section-divider">协议参数</div>
          <datalist id="reality-sni-list">
            <option v-for="domain in sampleRealitySnis" :key="domain" :value="domain"></option>
          </datalist>
          
          <div v-for="field in templateDefaultFields" :key="field.key" class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center">
              <span>{{ field.label }}</span>
              <span style="display:flex;gap:6px;align-items:center">
                <template v-if="field.key === 'sni' && newTemplate.tlsMode === 'reality'">
                  <button type="button" class="btn btn-xs" :class="realitySniMode === 'random' ? 'btn-primary' : 'btn-secondary'" @click="setRealitySniMode('random')">随机站点</button>
                  <button type="button" class="btn btn-xs" :class="realitySniMode === 'manual' ? 'btn-primary' : 'btn-secondary'" @click="setRealitySniMode('manual')">手动输入</button>
                  <button v-if="realitySniMode === 'random'" type="button" class="btn btn-xs btn-secondary" @click="randomizeRealitySni()">换一个</button>
                </template>
                <button v-if="field.generator" type="button" class="btn btn-xs btn-secondary" @click="handleGenerate(field.generator)">
                  {{ field.generator === 'x25519' ? 'Generate Keypair' : 'Generate' }}
                </button>
              </span>
            </label>
            <select
              v-if="field.options?.length"
              class="form-select"
              :value="getTemplateDefaultDisplayValue(field.key)"
              @change="(e:any) => setTemplateDefaultValue(field.key, e.target.value, field.type)"
            >
              <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <input
              v-else
              class="form-input"
              :type="field.type || 'text'"
              :placeholder="field.placeholder"
              :list="field.list"
              :readonly="field.readonly === true"
              :value="getTemplateDefaultDisplayValue(field.key)"
              @input="(e:any) => setTemplateDefaultValue(field.key, e.target.value, field.type)"
            />
          </div>

          <div class="form-group"><label class="form-label">备注</label><textarea class="form-textarea" v-model="newTemplate.notes" placeholder="可选备注信息..."></textarea></div>

          <div class="form-section-divider">WARP 出口</div>
          <div class="form-checkbox-group mb-md">
            <input type="checkbox" class="form-checkbox" v-model="newTemplate.warpExit" id="template-warp-exit">
            <label for="template-warp-exit" class="form-label" style="margin:0">使用 WARP 作为出口</label>
          </div>
          <div v-if="newTemplate.warpExit" class="form-row">
            <div class="form-group">
              <label class="form-label">路由模式</label>
              <select class="form-select" v-model="newTemplate.warpRouteMode">
                <option value="all">全部流量 (IPv4+IPv6)</option>
                <option value="ipv4">仅 IPv4</option>
                <option value="ipv6">仅 IPv6</option>
              </select>
            </div>
          </div>
          <div v-if="newTemplate.warpExit" class="form-group">
            <div class="text-muted" style="margin-top:8px;font-size:12px">
              勾选后，该模板命中的流量会通过节点上的 WARP 本地 SOCKS5 代理 <span class="text-mono">127.0.0.1:{{ DEFAULT_WARP_LOCAL_PROXY_PORT }}</span> 出站，不再依赖 `CloudflareWARP` 系统网卡。
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button v-if="editingTemplateId" class="btn btn-danger" style="--btn-bg:var(--color-danger);--btn-hover:var(--color-danger)" @click="deleteEditingTemplate">删除模板</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" @click="closeTemplateModal">取消</button>
            <button class="btn btn-primary" @click="submitTemplate">{{ editingTemplateId ? '保存修改' : '创建' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Subscription QR Modal -->
    <div v-if="showSubscriptionQr" class="modal-overlay" @mousedown.self="closeSubscriptionQr">
      <div class="modal-content subscription-qr-modal">
        <div class="modal-header"><h3 class="modal-title">订阅二维码</h3><button class="modal-close-btn" @click="closeSubscriptionQr">×</button></div>
        <div class="modal-body subscription-qr-body">
          <div style="font-weight:600;text-align:center">{{ subscriptionQrTitle }}</div>
          <div class="text-muted text-mono" style="word-break:break-all;font-size:12px">{{ subscriptionQrUrl }}</div>
          <div v-if="subscriptionQrLoading" class="text-muted">二维码生成中...</div>
          <img v-else-if="subscriptionQrDataUrl" :src="subscriptionQrDataUrl" alt="subscription qr" class="subscription-qr-image" />
        </div>
      </div>
    </div>

    <!-- Create Subscription Modal -->
    <div v-if="showCreateSub" class="modal-overlay" @mousedown.self="closeSubscriptionModal">
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">{{ editingSubscriptionId ? '编辑订阅' : '新建订阅' }}</h3><button class="modal-close-btn" @click="closeSubscriptionModal">×</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newSub.name" placeholder="e.g. Primary Subscription" /></div>
          <div class="form-checkbox-group mb-md"><input type="checkbox" class="form-checkbox" v-model="newSub.enabled" id="sub-en"><label for="sub-en" class="form-label" style="margin:0">启用</label></div>
          <div class="form-group" v-if="nodes.length">
            <label class="form-label">可见节点（留空表示全部）</label>
            <div class="subscription-visible-nodes">
              <label v-for="n in sortedNodes" :key="n.id" class="form-checkbox-group mb-md" style="cursor:pointer">
                <input type="checkbox" class="form-checkbox" :value="n.id" v-model="newSub.visibleNodeIds" />
                <span style="font-size:13px">{{ n.name }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button v-if="editingSubscriptionId" class="btn btn-danger" style="--btn-bg:var(--color-danger);--btn-hover:var(--color-danger)" @click="deleteEditingSubscription">删除订阅</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" @click="closeSubscriptionModal">取消</button>
            <button class="btn btn-primary" @click="submitSubscription">{{ editingSubscriptionId ? '保存修改' : '创建' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div>
</template>
