import {
  fail,
  json,
  readBackendProfiles,
  requirePanelAuth,
  writeBackendProfiles,
  type PanelFunctionContext,
} from '../../_shared/panel'

export async function onRequestGet(context: PanelFunctionContext) {
  const auth = await requirePanelAuth(context)
  if (auth) return auth

  return json({
    profiles: await readBackendProfiles(context.env),
  })
}

export async function onRequestPut(context: PanelFunctionContext) {
  const auth = await requirePanelAuth(context)
  if (auth) return auth

  let body: { profiles?: unknown } | unknown
  try {
    body = await context.request.json()
  } catch {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const profiles = Array.isArray(body)
    ? body
    : (body && typeof body === 'object' ? (body as { profiles?: unknown }).profiles : null)

  if (!Array.isArray(profiles)) {
    return fail('BAD_REQUEST', 'profiles must be an array', 400)
  }

  return json({
    profiles: await writeBackendProfiles(context.env, profiles),
  })
}
