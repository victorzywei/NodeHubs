import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const assetDir = resolve(rootDir, 'assets')
const targets = [resolve(rootDir, 'dist/node/assets'), resolve(rootDir, 'dist/worker/assets')]

if (!existsSync(assetDir)) {
  throw new Error(`Asset directory not found: ${assetDir}`)
}

for (const target of targets) {
  mkdirSync(target, { recursive: true })
  cpSync(assetDir, target, { recursive: true })
}
