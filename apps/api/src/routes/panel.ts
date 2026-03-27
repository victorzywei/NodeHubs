import { Hono } from 'hono'
import type { AppServices } from '../lib/app-types'
import {
  clearSessionCookie,
  createSessionCookie,
  readPanelBackendProfiles,
  requirePanelAuth,
  verifyPanelPassword,
  writePanelBackendProfiles,
} from '../lib/panel'
import { fail, ok } from '../lib/response'

type AppEnv = { Variables: { services: AppServices } }

export const panelRoutes = new Hono<AppEnv>()

panelRoutes.get('/session', async (c) => {
  const auth = await requirePanelAuth(c)
  if (auth) return auth
  return ok({ authenticated: true })
})

panelRoutes.post('/session', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const payload = body as { password?: unknown }
  const password = typeof payload.password === 'string' ? payload.password : ''
  const auth = await verifyPanelPassword(c.get('services'), password)
  if (auth) return auth

  const response = ok({ authenticated: true })
  response.headers.set('Set-Cookie', await createSessionCookie(c.req.raw, c.get('services')))
  return response
})

panelRoutes.delete('/session', async (c) => {
  const response = ok({ authenticated: false })
  response.headers.set('Set-Cookie', clearSessionCookie(c.req.raw))
  return response
})

panelRoutes.get('/backend-profiles', async (c) => {
  const auth = await requirePanelAuth(c)
  if (auth) return auth

  return ok({
    profiles: await readPanelBackendProfiles(c.get('services')),
  })
})

panelRoutes.put('/backend-profiles', async (c) => {
  const auth = await requirePanelAuth(c)
  if (auth) return auth

  const body = await c.req.json().catch(() => null)
  if (!body) {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const payload = body as { profiles?: unknown }
  const profiles = Array.isArray(body)
    ? body
    : (typeof body === 'object' ? payload.profiles : null)

  if (!Array.isArray(profiles)) {
    return fail('BAD_REQUEST', 'profiles must be an array', 400)
  }

  return ok({
    profiles: await writePanelBackendProfiles(c.get('services'), profiles),
  })
})
