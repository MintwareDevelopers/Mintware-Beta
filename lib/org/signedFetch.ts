// Thin client helper for the org routes' signed-message auth. Builds the canonical `{action, issuedAt}`
// message the routeHandler expects (it JSON-parses authMessage and binds action + issuedAt to the
// signature — see lib/web2/routeHandler.ts), signs it, and posts `{...payload, address, issuedAt,
// authMessage, authSignature}`. Reuse across the org action pages so none reinvent the plumbing.

export async function signedOrgFetch(opts: {
  path: string
  action: string
  method?: 'POST' | 'PATCH'
  payload?: Record<string, unknown>
  address: string
  signMessageAsync: (args: { message: string }) => Promise<string>
}): Promise<Response> {
  const issuedAt = Date.now()
  const authMessage = JSON.stringify({ action: opts.action, issuedAt })
  const authSignature = await opts.signMessageAsync({ message: authMessage })
  return fetch(opts.path, {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(opts.payload ?? {}), address: opts.address, issuedAt, authMessage, authSignature }),
  })
}
