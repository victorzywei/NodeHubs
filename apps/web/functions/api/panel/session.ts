import {
  clearSessionCookie,
  createSessionCookie,
  fail,
  json,
  requirePanelAuth,
  verifyPanelPassword,
  type PanelFunctionContext,
} from '../../_shared/panel'

export async function onRequestGet(context: PanelFunctionContext) {
  const auth = await requirePanelAuth(context)
  if (auth) return auth
  return json({ authenticated: true })
}

export async function onRequestPost(context: PanelFunctionContext) {
  let password = ''

  try {
    const body = await context.request.json() as { password?: unknown }
    password = typeof body.password === 'string' ? body.password : ''
  } catch {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const auth = await verifyPanelPassword(context.env, password)
  if (auth) return auth

  return json(
    { authenticated: true },
    { headers: { 'Set-Cookie': await createSessionCookie(context.request, context.env) } },
  )
}

export async function onRequestDelete(context: PanelFunctionContext) {
  return json(
    { authenticated: false },
    { headers: { 'Set-Cookie': clearSessionCookie(context.request) } },
  )
}
