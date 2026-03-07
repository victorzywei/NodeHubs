<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import type { SystemStatus, NodeRecord, TemplateRecord, SubscriptionRecord, ReleaseRecord, ReleasePreviewRecord } from '@contracts/index'
import * as api from './lib/api'

// ---- State ----
const adminKey = ref(localStorage.getItem('nh_admin_key') || '')
const loggedIn = ref(false)
const currentPage = ref<'dashboard'|'nodes'|'templates'|'subscriptions'>('dashboard')
const loading = ref(false)
const error = ref('')

// Data
const status = ref<SystemStatus|null>(null)
const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const subscriptions = ref<SubscriptionRecord[]>([])

// Modals
const showCreateNode = ref(false)
const showCreateTemplate = ref(false)
const showCreateSub = ref(false)
const showPublishRelease = ref(false)
const selectedNode = ref<NodeRecord|null>(null)
const nodeReleases = ref<ReleaseRecord[]>([])
const deployCommand = ref('')
const uninstallCommand = ref('')
const publishNode = ref<NodeRecord|null>(null)
const publishKind = ref<'runtime'|'bootstrap'>('runtime')
const publishTemplateIds = ref<string[]>([])
const publishMessage = ref('')
const publishingRelease = ref(false)
const publishPreview = ref<ReleasePreviewRecord|null>(null)
const publishPreviewLoading = ref(false)
const publishPreviewError = ref('')
let publishPreviewRequestId = 0

// Toast
const toasts = ref<{id:number,type:string,msg:string}[]>([])
let toastId = 0
function toast(type:string, msg:string) {
  const id = ++toastId
  toasts.value.push({id,type,msg})
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 4000)
}

// ---- Auth ----
async function login() {
  loading.value = true; error.value = ''
  try {
    const s = await api.getSystemStatus(adminKey.value)
    status.value = s; loggedIn.value = true
    localStorage.setItem('nh_admin_key', adminKey.value)
    await loadAll()
  } catch (e:any) { error.value = e.message || '璁よ瘉澶辫触' }
  loading.value = false
}

function logout() {
  loggedIn.value = false; adminKey.value = ''; localStorage.removeItem('nh_admin_key')
  status.value = null; nodes.value = []; templates.value = []; subscriptions.value = []
}

// ---- Data Loading ----
async function loadAll() {
  loading.value = true
  try {
    const [n, t, s] = await Promise.all([
      api.listNodes(adminKey.value),
      api.listTemplates(adminKey.value),
      api.listSubscriptions(adminKey.value),
    ])
    nodes.value = n; templates.value = t; subscriptions.value = s
  } catch (e:any) { toast('error', e.message) }
  loading.value = false
}

async function refreshStatus() {
  try { status.value = await api.getSystemStatus(adminKey.value) } catch {}
}

// ---- Node Actions ----
const newNode = ref({
  name:'', nodeType:'vps' as 'vps'|'edge', region:'',
  networkType:'public' as 'public'|'noPublicIp',
  primaryDomain:'', backupDomain:'', entryIp:'',
  useGithubMirror:false, githubMirrorUrl:'',
  installWarp:false, warpLicenseKey:'',
  useCfDnsToken:false, cfDnsToken:'',
  installArgo:false,
  useArgoTunnelToken:false, argoTunnelToken:'',
  useArgoTunnelDomain:false, argoTunnelDomain:'',
  useArgoTunnelPort:false, argoTunnelPort:2053,
})

function resetNewNode() {
  newNode.value = {
    name:'', nodeType:'vps', region:'',
    networkType:'public',
    primaryDomain:'', backupDomain:'', entryIp:'',
    useGithubMirror:false, githubMirrorUrl:'',
    installWarp:false, warpLicenseKey:'',
    useCfDnsToken:false, cfDnsToken:'',
    installArgo:false,
    useArgoTunnelToken:false, argoTunnelToken:'',
    useArgoTunnelDomain:false, argoTunnelDomain:'',
    useArgoTunnelPort:false, argoTunnelPort:2053,
  }
}

async function createNode() {
  const n = newNode.value
  try {
    await api.createNode(adminKey.value, {
      name: n.name,
      nodeType: n.nodeType,
      region: n.region,
      networkType: n.networkType,
      primaryDomain: n.primaryDomain,
      backupDomain: n.backupDomain,
      entryIp: n.entryIp,
      githubMirrorUrl: n.useGithubMirror ? n.githubMirrorUrl : '',
      installWarp: n.installWarp,
      warpLicenseKey: n.installWarp ? n.warpLicenseKey : '',
      cfDnsToken: n.useCfDnsToken ? n.cfDnsToken : '',
      installArgo: n.installArgo || n.networkType === 'noPublicIp',
      argoTunnelToken: n.useArgoTunnelToken ? n.argoTunnelToken : '',
      argoTunnelDomain: n.useArgoTunnelDomain ? n.argoTunnelDomain : '',
      argoTunnelPort: n.useArgoTunnelPort ? n.argoTunnelPort : 2053,
    })
    showCreateNode.value = false
    resetNewNode()
    toast('success', '鑺傜偣鍒涘缓鎴愬姛'); await loadAll(); await refreshStatus()
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
  navigator.clipboard.writeText(text).then(() => toast('success', 'Copied to clipboard')).catch(() => toast('error', 'Copy failed'))
}

async function publishRelease(nodeId: string) {
  try {
    await api.publishNode(adminKey.value, nodeId, { kind:'runtime', templateIds: templates.value.map(t=>t.id) })
    toast('success', '鍙戝竷鎴愬姛'); await loadAll(); await refreshStatus()
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
const newTemplate = ref({
  name:'', engine:'xray' as 'sing-box'|'xray',
  protocol:'vless', transport:'ws', tlsMode:'none' as 'none'|'tls'|'reality',
  defaults:{} as Record<string,unknown>, notes:''
})

// Protocol options based on engine
const protocolOptions = computed(() => {
  return [
    { value:'vless', label:'VLESS' },
    { value:'vmess', label:'VMESS' },
    { value:'trojan', label:'Trojan' },
    { value:'shadowsocks', label:'Shadowsocks' },
    { value:'hysteria2', label:'Hysteria2' },
  ]
})

// Transport options based on protocol
const transportOptions = computed(() => {
  const p = newTemplate.value.protocol
  if (p === 'hysteria2') return [{ value:'hysteria2', label:'Hysteria2 (QUIC)' }]
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
  const fields: Array<{key:string, label:string, placeholder:string, type?:string, generator?:string, list?:string}> = []

  // Port
  fields.push({ key:'serverPort', label:'绔彛', placeholder:'443', type:'number' })

  // UUID for vless/vmess
  if (p === 'vless' || p === 'vmess') {
    fields.push({ key:'uuid', label:'UUID', placeholder:'00000000-0000-4000-8000-000000000001', generator:'uuid' })
  }
  // Password for trojan/ss/hy2
  if (p === 'trojan' || p === 'shadowsocks' || p === 'hysteria2') {
    fields.push({ key:'password', label:'瀵嗙爜', placeholder:'your-password', generator:'random-password' })
  }
  // SS method
  if (p === 'shadowsocks') {
    fields.push({ key:'method', label:'鍔犲瘑鏂瑰紡', placeholder:'aes-128-gcm / 2022-blake3-aes-128-gcm' })
  }
  // WS/XHTTP path
  if (t === 'ws' || t === 'xhttp') {
    fields.push({ key:'path', label:'璺緞', placeholder: t === 'ws' ? '/ws' : '/' })
    fields.push({ key:'host', label:'Host (optional)', placeholder: 'example.com' })
  }
  // gRPC service name
  if (t === 'grpc') {
    fields.push({ key:'serviceName', label:'Service Name', placeholder:'grpc' })
  }
  // TLS SNI
  if (tls === 'tls' || tls === 'reality' || p === 'hysteria2') {
    fields.push({ key:'sni', label:'SNI', placeholder: tls === 'reality' ? '渚嬪 www.microsoft.com' : '渚嬪 node.example.com', list: tls === 'reality' ? 'reality-sni-list' : undefined })
  }
  // VLESS flow for Reality
  if (p === 'vless' && tls === 'reality') {
    fields.push({ key:'flow', label:'Flow', placeholder:'xtls-rprx-vision' })
  }
  // Reality keys
  if (tls === 'reality') {
    fields.push({ key:'realityPrivateKey', label:'Reality 绉侀挜', placeholder:'replace-me', generator:'x25519' })
    fields.push({ key:'realityPublicKey', label:'Reality 鍏挜', placeholder:'replace-me' })
    fields.push({ key:'realityShortId', label:'Reality ShortId', placeholder:'0123456789abcdef', generator:'shortId' })
  }
  // Hysteria2 bandwidth
  if (p === 'hysteria2') {
    fields.push({ key:'upMbps', label:'涓婅甯﹀ (Mbps)', placeholder:'100', type:'number' })
    fields.push({ key:'downMbps', label:'涓嬭甯﹀ (Mbps)', placeholder:'100', type:'number' })
  }
  // VMESS alterId
  if (p === 'vmess') {
    fields.push({ key:'alterId', label:'AlterId', placeholder:'0', type:'number' })
  }

  return fields
})

// Watch protocol changes and auto-fix transport/tls
watch(() => newTemplate.value.protocol, (p) => {
  if (p === 'hysteria2') {
    newTemplate.value.transport = 'hysteria2'
    newTemplate.value.tlsMode = 'tls'
    if (newTemplate.value.engine !== 'sing-box') newTemplate.value.engine = 'sing-box'
  } else if (p === 'shadowsocks') {
    newTemplate.value.tlsMode = 'none'
    if (newTemplate.value.transport === 'hysteria2') newTemplate.value.transport = 'tcp'
  } else {
    if (newTemplate.value.transport === 'hysteria2') newTemplate.value.transport = 'tcp'
  }
})

async function openCreateTemplate() {
  showCreateTemplate.value = true
  try { catalogPresets.value = await api.listTemplateCatalog(adminKey.value) } catch {}
}

function applyPreset(p: any) {
  newTemplate.value = {
    name: p.name, engine: p.engine, protocol: p.protocol,
    transport: p.transport, tlsMode: p.tlsMode,
    defaults: p.defaults ? { ...p.defaults } : {}, notes: p.notes || ''
  }
}

async function createTemplate() {
  try {
    await api.createTemplate(adminKey.value, newTemplate.value)
    showCreateTemplate.value = false
    newTemplate.value = { name:'', engine:'xray', protocol:'vless', transport:'ws', tlsMode:'none', defaults:{}, notes:'' }
    toast('success', '妯℃澘鍒涘缓鎴愬姛'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

// ---- Generators ----
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  })
}

function generateRandomHex(bytes: number) {
  const arr = new Uint8Array(bytes)
  window.crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateRandomPassword() {
  return generateRandomHex(12) // 24 chars hex
}

async function generateRealityKeys() {
  try {
    const keyPair = await window.crypto.subtle.generateKey({ name: "X25519" } as any, true, ["deriveBits"])
    const pubKeyBuf = await window.crypto.subtle.exportKey("raw", (keyPair as any).publicKey)
    const privKeyBuf = await window.crypto.subtle.exportKey("pkcs8", (keyPair as any).privateKey)
    const privRaw = new Uint8Array(privKeyBuf).slice(-32) // extract raw 32 bytes from pkcs8
    const toBase64Url = (buf: Uint8Array) => btoa(String.fromCharCode(...Array.from(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    newTemplate.value.defaults['realityPublicKey'] = toBase64Url(new Uint8Array(pubKeyBuf))
    newTemplate.value.defaults['realityPrivateKey'] = toBase64Url(privRaw)
    toast('success', 'Generated new Reality key pair')
  } catch (e) {
    toast('error', '褰撳墠娴忚鍣ㄤ笉鏀寔 X25519 瀵嗛挜鐢熸垚锛岃鎵嬪姩杈撳叆')
  }
}

function handleGenerate(type: string) {
  if (type === 'uuid') {
    newTemplate.value.defaults['uuid'] = generateUUID()
  } else if (type === 'random-password') {
    newTemplate.value.defaults['password'] = generateRandomPassword()
  } else if (type === 'shortId') {
    newTemplate.value.defaults['realityShortId'] = generateRandomHex(8)
  } else if (type === 'x25519') {
    generateRealityKeys()
  }
}

// ---- Subscription Actions ----
const newSub = ref({ name:'', enabled:true, visibleNodeIds:[] as string[] })

async function createSub() {
  try {
    await api.createSubscription(adminKey.value, newSub.value)
    showCreateSub.value = false; newSub.value = { name:'', enabled:true, visibleNodeIds:[] }
    toast('success', '璁㈤槄鍒涘缓鎴愬姛'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

// Subscription URL helper
function getSubscriptionUrl(token: string, format: string) {
  const base = status.value?.publicBaseUrl || window.location.origin
  return `${base}/sub/${token}?format=${format}`
}

function openPublishRelease(node: NodeRecord) {
  publishNode.value = node
  publishKind.value = 'runtime'
  publishMessage.value = ''
  publishTemplateIds.value = templates.value.map((template) => template.id)
  publishPreview.value = null
  publishPreviewError.value = ''
  showPublishRelease.value = true
}

function closePublishRelease() {
  showPublishRelease.value = false
  publishNode.value = null
  publishKind.value = 'runtime'
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

async function loadPublishPreview() {
  if (!publishNode.value || publishTemplateIds.value.length === 0) {
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
      kind: publishKind.value,
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
  if (publishKind.value === 'runtime' && publishTemplateIds.value.length === 0) {
    toast('error', 'Select at least one template')
    return
  }
  try {
    publishingRelease.value = true
    await api.publishNode(adminKey.value, publishNode.value.id, {
      kind: publishKind.value,
      templateIds: publishTemplateIds.value,
      message: publishMessage.value.trim(),
    })
    const selectedNodeId = selectedNode.value?.id
    toast('success', '鍙戝竷鎴愬姛')
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

function isOnline(n: NodeRecord) {
  if (!n.lastSeenAt) return false
  return Date.now() - new Date(n.lastSeenAt).getTime() < 120000
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

function getRuntimeVersion(n: NodeRecord) {
  return (n.protocolRuntimeVersion || '').trim() || '-'
}

const publishBlocked = computed(() =>
  publishKind.value === 'runtime' && publishTemplateIds.value.length === 0,
)

function getWarpLabel(n: NodeRecord) {
  const warpIpv6 = (n.warpIpv6 || '').trim()
  if (warpIpv6) return warpIpv6
  return getWarpStatusText(n)
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
  if (!d) return '浠庢湭'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return s + '绉掑墠'
  if (s < 3600) return Math.floor(s/60) + 'm ago'
  if (s < 86400) return Math.floor(s/3600) + 'h ago'
  return Math.floor(s/86400) + '澶╁墠'
}

function isPage(page: 'dashboard'|'nodes'|'templates'|'subscriptions') {
  return currentPage.value === page
}

watch(
  [showPublishRelease, publishKind, () => publishNode.value?.id || '', () => publishTemplateIds.value.join(',')],
  ([visible]) => {
    if (!visible) return
    void loadPublishPreview()
  },
)

const onlineCount = computed(() => nodes.value.filter(isOnline).length)

onMounted(() => { if (adminKey.value) login() })
</script>

<template>
  <!-- Toast -->
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span class="toast-message">{{ t.msg }}</span>
      <button class="toast-close" @click="toasts = toasts.filter(x=>x.id!==t.id)">鉁</button>
    </div>
  </div>

  <!-- Login -->
  <div v-if="!loggedIn" class="login-page">
    <div class="login-card">
      <div class="login-logo-row">
        <div class="login-logo">N</div>
        <div class="login-brand-name">NodeHub</div>
      </div>
      <p class="login-description">鑺傜偣绠＄悊鎺у埗闈㈡澘</p>
      <form @submit.prevent="login">
        <div class="form-group">
          <label class="form-label">绠＄悊瀵嗛挜</label>
          <input class="form-input" type="password" v-model="adminKey" placeholder="Enter admin key" autofocus />
        </div>
        <p v-if="error" style="color:var(--color-danger);font-size:12px;margin-bottom:12px">{{ error }}</p>
        <button class="btn btn-primary w-full" type="submit" :disabled="loading">
          {{ loading ? 'Connecting...' : 'Login' }}
        </button>
      </form>
    </div>
  </div>

  <!-- Dashboard Layout -->
  <div v-else class="app-layout">
    <!-- Sidebar -->
    <aside class="app-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">N</div>
        <div>
          <div class="sidebar-title">NodeHub</div>
          <div class="sidebar-version">v{{ status?.appVersion || '0.1.0' }}</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section-label">姒傝</div>
        <div class="nav-item" :class="{active: currentPage==='dashboard'}" @click="currentPage='dashboard'">
          <span class="nav-icon">馃搳</span><span>浠〃鐩</span>
        </div>
        <div class="nav-section-label">绠＄悊</div>
        <div class="nav-item" :class="{active: currentPage==='nodes'}" @click="currentPage='nodes'">
          <span class="nav-icon">馃枼锔</span><span>鑺傜偣</span>
          <span class="nav-badge">{{ nodes.length }}</span>
        </div>
        <div class="nav-item" :class="{active: currentPage==='templates'}" @click="currentPage='templates'">
          <span class="nav-icon">馃搵</span><span>妯℃澘</span>
          <span class="nav-badge">{{ templates.length }}</span>
        </div>
        <div class="nav-item" :class="{active: currentPage==='subscriptions'}" @click="currentPage='subscriptions'">
          <span class="nav-icon">馃敆</span><span>璁㈤槄</span>
          <span class="nav-badge">{{ subscriptions.length }}</span>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-mode-badge" :class="status?.mode||'docker'">
          {{ status?.mode === 'cloudflare' ? '鈽侊笍 Cloudflare' : '馃惓 Docker' }}
        </div>
        <button class="btn btn-ghost btn-sm mt-md" @click="logout" style="width:100%;justify-content:flex-start;gap:8px">
          馃毆 <span>閫€鍑虹櫥褰</span>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="app-main">
      <div class="app-content">

        <!-- Dashboard Page -->
        <div v-if="currentPage==='dashboard'" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">浠〃鐩</h1><p class="page-subtitle">绯荤粺姒傝涓庣粺璁℃暟鎹</p></div>
              <button class="btn btn-secondary" @click="loadAll();refreshStatus()">鈫?鍒锋柊</button>
            </div>
          </div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-card-icon accent">馃枼锔</div>
              <div class="stat-value">{{ status?.summary.nodeCount ?? 0 }}</div>
              <div class="stat-label">鑺傜偣鎬绘暟</div>
              <div class="stat-glow accent"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon success">馃煝</div>
              <div class="stat-value">{{ onlineCount }}</div>
              <div class="stat-label">鍦ㄧ嚎鑺傜偣</div>
              <div class="stat-glow success"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon info">馃搵</div>
              <div class="stat-value">{{ status?.summary.templateCount ?? 0 }}</div>
              <div class="stat-label">妯℃澘鏁伴噺</div>
              <div class="stat-glow info"></div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon warning">馃摝</div>
              <div class="stat-value">{{ status?.summary.releaseCount ?? 0 }}</div>
              <div class="stat-label">鍙戝竷娆℃暟</div>
              <div class="stat-glow warning"></div>
            </div>
          </div>
          <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
            <div class="card">
              <div class="card-header"><span class="card-title">鍏ョ珯娴侀噺</span></div>
              <div class="stat-value" style="font-size:22px">{{ formatBytes(status?.summary.totalBytesIn ?? 0) }}</div>
              <div class="stat-label">鎬诲叆绔欐祦閲</div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">鍑虹珯娴侀噺</span></div>
              <div class="stat-value" style="font-size:22px">{{ formatBytes(status?.summary.totalBytesOut ?? 0) }}</div>
              <div class="stat-label">鎬诲嚭绔欐祦閲</div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">鏁版嵁搴</span></div>
              <div class="stat-value" style="font-size:22px">{{ status?.databaseDriver ?? '-' }}</div>
              <div class="stat-label">{{ status?.artifactDriver ?? '-' }} 鍒跺搧瀛樺偍</div>
            </div>
          </div>
          <!-- Recent Nodes -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">鏈€杩戣妭鐐</span>
              <button class="btn btn-sm btn-secondary" @click="currentPage='nodes'">鏌ョ湅鍏ㄩ儴 鈫</button>
            </div>
            <div class="table-wrapper" style="border:none;background:transparent">
              <table class="data-table">
                <thead><tr>
                  <th>鍚嶇О</th><th>绫诲瀷</th><th>鍦板尯</th><th>鐘舵€</th><th>鏈€鍚庡湪绾</th>
                </tr></thead>
                <tbody>
                  <tr v-for="n in nodes.slice(0,5)" :key="n.id">
                    <td style="font-weight:600;color:var(--color-text-primary)">{{ n.name }}</td>
                    <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                    <td>{{ n.region || '-' }}</td>
                    <td><span class="status-badge" :class="isOnline(n)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(n)?'鍦ㄧ嚎':'绂荤嚎' }}</span></td>
                    <td class="text-muted">{{ timeAgo(n.lastSeenAt) }}</td>
                  </tr>
                  <tr v-if="nodes.length===0"><td colspan="5" class="text-center text-muted" style="padding:32px">鏆傛棤鑺傜偣</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Nodes Page -->
        <div v-if="isPage('nodes')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">鑺傜偣绠＄悊</h1><p class="page-subtitle">绠＄悊鎮ㄧ殑浠ｇ悊鑺傜偣</p></div>
              <button class="btn btn-primary" @click="showCreateNode=true">+ 娣诲姞鑺傜偣</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table node-table">
              <thead><tr>
                <th>鍚嶇О</th><th>绫诲瀷</th><th>鍦板尯</th><th>鍩熷悕/Argo</th><th>Warp</th><th>杩炴帴鏁</th><th>娴侀噺</th><th>鎿嶄綔</th>
              </tr></thead>
              <tbody>
                <tr v-for="n in nodes" :key="n.id" class="cursor-pointer" @click="selectNode(n)">
                  <td class="node-name" :class="isOnline(n) ? 'online' : 'offline'">{{ n.name }}</td>
                  <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                  <td>{{ n.region || '-' }}</td>
                  <td class="text-mono truncate">{{ getNodeDomainDisplay(n) }}</td>
                  <td><span class="warp-badge" :class="isWarpRunning(n) ? 'online' : 'offline'">{{ getWarpLabel(n) }}</span></td>
                  <td>{{ n.currentConnections }}</td>
                  <td class="text-muted" style="font-size:12px">鈫憑{ formatBytes(n.bytesOutTotal) }} 鈫搟{ formatBytes(n.bytesInTotal) }}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-sm btn-secondary" @click.stop="openPublishRelease(n)">鍙戝竷</button>
                      <button class="btn btn-sm btn-danger" @click.stop="deleteNodeById(n.id, n.name)">鍒犻櫎</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="nodes.length===0"><td colspan="8"><div class="empty-state"><div class="empty-state-icon">馃枼锔</div><div class="empty-state-title">鏆傛棤鑺傜偣</div><div class="empty-state-text">娣诲姞鎮ㄧ殑绗竴涓唬鐞嗚妭鐐逛互寮€濮嬩娇鐢</div><button class="btn btn-primary" @click="showCreateNode=true">+ 娣诲姞鑺傜偣</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Templates Page -->
        <div v-if="isPage('templates')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">妯℃澘绠＄悊</h1><p class="page-subtitle">鍗忚閰嶇疆妯℃澘</p></div>
              <button class="btn btn-primary" @click="openCreateTemplate">+ 娣诲姞妯℃澘</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>鍚嶇О</th><th>寮曟搸</th><th>鍗忚</th><th>浼犺緭</th><th>TLS</th><th>鏇存柊鏃堕棿</th></tr></thead>
              <tbody>
                <tr v-for="t in templates" :key="t.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ t.name }}</td>
                  <td><span class="tag" :class="{accent:t.engine==='sing-box'}">{{ t.engine }}</span></td>
                  <td>{{ t.protocol }}</td>
                  <td>{{ t.transport }}</td>
                  <td><span class="status-badge" :class="t.tlsMode==='reality'?'applying':t.tlsMode==='tls'?'healthy':'offline'">{{ t.tlsMode }}</span></td>
                  <td class="text-muted">{{ timeAgo(t.updatedAt) }}</td>
                </tr>
                <tr v-if="templates.length===0"><td colspan="6"><div class="empty-state"><div class="empty-state-icon">馃搵</div><div class="empty-state-title">鏆傛棤妯℃澘</div><div class="empty-state-text">鍒涘缓鍗忚妯℃澘鏉ラ厤缃偍鐨勮妭鐐</div><button class="btn btn-primary" @click="openCreateTemplate">+ 娣诲姞妯℃澘</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Subscriptions Page -->
        <div v-if="isPage('subscriptions')" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">璁㈤槄绠＄悊</h1><p class="page-subtitle">绠＄悊璁㈤槄绔偣</p></div>
              <button class="btn btn-primary" @click="showCreateSub=true">+ 娣诲姞璁㈤槄</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>鍚嶇О</th><th>浠ょ墝</th><th>鐘舵€</th><th>鍙鑺傜偣</th><th>鍒涘缓鏃堕棿</th><th>璁㈤槄鍦板潃</th></tr></thead>
              <tbody>
                <tr v-for="s in subscriptions" :key="s.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ s.name }}</td>
                  <td class="text-mono truncate">{{ s.token }}</td>
                  <td><span class="status-badge" :class="s.enabled?'online':'offline'"><span class="status-dot"></span>{{ s.enabled ? 'Enabled' : 'Disabled' }}</span></td>
                  <td>{{ s.visibleNodeIds.length || '鍏ㄩ儴' }}</td>
                  <td class="text-muted">{{ timeAgo(s.createdAt) }}</td>
                  <td>
                    <div class="sub-url-actions">
                      <button class="btn btn-xs btn-secondary" @click="copyToClipboard(getSubscriptionUrl(s.token,'v2ray'))" title="V2Ray 璁㈤槄 (Base64)">V2Ray</button>
                      <button class="btn btn-xs btn-secondary" @click="copyToClipboard(getSubscriptionUrl(s.token,'clash'))" title="Clash 璁㈤槄 (YAML)">Clash</button>
                      <button class="btn btn-xs btn-secondary" @click="copyToClipboard(getSubscriptionUrl(s.token,'singbox'))" title="Sing-Box 璁㈤槄 (JSON)">SingBox</button>
                      <button class="btn btn-xs btn-ghost" @click="copyToClipboard(getSubscriptionUrl(s.token,'plain'))" title="閫氱敤璁㈤槄 (鏄庢枃)">閫氱敤</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="subscriptions.length===0"><td colspan="6"><div class="empty-state"><div class="empty-state-icon">馃敆</div><div class="empty-state-title">鏆傛棤璁㈤槄</div><div class="empty-state-text">鍒涘缓璁㈤槄浠ヤ緵瀹㈡埛绔闂</div><button class="btn btn-primary" @click="showCreateSub=true">+ 娣诲姞璁㈤槄</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>

    <!-- Node Detail Panel -->
    <template v-if="selectedNode">
      <div class="detail-overlay" @click="selectedNode=null"></div>
      <aside class="detail-panel">
        <div class="detail-panel-header">
          <h2 style="font-size:16px;font-weight:700">{{ selectedNode.name }}</h2>
          <button class="modal-close-btn" @click="selectedNode=null">鉁</button>
        </div>
        <div class="detail-panel-body">
          <div class="detail-section">
            <div class="detail-section-title">鍩烘湰淇℃伅</div>
            <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value text-mono">{{ selectedNode.id }}</span></div>
            <div class="detail-row"><span class="detail-label">绫诲瀷</span><span class="detail-value"><span class="tag" :class="{accent:selectedNode.nodeType==='edge'}">{{ selectedNode.nodeType }}</span></span></div>
            <div class="detail-row"><span class="detail-label">鍦板尯</span><span class="detail-value">{{ selectedNode.region || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">缃戠粶绫诲瀷</span><span class="detail-value"><span class="tag" :class="{accent:selectedNode.networkType==='noPublicIp'}">{{ selectedNode.networkType === 'noPublicIp' ? '鏃犲叕缃慖P (Argo)' : '鏈夊叕缃慖P' }}</span></span></div>
            <div class="detail-row"><span class="detail-label">涓诲煙鍚</span><span class="detail-value text-mono">{{ selectedNode.primaryDomain || '-' }}</span></div>
            <div class="detail-row" v-if="selectedNode.backupDomain"><span class="detail-label">澶囧煙鍚</span><span class="detail-value text-mono">{{ selectedNode.backupDomain }}</span></div>
            <div class="detail-row"><span class="detail-label">鍏ュ彛 IP</span><span class="detail-value text-mono">{{ selectedNode.entryIp || '-' }}</span></div>
            <div class="detail-row" v-if="selectedNode.argoTunnelDomain"><span class="detail-label">Argo 鍩熷悕</span><span class="detail-value text-mono">{{ selectedNode.argoTunnelDomain }}</span></div>
            <div class="detail-row"><span class="detail-label">鐘舵€</span><span class="detail-value"><span class="status-badge" :class="isOnline(selectedNode)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(selectedNode)?'鍦ㄧ嚎':'绂荤嚎' }}</span></span></div>
            <div class="detail-row"><span class="detail-label">鏈€鍚庡湪绾</span><span class="detail-value">{{ timeAgo(selectedNode.lastSeenAt) }}</span></div>
            <div class="detail-row"><span class="detail-label">Runtime</span><span class="detail-value text-mono">{{ getRuntimeVersion(selectedNode) }}</span></div>
            <div class="detail-row">
              <span class="detail-label">WARP</span>
              <span class="detail-value">
                <span class="warp-badge" :class="isWarpRunning(selectedNode) ? 'online' : 'offline'">{{ getWarpStatusText(selectedNode) }}</span>
              </span>
            </div>
            <div class="detail-row"><span class="detail-label">WARP IPv6</span><span class="detail-value text-mono">{{ selectedNode.warpIpv6 || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">WARP Endpoint</span><span class="detail-value text-mono">{{ selectedNode.warpEndpoint || '-' }}</span></div>
            <div class="detail-row">
              <span class="detail-label">Argo</span>
              <span class="detail-value">
                <span class="warp-badge" :class="isArgoRunning(selectedNode) ? 'online' : 'offline'">{{ getArgoStatusText(selectedNode) }}</span>
              </span>
            </div>
            <div class="detail-row"><span class="detail-label">Argo Domain</span><span class="detail-value text-mono">{{ selectedNode.argoDomain || selectedNode.argoTunnelDomain || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">Storage</span><span class="detail-value">{{ getStorageUsage(selectedNode) }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">璧勬簮鐩戞帶</div>
            <div class="detail-row"><span class="detail-label">CPU</span><span class="detail-value">{{ selectedNode.cpuUsagePercent !== null ? selectedNode.cpuUsagePercent + '%' : '-' }}</span></div>
            <div v-if="selectedNode.cpuUsagePercent!==null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="selectedNode.cpuUsagePercent>80?'danger':selectedNode.cpuUsagePercent>50?'warning':'success'" :style="{width:selectedNode.cpuUsagePercent+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">鍐呭瓨</span><span class="detail-value">{{ selectedNode.memoryUsagePercent !== null ? selectedNode.memoryUsagePercent + '%' : '-' }}</span></div>
            <div v-if="selectedNode.memoryUsagePercent!==null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="selectedNode.memoryUsagePercent>80?'danger':selectedNode.memoryUsagePercent>50?'warning':'success'" :style="{width:selectedNode.memoryUsagePercent+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">杩炴帴鏁</span><span class="detail-value">{{ selectedNode.currentConnections }}</span></div>
            <div class="detail-row"><span class="detail-label">鍏ョ珯娴侀噺</span><span class="detail-value">{{ formatBytes(selectedNode.bytesInTotal) }}</span></div>
            <div class="detail-row"><span class="detail-label">鍑虹珯娴侀噺</span><span class="detail-value">{{ formatBytes(selectedNode.bytesOutTotal) }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">鍙戝竷璁板綍 ({{ nodeReleases.length }})</div>
            <div v-for="r in nodeReleases.slice(0,5)" :key="r.id" class="card mb-md" style="padding:12px">
              <div class="flex items-center justify-between gap-sm">
                <span style="font-weight:600;font-size:13px">鐗堟湰 #{{ r.revision }}</span>
                <span class="status-badge" :class="r.status">{{ r.status }}</span>
              </div>
              <div class="text-muted" style="font-size:11px;margin-top:4px">{{ r.kind }} 路 {{ timeAgo(r.createdAt) }}</div>
              <div v-if="r.summary" style="font-size:12px;margin-top:4px;color:var(--color-text-secondary)">{{ r.summary }}</div>
            </div>
            <div v-if="nodeReleases.length===0" class="text-muted text-center" style="padding:16px;font-size:12px">鏆傛棤鍙戝竷璁板綍</div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">閮ㄧ讲鍛戒护</div>
            <button v-if="!deployCommand" class="btn btn-secondary btn-sm w-full" @click="loadDeployCommand">鐢熸垚閮ㄧ讲鍛戒护</button>
            <div v-else>
              <div class="code-block" style="max-height:120px;overflow-y:auto;font-size:11px;word-break:break-all">{{ deployCommand }}</div>
              <button class="btn btn-sm btn-primary mt-md w-full" @click="copyToClipboard(deployCommand)">馃搵 澶嶅埗閮ㄧ讲鍛戒护</button>
            </div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">涓€閿嵏杞</div>
            <button v-if="!uninstallCommand" class="btn btn-danger btn-sm w-full" style="--btn-bg:var(--color-danger);--btn-hover:var(--color-danger)" @click="loadUninstallCommand">鐢熸垚鍗歌浇鍛戒护</button>
            <div v-else>
              <div class="code-block" style="max-height:120px;overflow-y:auto;font-size:11px;word-break:break-all">{{ uninstallCommand }}</div>
              <button class="btn btn-sm btn-primary mt-md w-full" @click="copyToClipboard(uninstallCommand)">馃搵 澶嶅埗鍗歌浇鍛戒护</button>
            </div>
          </div>
        </div>
      </aside>
    </template>

    <!-- Publish Release Modal -->
    <div v-if="showPublishRelease" class="modal-overlay" @click.self="closePublishRelease">
      <div class="modal-content" style="max-width:640px">
        <div class="modal-header">
          <h3 class="modal-title">鍙戝竷鑺傜偣鐗堟湰</h3>
          <button class="modal-close-btn" @click="closePublishRelease">鉁</button>
        </div>
        <div class="modal-body" style="display:grid;gap:16px">
          <template v-if="publishNode">
            <div class="card" style="padding:14px">
              <div style="font-size:15px;font-weight:700">{{ publishNode.name }}</div>
              <div class="text-muted text-mono" style="margin-top:4px">{{ publishNode.id }}</div>
              <div class="text-muted" style="margin-top:8px;font-size:12px">閫夋嫨鍙戝竷绫诲瀷鍜屾ā鏉匡紝鑺傜偣浼氬湪涓嬩竴娆?reconcile 鏃惰嚜鍔ㄦ媺鍙栥€</div>
            </div>

            <div class="form-group">
              <label class="form-label">鍙戝竷绫诲瀷</label>
              <select class="form-select" v-model="publishKind">
                <option value="runtime">Runtime</option>
                <option value="bootstrap">Bootstrap</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">妯℃澘閫夋嫨</label>
              <div v-if="templates.length===0" class="empty-state" style="padding:20px 12px">
                <div class="empty-state-title">鏆傛棤妯℃澘</div>
                <div class="empty-state-text" style="margin-bottom:0">璇峰厛鍒涘缓鍗忚妯℃澘銆</div>
              </div>
              <div v-else class="publish-template-list">
                <label
                  v-for="template in templates"
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
              <div class="text-muted" style="margin-top:8px;font-size:12px">
                <span>鏀寔鍚屾椂閫夋嫨澶氱鍗忚鍜屽涓唴鏍革紝棰勮浼氭寜鍐呮牳鍒嗙粍鐢熸垚銆</span>
                
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">鍙戝竷澶囨敞</label>
              <textarea class="form-textarea" v-model="publishMessage" placeholder="鍙€夛紝渚嬪锛氬垏鎹㈠埌 sing-box 妯℃澘缁勫悎" />
            </div>
            <div class="form-group">
              <label class="form-label">閰嶇疆棰勮</label>
              <div class="publish-preview">
                <div v-if="publishPreviewLoading" class="text-muted">棰勮鐢熸垚涓?..</div>
                <div v-else-if="publishPreviewError" class="publish-preview-error">{{ publishPreviewError }}</div>
                <div v-else-if="publishPreview">
                  <div v-for="runtime in publishPreview.runtimePlans" :key="runtime.engine" class="publish-preview-file">
                    <div class="publish-preview-meta">鍐呮牳 {{ runtime.engine }} / 鍏ュ彛 {{ runtime.entryConfigPath }}</div>
                    <div v-for="file in runtime.files" :key="`${runtime.engine}:${file.path}`" class="publish-preview-file">
                      <div class="publish-preview-file-head">{{ file.path }}</div>
                      <pre class="code-block publish-preview-code">{{ file.content }}</pre>
                    </div>
                  </div>
                </div>
                <div v-else class="text-muted">閫夋嫨妯℃澘鍚庤嚜鍔ㄧ敓鎴愰瑙</div>
              </div>
            </div>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="closePublishRelease">鍙栨秷</button>
          <button class="btn btn-primary" :disabled="publishingRelease || publishBlocked" @click="publishSelectedRelease">
            {{ publishingRelease ? '鍙戝竷涓?..' : '纭鍙戝竷' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create Node Modal -->
    <div v-if="showCreateNode" class="modal-overlay" @click.self="showCreateNode=false">
      <div class="modal-content" style="max-width:600px">
        <div class="modal-header"><h3 class="modal-title">鏂板缓鑺傜偣</h3><button class="modal-close-btn" @click="showCreateNode=false">鉁</button></div>
        <div class="modal-body" style="max-height:60vh;overflow-y:auto">
          <div class="form-group"><label class="form-label">鍚嶇О *</label><input class="form-input" v-model="newNode.name" placeholder="渚嬪 US-West-01" /></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">绫诲瀷</label><select class="form-select" v-model="newNode.nodeType"><option value="vps">VPS</option><option value="edge">Edge</option></select></div>
            <div class="form-group"><label class="form-label">鍦板尯</label><input class="form-input" v-model="newNode.region" placeholder="渚嬪 us-west" /></div>
          </div>

          <!-- GitHub Mirror -->
          <div class="form-section-divider">鎵╁睍閫夐」</div>
          <div class="form-checkbox-group mb-md">
            <input type="checkbox" class="form-checkbox" v-model="newNode.useGithubMirror" id="github-mirror">
            <label for="github-mirror" class="form-label" style="margin:0">浣跨敤 GitHub 闀滃儚</label>
          </div>
          <div v-if="newNode.useGithubMirror" class="form-group">
            <label class="form-label">GitHub 闀滃儚鍦板潃</label>
            <input class="form-input" v-model="newNode.githubMirrorUrl" placeholder="https://ghproxy.com/https://github.com" />
          </div>

          <!-- Install WARP -->
          <div class="form-checkbox-group mb-md">
            <input type="checkbox" class="form-checkbox" v-model="newNode.installWarp" id="warp">
            <label for="warp" class="form-label" style="margin:0">瀹夎 WARP</label>
          </div>
          <div v-if="newNode.installWarp" class="form-group">
            <label class="form-label">WARP 鍗囩骇瀵嗛挜锛堝彲閫夛紝鐢ㄤ簬鍗囩骇 WARP+ 璐﹀彿锛</label>
            <input class="form-input" v-model="newNode.warpLicenseKey" placeholder="WARP+ License Key" />
          </div>

          <!-- Network Type -->
          <div class="form-section-divider">鏈嶅姟鍣ㄧ綉缁</div>
          <div class="form-group">
            <label class="form-label">缃戠粶绫诲瀷</label>
            <select class="form-select" v-model="newNode.networkType">
              <option value="public">鏈夊叕缃?IP</option>
              <option value="noPublicIp">鏃犲叕缃?IP (Argo 闅ч亾)</option>
            </select>
          </div>

          <!-- Public IP options -->
          <template v-if="newNode.networkType==='public'">
            <div class="form-group"><label class="form-label">涓诲煙鍚</label><input class="form-input" v-model="newNode.primaryDomain" placeholder="node.example.com" /></div>
            <div class="form-group"><label class="form-label">澶囧煙鍚</label><input class="form-input" v-model="newNode.backupDomain" placeholder="node2.example.com锛堝彲閫夛級" /></div>
            <div class="form-group"><label class="form-label">鍏ュ彛 IP</label><input class="form-input" v-model="newNode.entryIp" placeholder="1.2.3.4" /></div>
            <div class="form-checkbox-group mb-md">
              <input type="checkbox" class="form-checkbox" v-model="newNode.useCfDnsToken" id="cf-dns">
              <label for="cf-dns" class="form-label" style="margin:0">CF-DNS-TOKEN (鑷姩 DNS 绠＄悊)</label>
            </div>
            <div v-if="newNode.useCfDnsToken" class="form-group">
              <label class="form-label">Cloudflare DNS API Token</label>
              <input class="form-input" v-model="newNode.cfDnsToken" placeholder="Cloudflare API Token" />
            </div>
          </template>

          <!-- No Public IP (Argo) options -->
          <template v-if="newNode.networkType==='noPublicIp'">
            <div class="form-checkbox-group mb-md">
              <input type="checkbox" class="form-checkbox" v-model="newNode.useArgoTunnelToken" id="argo-token">
              <label for="argo-token" class="form-label" style="margin:0">Tunnel Token</label>
            </div>
            <div v-if="newNode.useArgoTunnelToken" class="form-group">
              <label class="form-label">Argo Tunnel Token</label>
              <input class="form-input" v-model="newNode.argoTunnelToken" placeholder="Cloudflare Tunnel Token" />
            </div>
            <div class="form-checkbox-group mb-md">
              <input type="checkbox" class="form-checkbox" v-model="newNode.useArgoTunnelDomain" id="argo-domain">
              <label for="argo-domain" class="form-label" style="margin:0">鍥哄畾闅ч亾鍩熷悕</label>
            </div>
            <div v-if="newNode.useArgoTunnelDomain" class="form-group">
              <label class="form-label">闅ч亾鍩熷悕</label>
              <input class="form-input" v-model="newNode.argoTunnelDomain" placeholder="tunnel.example.com" />
            </div>
            <div class="form-checkbox-group mb-md">
              <input type="checkbox" class="form-checkbox" v-model="newNode.useArgoTunnelPort" id="argo-port">
              <label for="argo-port" class="form-label" style="margin:0">闅ч亾鍥炴簮绔彛锛堥粯璁?2053锛</label>
            </div>
            <div v-if="newNode.useArgoTunnelPort" class="form-group">
              <label class="form-label">鍥炴簮绔彛</label>
              <input class="form-input" type="number" v-model.number="newNode.argoTunnelPort" placeholder="2053" />
            </div>
          </template>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateNode=false">鍙栨秷</button><button class="btn btn-primary" @click="createNode">鍒涘缓</button></div>
      </div>
    </div>

    <!-- Create Template Modal -->
    <div v-if="showCreateTemplate" class="modal-overlay" @click.self="showCreateTemplate=false">
      <div class="modal-content" style="max-width:640px">
        <div class="modal-header"><h3 class="modal-title">鏂板缓妯℃澘</h3><button class="modal-close-btn" @click="showCreateTemplate=false">鉁</button></div>
        <div class="modal-body" style="max-height:60vh;overflow-y:auto">
          <!-- Presets -->
          <div v-if="catalogPresets.length" class="mb-lg">
            <label class="form-label">浠庨璁惧揩閫熷垱寤</label>
            <div class="preset-grid">
              <button v-for="p in catalogPresets" :key="p.id" class="preset-btn" @click="applyPreset(p)" :title="p.notes">
                <span class="preset-btn-name">{{ p.name }}</span>
                <span class="preset-btn-meta">{{ p.engine }} 路 {{ p.protocol }}</span>
              </button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">鍚嶇О *</label><input class="form-input" v-model="newTemplate.name" placeholder="渚嬪 VLESS-WS-TLS" /></div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">寮曟搸</label>
              <select class="form-select" v-model="newTemplate.engine">
                <option value="xray">Xray</option>
                <option value="sing-box">Sing-Box</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">鍗忚</label>
              <select class="form-select" v-model="newTemplate.protocol">
                <option v-for="o in protocolOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">浼犺緭鏂瑰紡</label>
              <select class="form-select" v-model="newTemplate.transport">
                <option v-for="o in transportOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">TLS 妯″紡</label>
              <select class="form-select" v-model="newTemplate.tlsMode">
                <option v-for="o in tlsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>

          <!-- Dynamic default fields -->
          <div class="form-section-divider">鍗忚鍙傛暟</div>
          <datalist id="reality-sni-list">
            <option value="www.microsoft.com"></option>
            <option value="www.yahoo.com"></option>
            <option value="www.apple.com"></option>
            <option value="cloudflare.com"></option>
            <option value="aws.amazon.com"></option>
          </datalist>
          
          <div v-for="field in templateDefaultFields" :key="field.key" class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center">
              <span>{{ field.label }}</span>
              <button v-if="field.generator" type="button" class="btn btn-xs btn-secondary" @click="handleGenerate(field.generator)">
                {{ field.generator === 'x25519' ? 'Generate Keypair' : 'Generate' }}
              </button>
            </label>
            <input
              class="form-input"
              :type="field.type || 'text'"
              :placeholder="field.placeholder"
              :list="field.list"
              :value="(newTemplate.defaults as any)[field.key] ?? ''"
              @input="(e:any) => { (newTemplate.defaults as any)[field.key] = field.type === 'number' ? Number(e.target.value) : e.target.value }"
            />
          </div>

          <div class="form-group"><label class="form-label">澶囨敞</label><textarea class="form-textarea" v-model="newTemplate.notes" placeholder="鍙€夊娉ㄤ俊鎭?.."></textarea></div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateTemplate=false">鍙栨秷</button><button class="btn btn-primary" @click="createTemplate">鍒涘缓</button></div>
      </div>
    </div>

    <!-- Create Subscription Modal -->
    <div v-if="showCreateSub" class="modal-overlay" @click.self="showCreateSub=false">
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">鏂板缓璁㈤槄</h3><button class="modal-close-btn" @click="showCreateSub=false">鉁</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">鍚嶇О *</label><input class="form-input" v-model="newSub.name" placeholder="e.g. Primary Subscription" /></div>
          <div class="form-checkbox-group mb-md"><input type="checkbox" class="form-checkbox" v-model="newSub.enabled" id="sub-en"><label for="sub-en" class="form-label" style="margin:0">鍚敤</label></div>
          <div class="form-group" v-if="nodes.length">
            <label class="form-label">鍙鑺傜偣锛堢暀绌鸿〃绀哄叏閮級</label>
            <div style="max-height:150px;overflow-y:auto;border:1px solid var(--glass-border);border-radius:var(--radius-md);padding:8px">
              <label v-for="n in nodes" :key="n.id" class="form-checkbox-group mb-md" style="cursor:pointer">
                <input type="checkbox" class="form-checkbox" :value="n.id" v-model="newSub.visibleNodeIds" />
                <span style="font-size:13px">{{ n.name }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateSub=false">鍙栨秷</button><button class="btn btn-primary" @click="createSub">鍒涘缓</button></div>
      </div>
    </div>
  </div>

</template>






