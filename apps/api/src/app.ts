import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppServices } from './lib/app-types'
import { fail } from './lib/response'
import { nodeRoutes } from './routes/nodes'
import { publicSubscriptionRoutes, subscriptionRoutes } from './routes/subscriptions'
import { systemRoutes } from './routes/system'
import { templateRoutes } from './routes/templates'

type AppEnv = { Variables: { services: AppServices } }

export function createApp(resolveServices: (request: Request, env: unknown) => Promise<AppServices> | AppServices) {
  const app = new Hono<AppEnv>()

  app.use('/api/*', cors())
  app.use('*', async (c, next) => {
    c.set('services', await resolveServices(c.req.raw, c.env))
    await next()
  })

  app.route('/api/system', systemRoutes)
  app.route('/api/templates', templateRoutes)
  app.route('/api/subscriptions', subscriptionRoutes)
  app.route('/api/nodes', nodeRoutes)
  app.route('/sub', publicSubscriptionRoutes)

  app.notFound(() => fail('NOT_FOUND', 'Route not found', 404))
  app.onError((error) => fail('INTERNAL', error.message || 'Unhandled application error', 500))

  return app
}
