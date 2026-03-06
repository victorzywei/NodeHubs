import type { Context } from 'hono'
import type { AppServices } from './app-types'
import { fail } from './response'

export function requireAdmin(c: Context<{ Variables: { services: AppServices } }>): Response | null {
  const services = c.get('services')
  const provided = c.req.header('X-Admin-Key') || ''
  if (!services.adminKey) return fail('CONFIG_ERROR', 'ADMIN_KEY is missing', 500)
  if (provided !== services.adminKey) return fail('UNAUTHORIZED', 'Invalid admin key', 401)
  return null
}

export function requireAgentToken(c: Context, expectedToken: string): Response | null {
  const provided = c.req.header('X-Agent-Token') || ''
  if (!provided) return fail('UNAUTHORIZED', 'X-Agent-Token is required', 401)
  if (provided !== expectedToken) return fail('UNAUTHORIZED', 'Invalid agent token', 401)
  return null
}
