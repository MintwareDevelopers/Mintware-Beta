// RED-TEAM PoC (off-chain, 2026-09-08) — signed-message binding gaps + bearer posture.
// createHandler binds ONLY `action` + `issuedAt` to the signature. The gateway deposit/withdraw/buffer
// messages also embed `txHash` and `pool`, but the routes used to read those from the BODY and never
// compare them to the signed payload — so one captured signature (15-min window) was good for ANY txHash /
// ANY pool of that wallet on that route.
//
// STATUS AFTER CLOSE-OUT:
//   • The two factory-level cases below STILL PASS and are kept as evidence: `createHandler` alone has no
//     txHash/pool binding and no nonce (a shared nonce store + EIP-712 remain the HO-12 follow-up).
//   • O-10 (ui-money-path.md): the binding now lives in the ROUTES — `lib/gateway/recordAuth.ts#bindSignedRecord`
//     (401 `auth_payload_mismatch` on any body≠signed drift, 409 `auth_replayed` on a re-presented signature);
//     the `_FIXED` siblings lock that.
//   • O-12 (discovery-hygiene.md): the `NODE_ENV=development` bearer pass-through is CLOSED — flipped below.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { createHandler } from '@/lib/web2/routeHandler'
import { buildGatewayDepositMessage } from '@/lib/web3/signedActionMessages'
import { bindSignedRecord, _resetReplayGuard } from '@/lib/gateway/recordAuth'

// throwaway test key (hardhat #0 — public, worthless)
const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://x.test/api/gateway/deposit', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) as unknown as Parameters<ReturnType<typeof createHandler>>[0]
}

describe('signed-message: txHash / pool inside the signed payload are NOT bound by the FACTORY (evidence — the binding is route-level, see _FIXED)', () => {
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
    expect(seen!.txHash).toBe('0x' + 'bb'.repeat(32)) // ← the factory hands the route body B although the wallet signed A
    expect(seen!.pool).toBe('pool-y')
  })

  it('the same signature is replayable an unlimited number of times inside the 15-min window at the factory (no nonce/jti)', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: '0x' + 'aa'.repeat(32), pool: null, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    let hits = 0
    const handler = createHandler(async (_r, ctx) => { hits++; return ctx.json({ ok: true }) }, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
    for (let i = 0; i < 5; i++) await handler(post({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: `0x${i.toString(16).padStart(64, '0')}` }))
    expect(hits).toBe(5)
  })
})

describe('signed-message _FIXED (O-10): the deposit/withdraw ROUTES bind the signed txHash/pool to the body and refuse a re-presented signature', () => {
  beforeEach(() => _resetReplayGuard())

  it('defense holds: body (txHash B, pool Y) against a signature over (txHash A, pool X) → auth_payload_mismatch; the route never acts on B', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: '0x' + 'aa'.repeat(32), pool: 'pool-x', issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    expect(bindSignedRecord({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: '0x' + 'bb'.repeat(32), pool: 'pool-y' })).toEqual({ ok: false, error: 'auth_payload_mismatch' })
    expect(bindSignedRecord({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: '0x' + 'aa'.repeat(32), pool: 'pool-y' })).toEqual({ ok: false, error: 'auth_payload_mismatch' })
    // the honest body passes, and the route acts on the SIGNED values (lower-cased)
    expect(bindSignedRecord({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: '0x' + 'AA'.repeat(32), pool: 'POOL-X' })).toEqual({ ok: true, bound: { txHash: '0x' + 'aa'.repeat(32), pool: 'pool-x' } })
  })

  it('defense holds: the same signature presented twice inside the window → auth_replayed on the second (per-process; the UNIQUE tx_hash ledger is the durable backstop)', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: '0x' + 'aa'.repeat(32), pool: null, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const body = { address: wallet.address, authMessage, authSignature, issuedAt, txHash: '0x' + 'aa'.repeat(32) }
    expect(bindSignedRecord(body).ok).toBe(true)
    for (let i = 0; i < 4; i++) expect(bindSignedRecord(body)).toEqual({ ok: false, error: 'auth_replayed' })
    // …and the old "5 different txHashes on one signature" loop is refused on every iteration
    for (let i = 0; i < 5; i++) {
      expect(bindSignedRecord({ ...body, txHash: `0x${i.toString(16).padStart(64, '0')}` })).toEqual({ ok: false, error: 'auth_payload_mismatch' })
    }
  })
})

describe('bearer posture (curator / cron routes) — MITIGATED in prod, and now CLOSED in development too (O-12)', () => {
  const orig = process.env.NODE_ENV
  afterEach(() => { vi.unstubAllEnvs(); (process.env as Record<string, string | undefined>).NODE_ENV = orig })

  it('bearerSecret "" (LP_GATEWAY_CURATOR_SECRET unset) → 500 MISSING_SECRET outside development (fail-closed)', async () => {
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', bearerSecret: '' })
    const res = await handler(post({}, { authorization: 'Bearer anything' }))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('MISSING_SECRET')
  })

  it('_FIXED: in NODE_ENV=development the same route now FAILS CLOSED (500 MISSING_SECRET) — no header, no secret ⇒ no approve/register', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ALLOW_DEV_BEARER_BYPASS', '')
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', bearerSecret: '' })
    const res = await handler(post({ action: 'approve' }))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('MISSING_SECRET')
  })

  it('_FIXED: the dev bypass is an EXPLICIT opt-in (ALLOW_DEV_BEARER_BYPASS=true) and is ignored outside development', async () => {
    vi.stubEnv('ALLOW_DEV_BEARER_BYPASS', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', bearerSecret: '' })
    expect((await handler(post({ action: 'approve' }))).status).toBe(200) // deliberate, logged, dev-only
    for (const env of ['production', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      expect((await handler(post({ action: 'approve' }))).status).toBe(500)
    }
  })

  it('cron routes export GET = POST; a bearer-less GET is rejected (Vercel cron supplies the header)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-not-real')
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token' })
    const res = await handler(new Request('https://x.test/api/cron/gateway-harvest') as unknown as Parameters<ReturnType<typeof createHandler>>[0])
    expect(res.status).toBe(401)
  })
})
