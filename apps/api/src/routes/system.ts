import { Hono } from 'hono'
import { requireAdmin } from '../lib/auth'
import { fail, ok } from '../lib/response'
import { buildSystemStatus } from '../services/control-plane'
import { buildAgentInstallScript } from '../services/agent-install'
import type { AppServices } from '../lib/app-types'

type AppEnv = { Variables: { services: AppServices } }

export const systemRoutes = new Hono<AppEnv>()

systemRoutes.get('/install-script', async (c) => {
  const script = buildAgentInstallScript({
    publicBaseUrl: c.get('services').publicBaseUrl,
  })
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Disposition': 'inline; filename="nodehubsapi-install.sh"',
    },
  })
})

systemRoutes.get('/status', async (c) => {
  const auth = requireAdmin(c)
  if (auth) return auth
  try {
    return ok(await buildSystemStatus(c.get('services')))
  } catch (error) {
    return fail('INTERNAL', error instanceof Error ? error.message : 'failed to load system status', 500)
  }
})
