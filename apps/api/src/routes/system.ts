import { Hono } from 'hono'
import { requireAdmin } from '../lib/auth'
import { fail, ok } from '../lib/response'
import { buildSystemStatus } from '../services/control-plane'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const systemRoutes = new Hono<AppEnv>()

systemRoutes.get('/status', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  try {
    return ok(await buildSystemStatus(c.get('services')))
  } catch (error) {
    return fail('INTERNAL', error instanceof Error ? error.message : 'failed to load system status', 500)
  }
})
