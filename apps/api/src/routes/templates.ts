import { Hono } from 'hono'
import { createTemplateSchema, updateTemplateSchema } from '@contracts/index'
import { requireAdmin } from '../lib/auth'
import { fail, ok } from '../lib/response'
import { createTemplate, listTemplates, updateTemplate } from '../services/control-plane'
import { listTemplatePresets } from '../services/release-renderer'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const templateRoutes = new Hono<AppEnv>()

templateRoutes.get('/catalog', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  return ok(listTemplatePresets())
})

templateRoutes.get('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  return ok(await listTemplates(c.get('services')))
})

templateRoutes.post('/', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = createTemplateSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid template body', 400)
  try {
    return ok(await createTemplate(c.get('services'), parsed.data), 201)
  } catch (error) {
    return fail('VALIDATION', error instanceof Error ? error.message : 'invalid template body', 400)
  }
})

templateRoutes.patch('/:id', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  const body = await c.req.json().catch(() => null)
  const parsed = updateTemplateSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message || 'invalid template body', 400)
  let template = null
  try {
    template = await updateTemplate(c.get('services'), c.req.param('id'), parsed.data)
  } catch (error) {
    return fail('VALIDATION', error instanceof Error ? error.message : 'invalid template body', 400)
  }
  if (!template) return fail('NOT_FOUND', 'Template not found', 404)
  return ok(template)
})
