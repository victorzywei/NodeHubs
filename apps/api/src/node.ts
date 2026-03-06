import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createApp } from './app'
import { getNodeServices } from './runtime-node'

const apiApp = createApp(() => getNodeServices())
const serverApp = new Hono()
const webDist = resolve(process.cwd(), 'apps/web/dist')

const mimeByExtension: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

serverApp.all('/api/*', (c) => apiApp.fetch(c.req.raw))
serverApp.all('/sub/*', (c) => apiApp.fetch(c.req.raw))

serverApp.get('*', async (c) => {
  if (!existsSync(webDist)) {
    return new Response('Web bundle not found. Run `npm run build -w apps/web` first.', { status: 404 })
  }

  const pathname = new URL(c.req.url).pathname
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = resolve(webDist, relativePath)
  const indexPath = resolve(webDist, 'index.html')
  const chosenPath = existsSync(filePath) ? filePath : indexPath
  const body = readFileSync(chosenPath)
  const extension = extname(chosenPath)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mimeByExtension[extension] || 'application/octet-stream',
      'Cache-Control': chosenPath === indexPath ? 'no-store' : 'public, max-age=300',
    },
  })
})

const port = Number(process.env.PORT || 3000)

serve({
  fetch: serverApp.fetch,
  port,
})
