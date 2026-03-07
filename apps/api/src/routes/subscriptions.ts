import { Hono } from 'hono'
import { createSubscriptionSchema, subscriptionDocumentFormatSchema, updateSubscriptionSchema } from '@contracts/index'
import { requireAdmin } from '../lib/auth'
import { fail, ok } from '../lib/response'
import { buildPublicSubscriptionDocument, createSubscription, deleteSubscription, listSubscriptions, updateSubscription } from '../services/control-plane'
import { renderSubscriptionDocument } from '../services/release-renderer'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const subscriptionRoutes = new Hono<AppEnv>()
export const publicSubscriptionRoutes = new Hono<AppEnv>()

subscriptionRoutes.get('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  return ok(await listSubscriptions(c.get('services')))
})

subscriptionRoutes.post('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = createSubscriptionSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid subscription body', 400)
  return ok(await createSubscription(c.get('services'), parsed.data), 201)
})

subscriptionRoutes.patch('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = updateSubscriptionSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid subscription body', 400)
  const subscription = await updateSubscription(c.get('services'), c.req.param('id'), parsed.data)
  if (!subscription) return fail('NOT_FOUND', 'Subscription not found', 404)
  return ok(subscription)
})

subscriptionRoutes.delete('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const deleted = await deleteSubscription(c.get('services'), c.req.param('id'))
  if (!deleted) return fail('NOT_FOUND', 'Subscription not found', 404)
  return ok({ deleted: c.req.param('id') })
})

publicSubscriptionRoutes.get('/:token', async (c) => {
  const formatValue = c.req.query('format') || 'base64'
  const format = subscriptionDocumentFormatSchema.safeParse(formatValue)
  if (!format.success) {
    return fail('VALIDATION', 'format must be plain, base64, json, v2ray, clash or singbox', 400)
  }

  const payload = await buildPublicSubscriptionDocument(c.get('services'), c.req.param('token'))
  if (!payload) return fail('NOT_FOUND', 'Subscription not found', 404)

  const rendered = renderSubscriptionDocument(payload, format.data)
  return new Response(rendered.body, {
    status: 200,
    headers: {
      'Content-Type': rendered.contentType,
      'Cache-Control': 'no-store',
    },
  })
})
