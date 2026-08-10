import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { createHandler } from './routeHandler'

// A signed-message route that only succeeds if auth passed.
const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
)

function buildMsg(action: string, issuedAt: number, address: string) {
  // Canonical JSON shape mirrors lib/web3/signedActionMessages.ts (action + issuedAt embedded).
  return JSON.stringify({ action, address: address.toLowerCase(), issuedAt }, null, 2)
}

async function callRoute(
  opts: Parameters<typeof createHandler>[1],
  body: Record<string, unknown>,
) {
  const handler = createHandler(async (_req, ctx) => ctx.json({ ok: true }), opts)
  const req = new Request('https://x.test/api/thing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  // createHandler returns (req: NextRequest) => ...; a plain Request satisfies the runtime surface.
  return handler(req as unknown as Parameters<ReturnType<typeof createHandler>>[0])
}

describe('createHandler signed-message binding (audit MED: replay / action)', () => {
  const action = 'mintware-test-action'

  async function signedBody(overrides: Partial<{ issuedAt: number; signedIssuedAt: number; action: string }> = {}) {
    const issuedAt = overrides.issuedAt ?? Date.now()
    const signedIssuedAt = overrides.signedIssuedAt ?? issuedAt
    const signedAction = overrides.action ?? action
    const authMessage = buildMsg(signedAction, signedIssuedAt, account.address)
    const authSignature = await account.signMessage({ message: authMessage })
    return { authMessage, authSignature, issuedAt, address: account.address }
  }

  it('accepts a well-formed, fresh, action-matched signature', async () => {
    const res = await callRoute({ auth: 'signed-message', action }, await signedBody())
    expect(res.status).toBe(200)
  })

  it('rejects a replay with a fresh body issuedAt that is NOT the signed issuedAt', async () => {
    // Attacker captures a signature (signed at T0) and replays with a fresh body issuedAt.
    const t0 = Date.now()
    const body = await signedBody({ issuedAt: Date.now(), signedIssuedAt: t0 - 1 })
    const res = await callRoute({ auth: 'signed-message', action }, body)
    expect(res.status).toBe(401) // AUTH_MISMATCH — issuedAt not bound to the signature
  })

  it('rejects a signature whose action does not match the route', async () => {
    const body = await signedBody({ action: 'some-other-action' })
    const res = await callRoute({ auth: 'signed-message', action }, body)
    expect(res.status).toBe(401) // cross-action replay guard
  })

  it('rejects a stale signature (outside the 15-min window)', async () => {
    const stale = Date.now() - 16 * 60 * 1000
    const body = await signedBody({ issuedAt: stale, signedIssuedAt: stale })
    const res = await callRoute({ auth: 'signed-message', action }, body)
    expect(res.status).toBe(401) // AUTH_EXPIRED
  })

  it('rejects a non-JSON signed message', async () => {
    const authMessage = 'i am not json'
    const authSignature = await account.signMessage({ message: authMessage })
    const res = await callRoute(
      { auth: 'signed-message', action },
      { authMessage, authSignature, issuedAt: Date.now(), address: account.address },
    )
    expect(res.status).toBe(401) // AUTH_MALFORMED
  })
})

describe('createHandler bearer-token (audit LOW: constant-time compare)', () => {
  const SECRET = 'top-secret-cron-token'

  async function callBearer(authHeader: string | undefined) {
    const handler = createHandler(async (_req, ctx) => ctx.json({ ok: true }), {
      auth: 'bearer-token',
      bearerSecret: SECRET,
    })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (authHeader !== undefined) headers['authorization'] = authHeader
    const req = new Request('https://x.test/api/cron', { method: 'POST', headers, body: '{}' })
    return handler(req as unknown as Parameters<ReturnType<typeof createHandler>>[0])
  }

  it('accepts the correct bearer token', async () => {
    const res = await callBearer(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
  })

  it('rejects a wrong token of the same length', async () => {
    const wrong = 'x'.repeat(`Bearer ${SECRET}`.length - 'Bearer '.length)
    const res = await callBearer(`Bearer ${wrong}`)
    expect(res.status).toBe(401)
  })

  it('rejects a token of a different length (no timing-safe crash)', async () => {
    const res = await callBearer('Bearer short')
    expect(res.status).toBe(401)
  })

  it('rejects a missing Authorization header', async () => {
    const res = await callBearer(undefined)
    expect(res.status).toBe(401)
  })
})
