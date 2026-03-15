import { Hono } from 'hono'
import { edgeHeartbeatSchema } from '@contracts/index'
import { fail, ok } from '../lib/response'
import { requireAgentToken } from '../lib/auth'
import {
  acknowledgeRelease,
  getDesiredRelease,
  getReleaseById,
  recordEdgeHeartbeat,
  resolveAgentNode,
} from '../services/control-plane'
import { readEdgeWorkerPlan } from '../services/edge-worker'
import { parseReleaseArtifact } from '../services/release-renderer'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const edgeRoutes = new Hono<AppEnv>()

edgeRoutes.get('/reconcile', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow || nodeRow.node_type !== 'edge') return fail('UNAUTHORIZED', 'Invalid edge node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const desired = await getDesiredRelease(c.get('services'), nodeId)
  if (!desired || !desired.release) {
    return ok({
      nodeId,
      needsUpdate: false,
      currentReleaseRevision: Number(nodeRow.current_release_revision || 0),
      workerDomain: nodeRow.worker_domain || '',
    })
  }

  return ok({
    nodeId,
    needsUpdate: true,
    currentReleaseRevision: desired.node.currentReleaseRevision,
    desiredReleaseRevision: desired.node.desiredReleaseRevision,
    releaseId: desired.release.id,
    workerDomain: nodeRow.worker_domain || '',
    planUrl: `${c.get('services').publicBaseUrl}/api/edge/releases/${desired.release.id}/plan?nodeId=${encodeURIComponent(nodeId)}`,
  })
})

edgeRoutes.get('/releases/:releaseId/plan', async (c) => {
  const nodeId = c.req.query('nodeId') || ''
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow || nodeRow.node_type !== 'edge') return fail('UNAUTHORIZED', 'Invalid edge node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth

  const release = await getReleaseById(c.get('services'), c.req.param('releaseId'))
  if (!release || release.node_id !== nodeId) return fail('NOT_FOUND', 'Release not found', 404)
  const artifact = await c.get('services').artifacts.get(release.artifact_key)
  if (!artifact) return fail('NOT_FOUND', 'Artifact not found', 404)
  const parsed = parseReleaseArtifact(artifact.body)
  if (!parsed) return fail('INTERNAL', 'Release artifact is invalid', 500)
  const plan = readEdgeWorkerPlan(parsed)
  if (!plan) return fail('INTERNAL', 'Edge worker plan is missing', 500)

  return ok({
    ...plan,
    workerDomain: nodeRow.worker_domain || plan.workerDomain,
  })
})

edgeRoutes.post('/heartbeat', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = edgeHeartbeatSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid edge heartbeat body', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), parsed.data.nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow || nodeRow.node_type !== 'edge') return fail('UNAUTHORIZED', 'Invalid edge node credentials', 401)
  const auth = requireAgentToken(c, nodeRow.agent_token)
  if (auth) return auth
  const node = await recordEdgeHeartbeat(c.get('services'), parsed.data)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(node)
})

edgeRoutes.post('/releases/:releaseId/ack', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    nodeId?: string
    status?: 'applying' | 'healthy' | 'failed'
    message?: string
    applyLog?: string
  } | null
  const nodeId = String(body?.nodeId || '')
  if (!nodeId) return fail('VALIDATION', 'nodeId is required', 400)
  const nodeRow = await resolveAgentNode(c.get('services'), nodeId, c.req.header('X-Agent-Token') || '')
  if (!nodeRow || nodeRow.node_type !== 'edge') return fail('UNAUTHORIZED', 'Invalid edge node credentials', 401)
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
    typeof body?.applyLog === 'string' ? body.applyLog : '',
  )
  if (!release) return fail('NOT_FOUND', 'Release not found', 404)
  return ok(release)
})
