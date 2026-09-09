// =============================================================================
// Hacken-style off-chain audit PoCs — LP Gateway V1 (2026-09-08).
// Read-only evidence for docs/developers/audits/2026-09-08-hacken-style-offchain.md.
//
// STATUS AFTER CLOSE-OUT (docs/developers/audits/closeout/*.md) — the suite is FLIPPED, like the contract
// PoC suites: each test replays the ORIGINAL attack steps and asserts the FIXED behaviour ("defense holds").
//   HO-1  unsigned UI body → still 401 (unchanged; the client now signs — O-1)
//   HO-2  unknown pool → 404 on the money path; env rig only while the registry is empty, live:false (O-2)
//   HO-3  registerInstance reads before write; ACTIVE row ⇒ refused, no upsert (O-3 / A-7)
//   HO-4  factory-level replay STILL passes (evidence); route-level binding/replay refusal is the _FIXED sibling (O-10)
//   HO-5  sparklines: junk ids never keyed or fetched (400), per-IP 429 floor, per-id cache (O-8)
//   HO-6  /request: pool id / chain / label validated at the edge (HO-10)
//   HO-7  Discover marks live ONLY from ACTIVE instances (HO-11)
// Nothing here touches a network, a chain, or Supabase — every external seam is mocked.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256 } from 'viem'
import { fakeSupabase } from './fakeSupabase'

// ── generic fluent Supabase stub ─────────────────────────────────────────────────────────────────
// Every builder method returns the same chainable object; awaiting it (or .maybeSingle()) resolves
// `result`. `calls` records (method, args) so a test can assert which filters were (not) applied.
function fluent(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const self: Record<string, unknown> = {}
  const methods = ['from', 'select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'not', 'gt']
  for (const m of methods) self[m] = (...args: unknown[]) => { calls.push([m, args]); return self }
  self.maybeSingle = () => { calls.push(['maybeSingle', []]); return Promise.resolve(result) }
  self.single = () => Promise.resolve(result)
  // awaiting the builder itself (e.g. `const { data } = await q`)
  self.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return { client: self as never, calls }
}

// Hoisted mutable state so the hoisted vi.mock factories can be re-pointed per test.
const state = vi.hoisted(() => ({
  supabase: null as unknown,
  cfg: null as unknown,
  readContract: (async () => { throw new Error('rpc') }) as (a: unknown) => Promise<unknown>,
  fetchHotPools: (async () => []) as (...a: unknown[]) => Promise<unknown[]>,
}))

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({ readContract: (a: unknown) => state.readContract(a) }),
}))
vi.mock('@/lib/gateway/discovery', () => ({
  fetchHotPools: (...a: unknown[]) => state.fetchHotPools(...a),
  // 2026-09-09 fix: discover route now imports discoverUsdgEnv() directly — mirror its real fallback.
  discoverUsdgEnv: () => process.env.LP_GATEWAY_DISCOVER_USDG ?? process.env.LP_GATEWAY_USDG,
}))

const FALLBACK_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11'
const CFG_WITH_FALLBACK = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: FALLBACK_PM, staging: null, poolAddress: 'pons-usdg' }
const REG_POOL = '0x' + 'ab'.repeat(32)
const REG_ROW = { pool_address: REG_POOL, chain_id: 46630, position_manager: '0x' + 'aa'.repeat(20), staging: '0x' + 'dd'.repeat(20), quote_asset: '0x' + '11'.repeat(20), status: 'active' }

function req(url: string, init?: RequestInit) {
  const r = new Request(url, init)
  // routes read req.nextUrl.searchParams — a plain Request lacks nextUrl; patch it on.
  ;(r as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return r as never
}

beforeEach(() => {
  state.supabase = fluent({ data: null, error: null }).client
  state.cfg = CFG_WITH_FALLBACK
  state.readContract = async () => { throw new Error('rpc') }
  state.fetchHotPools = async () => []
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-1 · the OLD unsigned UI deposit-record body is still refused (unchanged — the client now signs, O-1)', () => {
  it('POST /api/gateway/deposit with the body the pre-fix V1PoolDetail sent → 401 AUTH_REQUIRED', async () => {
    // Pre-fix components/web2/v1/V1PoolDetail.tsx sent { address, txHash, pool } — no authMessage / authSignature /
    // issuedAt. The M-04 route requires them. The fix is on the CLIENT (it signs the exact route message now) +
    // a positive-path route test — never a loosening of this refusal.
    const { POST } = await import('@/app/api/gateway/deposit/route')
    const res = await POST(req('https://mintware.test/api/gateway/deposit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x' + '11'.repeat(20), txHash: '0x' + 'ab'.repeat(32), pool: 'pons-usdg' }),
    }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('AUTH_REQUIRED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-2 _FIXED · an unknown /earn/[pool] slug is a 404 on the money path; the env rig is never advertised as live', () => {
  it('RESIDUAL (read-only alerts only): the legacy registry.resolveRouteInstance still returns the env fallback on a miss', async () => {
    const { resolveRouteInstance } = await import('@/lib/gateway/registry')
    const { client } = fluent({ data: null, error: null }) // registry: no row for this pool
    const inst = await resolveRouteInstance(client, CFG_WITH_FALLBACK as never, 'totally-different-meme-usdg-0.7%')
    expect(inst?.positionManager).toBe(FALLBACK_PM)
    expect(inst?.poolAddress).toBe('pons-usdg')
    // …but no money-path route consumes it any more — they all go through resolveInstanceStrict (below).
  })

  it('defense holds: resolveInstanceStrict → 404 pool_not_live for the same slug while the registry is populated', async () => {
    const { resolveInstanceStrict } = await import('@/lib/gateway/routeInstance')
    const { client } = fluent({ data: [REG_ROW], error: null })
    expect(await resolveInstanceStrict(client, CFG_WITH_FALLBACK as never, 'totally-different-meme-usdg-0.7%')).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })

  it('defense holds: GET /api/gateway/meta?pool=<unknown> → 404 while the registry is populated (no PM, no live:true)', async () => {
    state.supabase = fluent({ data: [REG_ROW], error: null }).client
    const { GET } = await import('@/app/api/gateway/meta/route')
    const res = await GET(req('https://mintware.test/api/gateway/meta?pool=not-a-registered-pool'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, error: 'pool_not_live' })
    expect(body.meta).toBeUndefined()
  })

  it('defense holds: registry EMPTY → unknown pool is still 404; the env rig is served only for its own pool, tagged env-fallback with live:false', async () => {
    state.supabase = fluent({ data: null, error: null }).client
    const { GET } = await import('@/app/api/gateway/meta/route')
    expect((await GET(req('https://mintware.test/api/gateway/meta?pool=not-a-registered-pool'))).status).toBe(404)
    const res = await GET(req('https://mintware.test/api/gateway/meta?pool=pons-usdg'))
    expect(res.status).toBe(200)
    const { meta } = await res.json()
    expect(meta.positionManager).toBe(FALLBACK_PM)
    expect(meta.source).toBe('env-fallback')
    expect(meta.live).toBe(false) // derived from an ACTIVE registry row — never the literal `true` the old route.ts:63 carried
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-3 _FIXED · registerInstance reads before it writes; an ACTIVE instance is never hot-swapped (A-7)', () => {
  const QUOTE = '0x1111111111111111111111111111111111111111' as const
  const STAGING = '0x' + 'dd'.repeat(20)
  const key = { currency0: QUOTE, currency1: '0x2222222222222222222222222222222222222222' as `0x${string}`, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' as `0x${string}` }
  const CODE = '0x6080604052a0d17ed1' as const
  const trust = { factory: null, pmCodeHashes: [keccak256(CODE)], expectedQuoteAsset: QUOTE }
  // a candidate that passes every on-chain check (audited bytecode + consistent wiring) — the ORIGINAL PoC's
  // "verified candidate": the point is that verification alone must NOT be enough to overwrite a live row
  const verifiedCandidate = {
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (address.toLowerCase() === STAGING) return functionName === 'controller' ? '0x' + 'ee'.repeat(20) : QUOTE
      if (functionName === 'quoteAsset') return QUOTE
      if (functionName === 'poolKey') return key
      if (functionName === 'staging') return STAGING
      throw new Error(`unexpected ${functionName}`)
    },
    getCode: async () => CODE,
  }

  it('defense holds: a fully-verified candidate for an ACTIVE pool is refused (`active_instance_exists`); no upsert, no update — only a history "refused" row', async () => {
    const { registerInstance, computePoolId } = await import('@/lib/gateway/registry')
    const poolId = computePoolId(key)
    const { db, client } = fakeSupabase({ tables: {
      gateway_instances: [{ id: 'live', pool_address: poolId, chain_id: 46630, position_manager: '0x' + 'aa'.repeat(20), staging: '0x' + 'bb'.repeat(20), quote_asset: QUOTE, status: 'active' }],
      gateway_instance_history: [],
    } })
    const r = await registerInstance(client, { poolAddress: poolId, chainId: 46630, positionManager: '0x' + 'ee'.repeat(20), staging: STAGING, quoteAsset: QUOTE }, { client: verifiedCandidate, trust })
    expect(r).toEqual({ ok: false, error: 'active_instance_exists' })
    const ops = db.calls.filter((c) => c.table === 'gateway_instances').map((c) => c.op)
    expect(ops).toEqual(['select']) // existence/active check FIRST, then nothing
    expect(db.calls.map((c) => c.op)).not.toContain('upsert') // upsert is gone from the write side entirely
    expect(db.tables.gateway_instances[0].position_manager).toBe('0x' + 'aa'.repeat(20))
    expect(db.tables.gateway_instance_history).toEqual([expect.objectContaining({ action: 'refused', reason: 'active_instance_exists' })])
  })

  it('defense holds: registering the IDENTICAL live pair is an idempotent no-op (nothing written); a fresh pool is an insert with the VERIFIED quote', async () => {
    const { registerInstance, computePoolId } = await import('@/lib/gateway/registry')
    const poolId = computePoolId(key)
    const { db, client } = fakeSupabase({ tables: {
      gateway_instances: [{ id: 'live', pool_address: poolId, chain_id: 46630, position_manager: '0x' + 'ee'.repeat(20), staging: STAGING, quote_asset: QUOTE, status: 'active' }],
      gateway_instance_history: [],
    } })
    const same = await registerInstance(client, { poolAddress: poolId, chainId: 46630, positionManager: '0x' + 'EE'.repeat(20), staging: STAGING }, { client: verifiedCandidate, trust })
    expect(same).toEqual({ ok: true, unchanged: true, verification: 'codehash' })
    expect(db.calls.filter((c) => c.table === 'gateway_instances' && c.op !== 'select')).toHaveLength(0)
    expect(db.tables.gateway_instance_history).toHaveLength(0)
    // a genuinely new pool: insert (never upsert), quote_asset = the on-chain/env-verified value, curator body ignored
    db.tables.gateway_instances.length = 0
    const fresh = await registerInstance(client, { poolAddress: poolId, chainId: 46630, positionManager: '0x' + 'ee'.repeat(20), staging: STAGING, quoteAsset: '0x' + '99'.repeat(20) }, { client: verifiedCandidate, trust })
    expect(fresh).toEqual({ ok: true, verification: 'codehash' })
    expect(db.calls.filter((c) => c.table === 'gateway_instances' && c.op !== 'select').map((c) => c.op)).toEqual(['insert'])
    expect(db.tables.gateway_instances[0]).toMatchObject({ status: 'active', quote_asset: QUOTE, verification: 'codehash' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-4 · signed-message auth has no nonce at the FACTORY (evidence, Low) — the routes bind + refuse replay (O-10)', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

  it('the same signed body is accepted twice by createHandler alone (no single-use nonce / jti at the factory)', async () => {
    const { createHandler } = await import('@/lib/web2/routeHandler')
    const issuedAt = Date.now()
    const authMessage = JSON.stringify({ action: 'mintware-gateway-buffer', address: account.address.toLowerCase(), issuedAt, pool: null }, null, 2)
    const authSignature = await account.signMessage({ message: authMessage })
    const handler = createHandler(async (_r, ctx) => ctx.json({ who: ctx.user?.address }), { auth: 'signed-message', action: 'mintware-gateway-buffer' })
    const mk = () => req('https://mintware.test/api/gateway/position', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account.address, authMessage, authSignature, issuedAt }) })
    const a = await handler(mk())
    const b = await handler(mk())
    expect(a.status).toBe(200)
    expect(b.status).toBe(200) // factory-level: replay inside the freshness window succeeds (HO-12 follow-up = shared nonce store / EIP-712)
  })

  it('_FIXED: the deposit/withdraw routes claim each signature once and bind the signed txHash/pool to the body (bindSignedRecord)', async () => {
    const { bindSignedRecord, _resetReplayGuard } = await import('@/lib/gateway/recordAuth')
    const { buildGatewayDepositMessage } = await import('@/lib/web3/signedActionMessages')
    _resetReplayGuard()
    const issuedAt = Date.now()
    const txHash = '0x' + 'ab'.repeat(32)
    const authMessage = buildGatewayDepositMessage({ address: account.address, txHash, pool: REG_POOL, issuedAt })
    const authSignature = await account.signMessage({ message: authMessage })
    const body = { address: account.address, authMessage, authSignature, issuedAt, txHash, pool: REG_POOL }
    expect(bindSignedRecord(body)).toEqual({ ok: true, bound: { txHash, pool: REG_POOL } })
    expect(bindSignedRecord(body)).toEqual({ ok: false, error: 'auth_replayed' }) // second presentation → 409 at the route
    _resetReplayGuard()
    expect(bindSignedRecord({ ...body, txHash: '0x' + 'cd'.repeat(32) })).toEqual({ ok: false, error: 'auth_payload_mismatch' }) // → 401 at the route
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-5 _FIXED · /api/gateway/sparklines validates ids before keying, caps fan-out, and has a per-IP floor (O-8)', () => {
  it('defense holds: 25 distinct junk ?pools= sets → 400 INVALID_IDS (then the 429 floor), ZERO upstream calls, nothing cached', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [] } } }) }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { resetSparklineCache } = await import('@/lib/gateway/sparkline')
      resetSparklineCache()
      const { GET } = await import('@/app/api/gateway/sparklines/route')
      const N = 25
      const statuses: number[] = []
      for (let i = 0; i < N; i++) {
        const junk = 'x'.repeat(2000) + i // not a 20- or 32-byte hex id — used to be accepted straight into the module-level Map key
        const res = await GET(req(`https://mintware.test/api/gateway/sparklines?pools=${junk}`, { headers: { 'x-forwarded-for': '198.51.100.77' } }))
        statuses.push(res.status)
        if (res.status === 400) expect((await res.json()).code).toBe('INVALID_IDS')
        if (res.status === 429) expect((await res.json()).code).toBe('RATE_LIMITED')
      }
      expect(statuses.every((s) => s === 400 || s === 429)).toBe(true)
      expect(statuses.filter((s) => s === 400).length).toBe(20) // the per-IP bucket (20 burst) then floors the rest
      expect(statuses.filter((s) => s === 429).length).toBe(5)
      expect(fetchSpy).toHaveBeenCalledTimes(0) // was N upstream fan-outs; now none

      // a well-formed id from another IP: ONE upstream call, and a repeat is served from the per-id cache
      const id = '0x' + 'f'.repeat(63) + '1'
      const r1 = await GET(req(`https://mintware.test/api/gateway/sparklines?pools=${id}`, { headers: { 'x-forwarded-for': '198.51.100.78' } }))
      expect(r1.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const r2 = await GET(req(`https://mintware.test/api/gateway/sparklines?pools=${id},${id.toUpperCase()}`, { headers: { 'x-forwarded-for': '198.51.100.78' } }))
      expect((await r2.json()).stats).toMatchObject({ hits: 1, misses: 0 })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-6 _FIXED · /api/gateway/request rejects free-text pool_address / foreign chain_id at the edge (HO-10)', () => {
  it('defense holds: the ORIGINAL body → 400 bad_pool_id with no insert; a well-formed request lands with the label capped at 64', async () => {
    const { client, calls } = fluent({ data: null, error: null })
    state.supabase = client
    const { POST } = await import('@/app/api/gateway/request/route')
    const post = (body: Record<string, unknown>) => POST(req('https://mintware.test/api/gateway/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

    const res = await post({ poolAddress: 'PONS / USDG <b>looks legit</b>', chainId: 999999, pairLabel: 'x'.repeat(5000) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad_pool_id')
    expect(calls.find(([m]) => m === 'insert')).toBeUndefined()

    const wrongChain = await post({ poolAddress: REG_POOL, chainId: 999999 })
    expect(wrongChain.status).toBe(400)
    expect((await wrongChain.json()).error).toBe('unsupported_chain')
    expect(calls.find(([m]) => m === 'insert')).toBeUndefined()

    const ok = await post({ poolAddress: REG_POOL.toUpperCase(), chainId: 46630, pairLabel: 'x'.repeat(5000) })
    expect(ok.status).toBe(200)
    const ins = calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>
    expect(ins.pool_address).toBe(REG_POOL)
    expect(ins.chain_id).toBe(46630)
    expect(String(ins.pair_label).length).toBe(64) // manual path now caps like the auto path
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-7 _FIXED · Discover marks a pool live ONLY from ACTIVE gateway_instances (HO-11)', () => {
  it('defense holds: an inactive (deactivated) instance renders live:false; the read filters status=active', async () => {
    const POOL = '0x' + 'ab'.repeat(32)
    const { db, client } = fakeSupabase({ tables: { gateway_instances: [{ pool_address: POOL, chain_id: 46630, status: 'inactive' }] } })
    state.supabase = client
    state.cfg = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: null, staging: null, poolAddress: null }
    state.fetchHotPools = async () => [{ poolAddress: POOL, pairLabel: 'X / USDG', tvlUsd: 1, vol24Usd: 1, priceQuotePerBase: null, signals: { volTvlRatio: null, poolAgeDays: null, txCount24: null }, score: 0, verdict: 'review', reasons: [], baseSymbol: 'X', quoteSymbol: 'USDG', baseLogo: null, quoteLogo: null, feePct: null, estFeeAprPct: null }]
    vi.resetModules() // fresh module-level 3-min cache
    const { GET } = await import('@/app/api/gateway/discover/route')
    const res = await GET(req('https://mintware.test/api/gateway/discover'))
    const body = await res.json()
    expect(body.pools[0].live).toBe(false)
    const read = db.calls.find((c) => c.table === 'gateway_instances' && c.op === 'select')!
    expect(read.filters.map((f) => [f.col, f.val])).toEqual(expect.arrayContaining([['chain_id', 46630], ['status', 'active']])) // was chain_id only
    // flip the row to active → live:true (the instances read is per-request; only the upstream feed is cached)
    db.tables.gateway_instances[0].status = 'active'
    expect((await (await GET(req('https://mintware.test/api/gateway/discover'))).json()).pools[0].live).toBe(true)
  })
})
