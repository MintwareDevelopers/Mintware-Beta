// RED-TEAM PoC (off-chain, 2026-09-08) — signed-message binding gaps + bearer posture.
// createHandler binds ONLY `action` + `issuedAt` to the signature. The gateway deposit/withdraw/buffer
// messages also embed `txHash` and `pool`, but the routes read those from the BODY and never compare
// them to the signed payload — so one captured signature (15-min window) is good for ANY txHash /
// ANY pool of that wallet on that route. (Funds impact is bounded by the on-chain event check; see report.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { createHandler } from '@/lib/web2/routeHandler'
import { buildGatewayDepositMessage } from '@/lib/web3/signedActionMessages'

// throwaway test key (hardhat #0 — public, worthless)
const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://x.test/api/gateway/deposit', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) as unknown as Parameters<ReturnType<typeof createHandler>>[0]
}

describe('signed-message: txHash / pool inside the signed payload are NOT bound to the body', () => {
  it('a signature over (txHash A, pool X) is accepted by the route factory with body (txHash B, pool Y)', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: '0x' + 'aa'.repeat(32), pool: 'pool-x', issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })

    let seen: Record<string, unknown> | null = null
    const handler = createHandler(async (req, ctx) => {
      seen = await req.clone().json()
      return ctx.json({ ok: true, user: ctx.user })
    }, { auth: 'signed-message', action: 'mintware-gateway-deposit' })

    const res = await handler(post({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: '0x' + 'bb'.repeat(32), pool: 'pool-y' }))
    expect(res.status).toBe(200)
    expect(seen!.txHash).toBe('0x' + 'bb'.repeat(32)) // ← route acts on B although the wallet signed A
    expect(seen!.pool).toBe('pool-y')
  })

  it('the same signature is replayable an unlimited number of times inside the 15-min window (no nonce/jti)', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: '0x' + 'aa'.repeat(32), pool: null, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    let hits = 0
    const handler = createHandler(async (_r, ctx) => { hits++; return ctx.json({ ok: true }) }, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
    for (let i = 0; i < 5; i++) await handler(post({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: `0x${i.toString(16).padStart(64, '0')}` }))
    expect(hits).toBe(5)
  })
})

describe('bearer posture (curator / cron routes) — MITIGATED in prod, OPEN in development', () => {
  const orig = process.env.NODE_ENV
  afterEach(() => { vi.unstubAllEnvs(); process.env.NODE_ENV = orig })

  it('bearerSecret "" (LP_GATEWAY_CURATOR_SECRET unset) → 500 MISSING_SECRET outside development (fail-closed)', async () => {
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', bearerSecret: '' })
    const res = await handler(post({}, { authorization: 'Bearer anything' }))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('MISSING_SECRET')
  })

  it('…but in NODE_ENV=development the same route accepts ANY caller with NO header (curate/approve/register open on a dev box)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', bearerSecret: '' })
    const res = await handler(post({ action: 'approve' }))
    expect(res.status).toBe(200)
  })

  it('cron routes export GET = POST; a bearer-less GET is rejected (Vercel cron supplies the header)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-not-real')
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token' })
    const res = await handler(new Request('https://x.test/api/cron/gateway-harvest') as unknown as Parameters<ReturnType<typeof createHandler>>[0])
    expect(res.status).toBe(401)
  })
})
