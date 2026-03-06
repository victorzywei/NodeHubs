function meta() {
  return {
    at: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  }
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json(
    {
      success: true,
      data,
      meta: meta(),
    },
    { status },
  )
}

export function fail(code: string, message: string, status = 400): Response {
  return Response.json(
    {
      success: false,
      error: {
        code,
        message,
      },
      meta: meta(),
    },
    { status },
  )
}
