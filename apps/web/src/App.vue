<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { SystemStatus, NodeRecord, TemplateRecord, SubscriptionRecord, ReleaseRecord } from '@contracts/index'
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
const selectedNode = ref<NodeRecord|null>(null)
const nodeReleases = ref<ReleaseRecord[]>([])
const installScript = ref('')

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
  } catch (e:any) { error.value = e.message || '认证失败' }
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
const newNode = ref({ name:'', nodeType:'vps' as 'vps'|'edge', region:'', primaryDomain:'', entryIp:'', installWarp:false, installArgo:false })

async function createNode() {
  try {
    await api.createNode(adminKey.value, newNode.value)
    showCreateNode.value = false
    newNode.value = { name:'', nodeType:'vps', region:'', primaryDomain:'', entryIp:'', installWarp:false, installArgo:false }
    toast('success', '节点创建成功'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

async function selectNode(n: NodeRecord) {
  selectedNode.value = n; installScript.value = ''
  try { nodeReleases.value = await api.listNodeReleases(adminKey.value, n.id) } catch { nodeReleases.value = [] }
}

async function loadInstallScript() {
  if (!selectedNode.value) return
  try { installScript.value = await api.getNodeInstallScript(adminKey.value, selectedNode.value.id) }
  catch (e:any) { toast('error', e.message) }
}

async function publishRelease(nodeId: string) {
  try {
    await api.publishNode(adminKey.value, nodeId, { kind:'runtime', templateIds: templates.value.map(t=>t.id) })
    toast('success', '发布成功'); await loadAll(); await refreshStatus()
    if (selectedNode.value?.id === nodeId) await selectNode(selectedNode.value)
  } catch (e:any) { toast('error', e.message) }
}

// ---- Template Actions ----
const catalogPresets = ref<any[]>([])
const newTemplate = ref({ name:'', engine:'xray' as 'sing-box'|'xray', protocol:'vless', transport:'ws', tlsMode:'none' as 'none'|'tls'|'reality', defaults:{}, notes:'' })

async function openCreateTemplate() {
  showCreateTemplate.value = true
  try { catalogPresets.value = await api.listTemplateCatalog(adminKey.value) } catch {}
}

function applyPreset(p: any) {
  newTemplate.value = { name: p.name, engine: p.engine, protocol: p.protocol, transport: p.transport, tlsMode: p.tlsMode, defaults: p.defaults || {}, notes: p.notes || '' }
}

async function createTemplate() {
  try {
    await api.createTemplate(adminKey.value, newTemplate.value)
    showCreateTemplate.value = false
    newTemplate.value = { name:'', engine:'xray', protocol:'vless', transport:'ws', tlsMode:'none', defaults:{}, notes:'' }
    toast('success', '模板创建成功'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
}

// ---- Subscription Actions ----
const newSub = ref({ name:'', enabled:true, visibleNodeIds:[] as string[] })

async function createSub() {
  try {
    await api.createSubscription(adminKey.value, newSub.value)
    showCreateSub.value = false; newSub.value = { name:'', enabled:true, visibleNodeIds:[] }
    toast('success', '订阅创建成功'); await loadAll(); await refreshStatus()
  } catch (e:any) { toast('error', e.message) }
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

function timeAgo(d: string|null) {
  if (!d) return '从未'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return s + '秒前'
  if (s < 3600) return Math.floor(s/60) + '分钟前'
  if (s < 86400) return Math.floor(s/3600) + '小时前'
  return Math.floor(s/86400) + '天前'
}

const onlineCount = computed(() => nodes.value.filter(isOnline).length)

onMounted(() => { if (adminKey.value) login() })
</script>

<template>
  <!-- Toast -->
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span class="toast-message">{{ t.msg }}</span>
      <button class="toast-close" @click="toasts = toasts.filter(x=>x.id!==t.id)">✕</button>
    </div>
  </div>

  <!-- Login -->
  <div v-if="!loggedIn" class="login-page">
    <div class="login-card">
      <div class="login-logo-row">
        <div class="login-logo">N</div>
        <div class="login-brand-name">NodeHub</div>
      </div>
      <p class="login-description">节点管理控制面板</p>
      <form @submit.prevent="login">
        <div class="form-group">
          <label class="form-label">管理密钥</label>
          <input class="form-input" type="password" v-model="adminKey" placeholder="请输入管理密钥" autofocus />
        </div>
        <p v-if="error" style="color:var(--color-danger);font-size:12px;margin-bottom:12px">{{ error }}</p>
        <button class="btn btn-primary w-full" type="submit" :disabled="loading">
          {{ loading ? '连接中...' : '登 录' }}
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
        <div class="sidebar-mode-badge" :class="status?.mode||'docker'">
          {{ status?.mode === 'cloudflare' ? '☁️ Cloudflare' : '🐳 Docker' }}
        </div>
        <button class="btn btn-ghost btn-sm mt-md" @click="logout" style="width:100%;justify-content:flex-start;gap:8px">
          🚪 <span>退出登录</span>
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
              <div><h1 class="page-title">仪表盘</h1><p class="page-subtitle">系统概览与统计数据</p></div>
              <button class="btn btn-secondary" @click="loadAll();refreshStatus()">↻ 刷新</button>
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
              <table class="data-table">
                <thead><tr>
                  <th>名称</th><th>类型</th><th>地区</th><th>状态</th><th>最后在线</th>
                </tr></thead>
                <tbody>
                  <tr v-for="n in nodes.slice(0,5)" :key="n.id">
                    <td style="font-weight:600;color:var(--color-text-primary)">{{ n.name }}</td>
                    <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                    <td>{{ n.region || '-' }}</td>
                    <td><span class="status-badge" :class="isOnline(n)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(n)?'在线':'离线' }}</span></td>
                    <td class="text-muted">{{ timeAgo(n.lastSeenAt) }}</td>
                  </tr>
                  <tr v-if="nodes.length===0"><td colspan="5" class="text-center text-muted" style="padding:32px">暂无节点</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Nodes Page -->
        <div v-if="currentPage==='nodes'" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">节点管理</h1><p class="page-subtitle">管理您的代理节点</p></div>
              <button class="btn btn-primary" @click="showCreateNode=true">+ 添加节点</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr>
                <th>名称</th><th>类型</th><th>地区</th><th>域名</th><th>状态</th><th>连接数</th><th>流量</th><th>操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="n in nodes" :key="n.id" class="cursor-pointer" @click="selectNode(n)">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ n.name }}</td>
                  <td><span class="tag" :class="{accent:n.nodeType==='edge'}">{{ n.nodeType }}</span></td>
                  <td>{{ n.region || '-' }}</td>
                  <td class="text-mono truncate">{{ n.primaryDomain || '-' }}</td>
                  <td><span class="status-badge" :class="isOnline(n)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(n)?'在线':'离线' }}</span></td>
                  <td>{{ n.currentConnections }}</td>
                  <td class="text-muted" style="font-size:12px">↑{{ formatBytes(n.bytesOutTotal) }} ↓{{ formatBytes(n.bytesInTotal) }}</td>
                  <td>
                    <button class="btn btn-sm btn-secondary" @click.stop="publishRelease(n.id)">发布</button>
                  </td>
                </tr>
                <tr v-if="nodes.length===0"><td colspan="8"><div class="empty-state"><div class="empty-state-icon">🖥️</div><div class="empty-state-title">暂无节点</div><div class="empty-state-text">添加您的第一个代理节点以开始使用</div><button class="btn btn-primary" @click="showCreateNode=true">+ 添加节点</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Templates Page -->
        <div v-if="currentPage==='templates'" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">模板管理</h1><p class="page-subtitle">协议配置模板</p></div>
              <button class="btn btn-primary" @click="openCreateTemplate">+ 添加模板</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>名称</th><th>引擎</th><th>协议</th><th>传输</th><th>TLS</th><th>更新时间</th></tr></thead>
              <tbody>
                <tr v-for="t in templates" :key="t.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ t.name }}</td>
                  <td><span class="tag" :class="{accent:t.engine==='sing-box'}">{{ t.engine }}</span></td>
                  <td>{{ t.protocol }}</td>
                  <td>{{ t.transport }}</td>
                  <td><span class="status-badge" :class="t.tlsMode==='reality'?'applying':t.tlsMode==='tls'?'healthy':'offline'">{{ t.tlsMode }}</span></td>
                  <td class="text-muted">{{ timeAgo(t.updatedAt) }}</td>
                </tr>
                <tr v-if="templates.length===0"><td colspan="6"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">暂无模板</div><div class="empty-state-text">创建协议模板来配置您的节点</div><button class="btn btn-primary" @click="openCreateTemplate">+ 添加模板</button></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Subscriptions Page -->
        <div v-if="currentPage==='subscriptions'" class="animate-fade-in">
          <div class="page-header">
            <div class="page-header-row">
              <div><h1 class="page-title">订阅管理</h1><p class="page-subtitle">管理订阅端点</p></div>
              <button class="btn btn-primary" @click="showCreateSub=true">+ 添加订阅</button>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>名称</th><th>令牌</th><th>状态</th><th>可见节点</th><th>创建时间</th></tr></thead>
              <tbody>
                <tr v-for="s in subscriptions" :key="s.id">
                  <td style="font-weight:600;color:var(--color-text-primary)">{{ s.name }}</td>
                  <td class="text-mono truncate">{{ s.token }}</td>
                  <td><span class="status-badge" :class="s.enabled?'online':'offline'"><span class="status-dot"></span>{{ s.enabled?'已启用':'已禁用' }}</span></td>
                  <td>{{ s.visibleNodeIds.length || '全部' }}</td>
                  <td class="text-muted">{{ timeAgo(s.createdAt) }}</td>
                </tr>
                <tr v-if="subscriptions.length===0"><td colspan="5"><div class="empty-state"><div class="empty-state-icon">🔗</div><div class="empty-state-title">暂无订阅</div><div class="empty-state-text">创建订阅以供客户端访问</div><button class="btn btn-primary" @click="showCreateSub=true">+ 添加订阅</button></div></td></tr>
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
          <button class="modal-close-btn" @click="selectedNode=null">✕</button>
        </div>
        <div class="detail-panel-body">
          <div class="detail-section">
            <div class="detail-section-title">基本信息</div>
            <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value text-mono">{{ selectedNode.id }}</span></div>
            <div class="detail-row"><span class="detail-label">类型</span><span class="detail-value"><span class="tag" :class="{accent:selectedNode.nodeType==='edge'}">{{ selectedNode.nodeType }}</span></span></div>
            <div class="detail-row"><span class="detail-label">地区</span><span class="detail-value">{{ selectedNode.region || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">域名</span><span class="detail-value text-mono">{{ selectedNode.primaryDomain || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">入口 IP</span><span class="detail-value text-mono">{{ selectedNode.entryIp || '-' }}</span></div>
            <div class="detail-row"><span class="detail-label">状态</span><span class="detail-value"><span class="status-badge" :class="isOnline(selectedNode)?'online':'offline'"><span class="status-dot"></span>{{ isOnline(selectedNode)?'在线':'离线' }}</span></span></div>
            <div class="detail-row"><span class="detail-label">最后在线</span><span class="detail-value">{{ timeAgo(selectedNode.lastSeenAt) }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">资源监控</div>
            <div class="detail-row"><span class="detail-label">CPU</span><span class="detail-value">{{ selectedNode.cpuUsagePercent !== null ? selectedNode.cpuUsagePercent + '%' : '-' }}</span></div>
            <div v-if="selectedNode.cpuUsagePercent!==null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="selectedNode.cpuUsagePercent>80?'danger':selectedNode.cpuUsagePercent>50?'warning':'success'" :style="{width:selectedNode.cpuUsagePercent+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">内存</span><span class="detail-value">{{ selectedNode.memoryUsagePercent !== null ? selectedNode.memoryUsagePercent + '%' : '-' }}</span></div>
            <div v-if="selectedNode.memoryUsagePercent!==null" class="progress-bar mb-md"><div class="progress-bar-fill" :class="selectedNode.memoryUsagePercent>80?'danger':selectedNode.memoryUsagePercent>50?'warning':'success'" :style="{width:selectedNode.memoryUsagePercent+'%'}"></div></div>
            <div class="detail-row"><span class="detail-label">连接数</span><span class="detail-value">{{ selectedNode.currentConnections }}</span></div>
            <div class="detail-row"><span class="detail-label">入站流量</span><span class="detail-value">{{ formatBytes(selectedNode.bytesInTotal) }}</span></div>
            <div class="detail-row"><span class="detail-label">出站流量</span><span class="detail-value">{{ formatBytes(selectedNode.bytesOutTotal) }}</span></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">发布记录 ({{ nodeReleases.length }})</div>
            <div v-for="r in nodeReleases.slice(0,5)" :key="r.id" class="card mb-md" style="padding:12px">
              <div class="flex items-center justify-between gap-sm">
                <span style="font-weight:600;font-size:13px">版本 #{{ r.revision }}</span>
                <span class="status-badge" :class="r.status">{{ r.status }}</span>
              </div>
              <div class="text-muted" style="font-size:11px;margin-top:4px">{{ r.kind }} · {{ timeAgo(r.createdAt) }}</div>
              <div v-if="r.summary" style="font-size:12px;margin-top:4px;color:var(--color-text-secondary)">{{ r.summary }}</div>
            </div>
            <div v-if="nodeReleases.length===0" class="text-muted text-center" style="padding:16px;font-size:12px">暂无发布记录</div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title">安装脚本</div>
            <button v-if="!installScript" class="btn btn-secondary btn-sm w-full" @click="loadInstallScript">加载安装脚本</button>
            <div v-else class="code-block" style="max-height:200px;overflow-y:auto">{{ installScript }}</div>
          </div>
        </div>
      </aside>
    </template>

    <!-- Create Node Modal -->
    <div v-if="showCreateNode" class="modal-overlay" @click.self="showCreateNode=false">
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">新建节点</h3><button class="modal-close-btn" @click="showCreateNode=false">✕</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newNode.name" placeholder="例如 US-West-01" /></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">类型</label><select class="form-select" v-model="newNode.nodeType"><option value="vps">VPS</option><option value="edge">Edge</option></select></div>
            <div class="form-group"><label class="form-label">地区</label><input class="form-input" v-model="newNode.region" placeholder="例如 us-west" /></div>
          </div>
          <div class="form-group"><label class="form-label">主域名</label><input class="form-input" v-model="newNode.primaryDomain" placeholder="node.example.com" /></div>
          <div class="form-group"><label class="form-label">入口 IP</label><input class="form-input" v-model="newNode.entryIp" placeholder="1.2.3.4" /></div>
          <div class="form-row">
            <div class="form-checkbox-group"><input type="checkbox" class="form-checkbox" v-model="newNode.installWarp" id="warp"><label for="warp" class="form-label" style="margin:0">安装 WARP</label></div>
            <div class="form-checkbox-group"><input type="checkbox" class="form-checkbox" v-model="newNode.installArgo" id="argo"><label for="argo" class="form-label" style="margin:0">安装 Argo</label></div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateNode=false">取消</button><button class="btn btn-primary" @click="createNode">创建</button></div>
      </div>
    </div>

    <!-- Create Template Modal -->
    <div v-if="showCreateTemplate" class="modal-overlay" @click.self="showCreateTemplate=false">
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">新建模板</h3><button class="modal-close-btn" @click="showCreateTemplate=false">✕</button></div>
        <div class="modal-body">
          <div v-if="catalogPresets.length" class="mb-lg">
            <label class="form-label">从预设快速创建</label>
            <div class="flex gap-sm" style="flex-wrap:wrap">
              <button v-for="p in catalogPresets" :key="p.id" class="btn btn-sm btn-secondary" @click="applyPreset(p)">{{ p.name }}</button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newTemplate.name" placeholder="例如 VLESS-WS-TLS" /></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">引擎</label><select class="form-select" v-model="newTemplate.engine"><option value="xray">Xray</option><option value="sing-box">Sing-Box</option></select></div>
            <div class="form-group"><label class="form-label">协议</label><input class="form-input" v-model="newTemplate.protocol" placeholder="vless" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">传输方式</label><input class="form-input" v-model="newTemplate.transport" placeholder="ws" /></div>
            <div class="form-group"><label class="form-label">TLS 模式</label><select class="form-select" v-model="newTemplate.tlsMode"><option value="none">无</option><option value="tls">TLS</option><option value="reality">Reality</option></select></div>
          </div>
          <div class="form-group"><label class="form-label">备注</label><textarea class="form-textarea" v-model="newTemplate.notes" placeholder="可选备注信息..."></textarea></div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateTemplate=false">取消</button><button class="btn btn-primary" @click="createTemplate">创建</button></div>
      </div>
    </div>

    <!-- Create Subscription Modal -->
    <div v-if="showCreateSub" class="modal-overlay" @click.self="showCreateSub=false">
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">新建订阅</h3><button class="modal-close-btn" @click="showCreateSub=false">✕</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">名称 *</label><input class="form-input" v-model="newSub.name" placeholder="例如 主订阅" /></div>
          <div class="form-checkbox-group mb-md"><input type="checkbox" class="form-checkbox" v-model="newSub.enabled" id="sub-en"><label for="sub-en" class="form-label" style="margin:0">启用</label></div>
          <div class="form-group" v-if="nodes.length">
            <label class="form-label">可见节点（留空表示全部）</label>
            <div style="max-height:150px;overflow-y:auto;border:1px solid var(--glass-border);border-radius:var(--radius-md);padding:8px">
              <label v-for="n in nodes" :key="n.id" class="form-checkbox-group mb-md" style="cursor:pointer">
                <input type="checkbox" class="form-checkbox" :value="n.id" v-model="newSub.visibleNodeIds" />
                <span style="font-size:13px">{{ n.name }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" @click="showCreateSub=false">取消</button><button class="btn btn-primary" @click="createSub">创建</button></div>
      </div>
    </div>
  </div>
</template>
