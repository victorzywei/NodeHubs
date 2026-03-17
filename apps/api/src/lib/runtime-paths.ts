import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function isApiWorkspaceDir(candidate: string): boolean {
  return existsSync(resolve(candidate, 'package.json')) && existsSync(resolve(candidate, 'migrations'))
}

export function resolveApiWorkspaceDir(): string {
  const cwd = process.cwd()
  if (isApiWorkspaceDir(cwd)) return cwd

  const nestedWorkspaceDir = resolve(cwd, 'apps/api')
  if (isApiWorkspaceDir(nestedWorkspaceDir)) return nestedWorkspaceDir

  return nestedWorkspaceDir
}

export function resolveApiStoragePath(filename: string): string {
  return resolve(resolveApiWorkspaceDir(), 'storage', filename)
}

export function resolveApiMigrationsDir(): string {
  return resolve(resolveApiWorkspaceDir(), 'migrations')
}

export function resolveWebDistDir(): string {
  return resolve(resolveApiWorkspaceDir(), '../web/dist')
}
