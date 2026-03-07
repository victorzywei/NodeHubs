import { Hono } from 'hono'
import { createNodeSchema, heartbeatSchema, publishNodeSchema, updateNodeSchema } from '@contracts/index'
import { requireAdmin, requireAgentToken } from '../lib/auth'
import { fail, ok } from '../lib/response'
import {
  acknowledgeRelease,
  createNode,
  deleteNode,
  getDesiredRelease,
  getNodeInstallTarget,
  getNodeById,
  getReleaseById,
  listNodeReleases,
  listNodeTraffic,
  listNodes,
  previewNodeRelease,
  publishNodeRelease,
  recordHeartbeat,
  resolveAgentNode,
  updateNode,
} from '../services/control-plane'
import { buildAgentInstallScript, buildAgentReconcileEnv, buildReleaseApplyScript, buildDeployCommand, buildUninstallCommand } from '../services/agent-install'
import { parseReleaseArtifact } from '../services/release-renderer'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const nodeRoutes = new Hono<AppEnv>()

nodeRoutes.get('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  return ok(await listNodes(c.get('services')))
})

nodeRoutes.post('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = createNodeSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid node body', 400)
  return ok(await createNode(c.get('services'), parsed.data), 201)
})

nodeRoutes.get('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const node = await getNodeById(c.get('services'), c.req.param('id'))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(node)
})

nodeRoutes.patch('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = updateNodeSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid node body', 400)
  const node = await updateNode(c.get('services'), c.req.param('id'), parsed.data)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(node)
})

nodeRoutes.delete('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const nodeId = c.req.param('id')
  const removed = await deleteNode(c.get('services'), nodeId)
  if (!removed) return fail('NOT_FOUND', 'Node not found', 404)
  return ok({ deleted: nodeId })
})

nodeRoutes.get('/:id/releases', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  return ok(await listNodeReleases(c.get('services'), c.req.param('id')))
})

nodeRoutes.post('/:id/releases/preview', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = publishNodeSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid preview body', 400)
  let preview = null
  try {
    preview = await previewNodeRelease(c.get('services'), c.req.param('id'), parsed.data.kind, parsed.data.templateIds, parsed.data.message)
  } catch (error) {
    return fail('PREVIEW_FAILED', error instanceof Error ? error.message : 'Failed to render release preview', 400)
  }
  if (!preview) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(preview)
})

nodeRoutes.post('/:id/releases', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = publishNodeSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid publish body', 400)
  let release = null
  try {
    release = await publishNodeRelease(c.get('services'), c.req.param('id'), parsed.data.kind, parsed.data.templateIds, parsed.data.message)
  } catch (error) {
    return fail('PUBLISH_FAILED', error instanceof Error ? error.message : 'Failed to publish node release', 400)
  }
  if (!release) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(release, 201)
})

nodeRoutes.get('/:id/traffic', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const limit = Number(c.req.query('limit') || 24)
  return ok(await listNodeTraffic(c.get('services'), c.req.param('id'), Number.isFinite(limit) ? limit : 24))
})

nodeRoutes.get('/agent/install', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const script = buildAgentInstallScript({
    publicBaseUrl: c.get('services').publicBaseUrl,
    nodeId: nodeRow.id,
    agentToken: nodeRow.agent_token,
  })
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${nodeRow.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'node'}-install.sh"`,
    },
  })
})

nodeRoutes.get('/:id/install-script', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const target = await getNodeInstallTarget(c.get('services'), c.req.param('id'))
  if (!target) return fail('NOT_FOUND', 'Node not found', 404)
  const script = buildAgentInstallScript({
    publicBaseUrl: c.get('services').publicBaseUrl,
    nodeId: target.id,
    agentToken: target.agentToken,
  })
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${target.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'node'}-install.sh"`,
    },
  })
})

nodeRoutes.get('/:id/deploy-command', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const target = await getNodeInstallTarget(c.get('services'), c.req.param('id'))
  if (!target) return fail('NOT_FOUND', 'Node not found', 404)
  const command = buildDeployCommand({
    publicBaseUrl: c.get('services').publicBaseUrl,
    nodeId: target.id,
    agentToken: target.agentToken,
  })
  return ok({ command })
})

nodeRoutes.get('/:id/uninstall-command', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const node = await getNodeById(c.get('services'), c.req.param('id'))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  const command = buildUninstallCommand()
  return ok({ command })
})

nodeRoutes.post('/agent/heartbeat', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = heartbeatSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid heartbeat body', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), parsed.data.nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth
  const node = await recordHeartbeat(c.get('services'), parsed.data)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(node)
})

nodeRoutes.get('/agent/reconcile', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const desired = await getDesiredRelease(c.get('services'), nodeId)
  const format = c.req.query('format') || 'json'
  if (!desired || !desired.release) {
    const payload = {
      nodeId,
      needsUpdate: false,
      currentReleaseRevision: nodeRow.current_release_revision,
    }
    if (format === 'env') {
      return new Response(
        buildAgentReconcileEnv({
          nodeId,
          needsUpdate: false,
          currentReleaseRevision: Number(nodeRow.current_release_revision || 0),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      )
    }
    return ok(payload)
  }

  const applyUrl = `${c.get('services').publicBaseUrl}/api/nodes/agent/releases/${desired.release.id}/apply-script?nodeId=${encodeURIComponent(nodeId)}`
  const artifactUrl = `${c.get('services').publicBaseUrl}/api/nodes/agent/releases/${desired.release.id}/artifact?nodeId=${encodeURIComponent(nodeId)}`
  if (format === 'env') {
    return new Response(
      buildAgentReconcileEnv({
        nodeId,
        needsUpdate: true,
        currentReleaseRevision: desired.node.currentReleaseRevision,
        desiredReleaseRevision: desired.node.desiredReleaseRevision,
        releaseId: desired.release.id,
        applyUrl,
        artifactUrl,
        status: desired.release.status,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    )
  }

  return ok({
    nodeId,
    needsUpdate: true,
    currentReleaseRevision: desired.node.currentReleaseRevision,
    desiredReleaseRevision: desired.node.desiredReleaseRevision,
    releaseId: desired.release.id,
    applyUrl,
    artifactUrl,
    status: desired.release.status,
  })
})

nodeRoutes.get('/agent/releases/:releaseId/artifact', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const release = await getReleaseById(c.get('services'), c.req.param('releaseId'))
  if (!release || release.node_id !== nodeId) return fail('NOT_FOUND', 'Release not found', 404)
  const artifact = await c.get('services').artifacts.get(release.artifact_key)
  if (!artifact) return fail('NOT_FOUND', 'Artifact not found', 404)
  return new Response(artifact.body, {
    status: 200,
    headers: {
      'Content-Type': artifact.contentType,
      ETag: `"${artifact.etag}"`,
      'Cache-Control': 'no-store',
    },
  })
})

nodeRoutes.get('/agent/releases/:releaseId/apply-script', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const release = await getReleaseById(c.get('services'), c.req.param('releaseId'))
  if (!release || release.node_id !== nodeId) return fail('NOT_FOUND', 'Release not found', 404)
  const artifact = await c.get('services').artifacts.get(release.artifact_key)
  if (!artifact) return fail('NOT_FOUND', 'Artifact not found', 404)
  const parsed = parseReleaseArtifact(artifact.body)
  if (!parsed) return fail('INTERNAL', 'Release artifact is invalid', 500)
  const script = buildReleaseApplyScript(parsed)
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
})

nodeRoutes.post('/agent/releases/:releaseId/ack', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    nodeId?: string
    status?: 'applying' | 'healthy' | 'failed'
    message?: string
  } | null
  const nodeId = String(body?.nodeId || '')
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow) return fail('UNAUTHORIZED', 'Invalid node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth
  if (!body?.status || !['applying', 'healthy', 'failed'].includes(body.status)) {
    return fail('VALIDATION', 'status must be applying, healthy or failed', 400)
  }
  const release = await acknowledgeRelease(
    c.get('services'),
    nodeId,
    c.req.param('releaseId'),
    body.status,
    String(body.message || ''),
  )
  if (!release) return fail('NOT_FOUND', 'Release not found', 404)
  return ok(release)
})
