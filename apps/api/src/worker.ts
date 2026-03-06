import { createApp } from './app'
import { getWorkerServices, type WorkerBindings } from './runtime-worker'

const apiApp = createApp((request, env) => getWorkerServices(env as WorkerBindings, request.url))

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin || '*')
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key')
  headers.set('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname
    if (pathname.startsWith('/api/') || pathname.startsWith('/sub/')) {
      const origin = request.headers.get('Origin')
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
            Vary: 'Origin',
          },
        })
      }
      const response = await apiApp.fetch(request, env, ctx)
      return withCors(response, origin)
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }
    return apiApp.fetch(request, env, ctx)
  },
}
