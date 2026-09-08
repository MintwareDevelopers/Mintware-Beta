// =============================================================================
// Hacken-style off-chain audit PoCs — LP Gateway V1 (2026-09-08).
// Read-only evidence for docs/developers/audits/2026-09-08-hacken-style-offchain.md.
// Each test asserts the CURRENT behaviour (a passing test == the finding is confirmed).
// Nothing here touches a network, a chain, or Supabase — every external seam is mocked.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'

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
  fetchSparklines: (async () => ({})) as (...a: unknown[]) => Promise<Record<string, number[]>>,
  fetchHotPools: (async () => []) as (...a: unknown[]) => Promise<unknown[]>,
}))

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({ readContract: (a: unknown) => state.readContract(a) }),
}))
vi.mock('@/lib/gateway/sparkline', () => ({ fetchSparklines: (...a: unknown[]) => state.fetchSparklines(...a) }))
vi.mock('@/lib/gateway/discovery', () => ({ fetchHotPools: (...a: unknown[]) => state.fetchHotPools(...a) }))

const FALLBACK_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11'
const CFG_WITH_FALLBACK = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: FALLBACK_PM, staging: null, poolAddress: 'pons-usdg' }

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
  state.fetchSparklines = async () => ({})
  state.fetchHotPools = async () => []
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-1 · the UI deposit-record call cannot satisfy the signed-message route (CONFIRMED)', () => {
  it('POST /api/gateway/deposit with the exact body V1PoolDetail sends → 401 AUTH_REQUIRED', async () => {
    // components/web2/v1/V1PoolDetail.tsx:131 sends { address, txHash, pool } — no authMessage /
    // authSignature / issuedAt. The M-04 route requires them, so EVERY UI deposit is left unrecorded
    // (gateway_positions never written) while the UI still shows "Deposited ✓".
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
describe('HO-2 · any unknown /earn/[pool] slug resolves to the single-env fallback PM, reported live:true (CONFIRMED)', () => {
  it('resolveRouteInstance returns the env fallback when the registry has no match for the pool', async () => {
    const { resolveRouteInstance } = await import('@/lib/gateway/registry')
    const { client } = fluent({ data: null, error: null }) // registry: no row for this pool
    const inst = await resolveRouteInstance(client, CFG_WITH_FALLBACK as never, 'totally-different-meme-usdg-0.7%')
    expect(inst?.positionManager).toBe(FALLBACK_PM)
    expect(inst?.poolAddress).toBe('pons-usdg') // the deposit gets recorded against the FALLBACK pool, not the one the user viewed
  })

  it('GET /api/gateway/meta?pool=<unknown> advertises the fallback PM as the deposit target with live:true hard-coded', async () => {
    const { GET } = await import('@/app/api/gateway/meta/route')
    const res = await GET(req('https://mintware.test/api/gateway/meta?pool=not-a-registered-pool'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.meta.positionManager).toBe(FALLBACK_PM)
    expect(body.meta.live).toBe(true) // route.ts:63 — literal `live: true`, never derived from the registry
    expect(body.meta.usdg).toBe(process.env.LP_GATEWAY_USDG ?? null) // env-global, NOT the instance's quote_asset
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-3 · registry upsert hot-swaps an ACTIVE instance without any read-before-write (A-7 re-verify, CONFIRMED)', () => {
  it('registerInstance never selects the existing row; a verified candidate overwrites position_manager for a live pool', async () => {
    const { registerInstance, computePoolId } = await import('@/lib/gateway/registry')
    const QUOTE = '0x1111111111111111111111111111111111111111'
    const key = { currency0: QUOTE as `0x${string}`, currency1: '0x2222222222222222222222222222222222222222' as `0x${string}`, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' as `0x${string}` }
    const poolId = computePoolId(key)
    const { client, calls } = fluent({ data: null, error: null })
    const readClient = { readContract: async ({ functionName }: { functionName: string }) => (functionName === 'quoteAsset' ? QUOTE : key) }
    const r = await registerInstance(client, { poolAddress: poolId, chainId: 46630, positionManager: '0x' + 'ee'.repeat(20), staging: '0x' + 'dd'.repeat(20), quoteAsset: QUOTE }, { client: readClient as never })
    expect(r.ok).toBe(true)
    const methods = calls.map(([m]) => m)
    expect(methods).toContain('upsert')
    expect(methods).not.toContain('select') // no existence / active check before the overwrite
    const upsertArgs = calls.find(([m]) => m === 'upsert')![1] as [Record<string, unknown>, { onConflict: string }]
    expect(upsertArgs[1].onConflict).toBe('pool_address,chain_id')
    expect(upsertArgs[0].status).toBe('active')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-4 · signed-message auth has no nonce — a captured (message, signature) replays for 15 min (CONFIRMED, Low)', () => {
  it('the same signed body is accepted twice on the same route', async () => {
    const { createHandler } = await import('@/lib/web2/routeHandler')
    const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    const issuedAt = Date.now()
    const authMessage = JSON.stringify({ action: 'mintware-gateway-buffer', address: account.address.toLowerCase(), issuedAt, pool: null }, null, 2)
    const authSignature = await account.signMessage({ message: authMessage })
    const handler = createHandler(async (_r, ctx) => ctx.json({ who: ctx.user?.address }), { auth: 'signed-message', action: 'mintware-gateway-buffer' })
    const mk = () => req('https://mintware.test/api/gateway/position', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account.address, authMessage, authSignature, issuedAt }) })
    const a = await handler(mk())
    const b = await handler(mk())
    expect(a.status).toBe(200)
    expect(b.status).toBe(200) // no single-use nonce / jti — replay inside the freshness window succeeds
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-5 · /api/gateway/sparklines cache is keyed by attacker-controlled, unvalidated id-sets (CONFIRMED, Low)', () => {
  it('every distinct ?pools= set is a cache miss and an upstream fan-out; junk ids are stored as cache keys', async () => {
    const spy = vi.fn(async () => ({}))
    state.fetchSparklines = spy
    const { GET } = await import('@/app/api/gateway/sparklines/route')
    const N = 25
    for (let i = 0; i < N; i++) {
      const junk = 'x'.repeat(2000) + i // not a 20- or 32-byte hex id, yet accepted into the module-level Map key
      const res = await GET(req(`https://mintware.test/api/gateway/sparklines?pools=${junk}`))
      expect(res.status).toBe(200)
    }
    expect(spy).toHaveBeenCalledTimes(N) // no cap on distinct keys → the Map only ever grows
    expect((spy.mock.calls[0] as unknown[])[0]).toEqual([expect.stringMatching(/^x{2000}0$/)])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-6 · /api/gateway/request accepts a free-text pool_address / chain_id (CONFIRMED, Low)', () => {
  it('persists an arbitrary string as the curation key', async () => {
    const { client, calls } = fluent({ data: null, error: null })
    state.supabase = client
    const { POST } = await import('@/app/api/gateway/request/route')
    const res = await POST(req('https://mintware.test/api/gateway/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ poolAddress: 'PONS / USDG <b>looks legit</b>', chainId: 999999, pairLabel: 'x'.repeat(5000) }),
    }))
    expect(res.status).toBe(200)
    const ins = calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>
    expect(ins.pool_address).toBe('pons / usdg <b>looks legit</b>')
    expect(ins.chain_id).toBe(999999)
    expect(String(ins.pair_label).length).toBe(5000) // no label cap on the manual path (the auto path caps at 64)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('HO-7 · Discover marks a pool live from gateway_instances WITHOUT a status filter (CONFIRMED, Low)', () => {
  it('an inactive (deactivated) instance still renders live:true in the feed', async () => {
    const POOL = '0x' + 'ab'.repeat(32)
    const { client, calls } = fluent({ data: [{ pool_address: POOL, status: 'inactive' }], error: null })
    state.supabase = client
    state.cfg = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: null, staging: null, poolAddress: null }
    state.fetchHotPools = async () => [{ poolAddress: POOL, pairLabel: 'X / USDG', tvlUsd: 1, vol24Usd: 1, priceQuotePerBase: null, signals: { volTvlRatio: null, poolAgeDays: null, txCount24: null }, score: 0, verdict: 'review', reasons: [], baseSymbol: 'X', quoteSymbol: 'USDG', baseLogo: null, quoteLogo: null, feePct: null, estFeeAprPct: null }]
    vi.resetModules() // fresh module-level 3-min cache
    const { GET } = await import('@/app/api/gateway/discover/route')
    const res = await GET(req('https://mintware.test/api/gateway/discover'))
    const body = await res.json()
    expect(body.pools[0].live).toBe(true)
    const eqFilters = calls.filter(([m]) => m === 'eq').map(([, a]) => a[0])
    expect(eqFilters).toContain('chain_id')
    expect(eqFilters).not.toContain('status') // discover/route.ts:27-31 filters chain_id only
  })
})
