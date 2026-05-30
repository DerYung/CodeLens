// Shared helpers for the serverless API routes. Files prefixed with "_" are not
// exposed as endpoints by Vercel, so this is a safe place for shared code.

export interface ApiResponse {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
}

// Log only an error's message — never the request payload — so user source code
// can never end up in Vercel's retained runtime logs. Always log through this
// instead of console.error so a stray `console.error(req.body)` can't leak code.
export function logError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(label, message)
}

// Reject requests that don't carry the shared app token, returning true when the
// caller should stop. This blocks blind bots that hit the public endpoints
// directly. The token ships in the browser bundle (VITE_ prefix), so it is not a
// hard secret — it filters automated abuse, not a determined user who reads it
// from devtools. If VITE_APP_TOKEN is unset (e.g. local dev), the check is
// skipped so the app still works without configuration.
export function rejectIfUnauthorized(
  token: string | string[] | undefined,
  res: ApiResponse
): boolean {
  const expected = process.env.VITE_APP_TOKEN
  if (!expected) return false
  const provided = Array.isArray(token) ? token[0] : token
  if (provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' })
    return true
  }
  return false
}
