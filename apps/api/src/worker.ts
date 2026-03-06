import { createApp } from './app'
import { getWorkerServices, type WorkerBindings } from './runtime-worker'

const apiApp = createApp((request, env) => getWorkerServices(env as WorkerBindings, request.url))

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname
    if (pathname.startsWith('/api/') || pathname.startsWith('/sub/')) {
      return apiApp.fetch(request, env, ctx)
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }
    return apiApp.fetch(request, env, ctx)
  },
}
