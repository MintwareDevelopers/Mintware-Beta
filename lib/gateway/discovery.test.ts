import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  poolToCandidate, safeImg, parseFeePct, estimateFeeAprPct, validateGtPayload, fetchGtPools, fetchHotPools,
  discoverAndIngest, gtNetwork, MAX_EST_APR_PCT, MAX_FEE_PCT, MIN_TVL_FOR_APR_USD,
} from './discovery'
import { fakeSupabase } from './__audit__/fakeSupabase'

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const PONS = '0x' + '77'.repeat(20)
const POOL = '0x1111111111111111111111111111111111111111'
const CHAIN = 4663

function gtPool(over: Record<string, unknown> = {}, rel: Record<string, unknown> = {}) {
  return {
    attributes: {
      address: POOL,
      name: 'PONS / USDG',
      reserve_in_usd: '8100000',
      volume_usd: { h24: '29700000' },
      pool_created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      transactions: { h24: { buys: 3000, sells: 2000 } },
      ...over,
    },
    relationships: {
      dex: { data: { id: 'uniswap_v4' } },
      base_token: { data: { id: `robinhood_${PONS}` } },
      quote_token: { data: { id: `robinhood_${USDG}` } },
      ...rel,
    },
  }
}

const ENV_KEYS = ['LP_GATEWAY_USDG', 'LP_GATEWAY_DISCOVER_USDG', 'LP_GATEWAY_GT_NETWORK', 'LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('poolToCandidate', () => {
  it('maps a hot v4 USDG pool → eligible review candidate', () => {
    const c = poolToCandidate(gtPool(), { usdgAddress: USDG })
    expect(c.poolAddress).toBe(POOL)
    expect(c.verdict).toBe('review')
    expect(c.signals.protocol).toBe('v4')
    expect(c.signals.usdgQuoted).toBe(true)
    expect(c.signals.tokensResolved).toBe(true)
    expect(c.tvlUsd).toBe(8_100_000)
    expect(c.vol24Usd).toBe(29_700_000)
    expect(c.signals.volTvlRatio).toBeCloseTo(3.666, 1)
    expect(c.signals.txCount24).toBe(5000)
  })

  it('non-v4 → ineligible', () => {
    const c = poolToCandidate(gtPool({}, { dex: { data: { id: 'uniswap_v3' } } }), { usdgAddress: USDG })
    expect(c.verdict).toBe('ineligible')
    expect(c.signals.protocol).toBe('v3')
  })

  it('non-USDG (by address) → ineligible', () => {
    const c = poolToCandidate(gtPool({}, { quote_token: { data: { id: 'robinhood_0x' + '99'.repeat(20) } } }), { usdgAddress: USDG })
    expect(c.signals.usdgQuoted).toBe(false)
    expect(c.verdict).toBe('ineligible')
  })

  it('O-7: with NO configured USDG the quote is UNKNOWN (null) and the pool is ineligible — the NAME never matches', () => {
    const named = poolToCandidate(gtPool({ name: 'SHROOM / USDG' }))
    expect(named.signals.usdgQuoted).toBeNull()
    expect(named.verdict).toBe('ineligible')
    expect(named.reasons[0]).toMatch(/LP_GATEWAY_USDG unset/)
    // an INVALID configured address behaves as unset (never a partial/loose match)
    expect(poolToCandidate(gtPool(), { usdgAddress: 'usdg' }).signals.usdgQuoted).toBeNull()
    // a pool whose NAME says USDG but whose quote ADDRESS is something else is NOT USDG-quoted
    const spoof = poolToCandidate(gtPool({ name: 'NOTUSDG / USDG 0.3%' }, { quote_token: { data: { id: 'robinhood_0x' + '99'.repeat(20) } } }), { usdgAddress: USDG })
    expect(spoof.signals.usdgQuoted).toBe(false)
    expect(spoof.verdict).toBe('ineligible')
  })

  it('computes pool age in days from created timestamp', () => {
    const c = poolToCandidate(gtPool({ pool_created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }), { usdgAddress: USDG })
    expect(c.signals.poolAgeDays).toBe(2)
    expect(c.score).toBeGreaterThan(0) // a 2-day-old pool picks up the "very new" penalty
  })

  it('a future created_at (clock skew / hostile) clamps age to 0, never negative', () => {
    const c = poolToCandidate(gtPool({ pool_created_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }), { usdgAddress: USDG })
    expect(c.signals.poolAgeDays).toBe(0)
  })

  it('unresolved token legs (non-address ids) are flagged and penalized', () => {
    const c = poolToCandidate(gtPool({}, { base_token: { data: { id: 'robinhood_0xpons' } } }), { usdgAddress: USDG })
    expect(c.signals.tokensResolved).toBe(false)
    expect(c.reasons).toContain('token legs unresolved')
  })
})

// Untrusted-input hardening (audit L-09 + round-2 O-7) — GeckoTerminal payloads are external, never trusted.
describe('poolToCandidate — untrusted input validation', () => {
  it('rejects a non-address pool address (→ empty, so ingest skips it)', () => {
    expect(poolToCandidate(gtPool({ address: '0xPOOL' })).poolAddress).toBe('')
    expect(poolToCandidate(gtPool({ address: 'not-an-address' })).poolAddress).toBe('')
    expect(poolToCandidate(gtPool({ address: undefined })).poolAddress).toBe('')
    expect(poolToCandidate(gtPool({ address: POOL.toUpperCase().replace('0X', '0x') })).poolAddress).toBe(POOL)
  })

  it('coerces non-finite / garbage numeric metrics to 0 — never NaN or Infinity', () => {
    const c = poolToCandidate(gtPool({ reserve_in_usd: 'not-a-number', volume_usd: { h24: 'NaN' }, base_token_price_quote_token: 'x' }), { usdgAddress: USDG })
    expect(c.tvlUsd).toBe(0)
    expect(c.vol24Usd).toBe(0)
    expect(c.signals.volTvlRatio).toBeNull()
    expect(c.priceQuotePerBase).toBeNull()
  })

  it('negative metrics clamp to 0', () => {
    const c = poolToCandidate(gtPool({ reserve_in_usd: '-100', volume_usd: { h24: -1 } }), { usdgAddress: USDG })
    expect(c.tvlUsd).toBe(0)
    expect(c.vol24Usd).toBe(0)
  })

  it('coerces garbage transaction counts to a finite total', () => {
    const c = poolToCandidate(gtPool({ transactions: { h24: { buys: 'oops', sells: undefined } } }), { usdgAddress: USDG })
    expect(c.signals.txCount24).toBe(0)
  })

  it('strips control chars from the pair label and caps its length', () => {
    const dirty = 'AB' + '\u0000' + 'CD' + '\n' + 'EF' + '\u200B' + '\uFEFF' + 'GH'
    expect(poolToCandidate(gtPool({ name: dirty })).pairLabel).toBe('ABCDEFGH')
    expect(poolToCandidate(gtPool({ name: 'Z'.repeat(200) })).pairLabel.length).toBe(64)
  })

  it('survives a pool with no attributes / relationships / non-object fields at all', () => {
    expect(() => poolToCandidate({} as never)).not.toThrow()
    expect(() => poolToCandidate({ attributes: 'x', relationships: 5 } as never)).not.toThrow()
    expect(poolToCandidate({} as never).verdict).toBe('ineligible')
  })

  it('the risk score never sees free text: renaming the pool / symbols / logo URLs cannot move the score', () => {
    const tokens = new Map([[`robinhood_${PONS}`, { id: `robinhood_${PONS}`, attributes: { symbol: '<script>', image_url: 'https://evil.example/x.png' } }]])
    const a = poolToCandidate(gtPool(), { usdgAddress: USDG })
    const b = poolToCandidate(gtPool({ name: 'TOTALLY SAFE AUDITED 0.3%' }), { usdgAddress: USDG, tokensById: tokens })
    expect(b.score).toBe(a.score)
    expect(b.reasons).toEqual(a.reasons)
  })
})

describe('safeImg — https + allowlisted CDN hosts only (O-7 tracking-pixel)', () => {
  it('passes GeckoTerminal / CoinGecko CDN logos', () => {
    expect(safeImg('https://assets.geckoterminal.com/abc.png')).toBe('https://assets.geckoterminal.com/abc.png')
    expect(safeImg('https://coin-images.coingecko.com/coins/images/1/small/x.png?1700000000')).toMatch(/^https:\/\/coin-images\.coingecko\.com\//)
    expect(safeImg('https://cdn2.coingecko.com/x.png')).toBe('https://cdn2.coingecko.com/x.png') // suffix match
  })
  it('drops any other host, http, credentials, data:/javascript:, and lookalikes', () => {
    expect(safeImg('https://attacker.example/pixel.png?campaign=mintware')).toBeNull()
    expect(safeImg('http://assets.geckoterminal.com/abc.png')).toBeNull()
    expect(safeImg('https://user:pw@assets.geckoterminal.com/abc.png')).toBeNull()
    expect(safeImg('https://assets.geckoterminal.com.evil.example/abc.png')).toBeNull()
    expect(safeImg('https://evilcoingecko.com/x.png')).toBeNull()
    expect(safeImg('data:image/png;base64,AAAA')).toBeNull()
    expect(safeImg('javascript:alert(1)')).toBeNull()
    expect(safeImg('https://assets.geckoterminal.com/a b.png')).toBeNull()
    expect(safeImg(null)).toBeNull()
    expect(safeImg('https://assets.geckoterminal.com/' + 'a'.repeat(3000))).toBeNull()
  })
  it('poolToCandidate applies it to both logos', () => {
    const tokens = new Map([
      [`robinhood_${PONS}`, { id: `robinhood_${PONS}`, attributes: { symbol: 'PONS', image_url: 'https://attacker.example/pixel.png' } }],
      [`robinhood_${USDG}`, { id: `robinhood_${USDG}`, attributes: { symbol: 'USDG', image_url: 'https://assets.geckoterminal.com/usdg.png' } }],
    ])
    const c = poolToCandidate(gtPool(), { usdgAddress: USDG, tokensById: tokens })
    expect(c.baseLogo).toBeNull()
    expect(c.quoteLogo).toBe('https://assets.geckoterminal.com/usdg.png')
  })
})

describe('fee tier + est. APR are bounded (O-7 APR inflation)', () => {
  it('parseFeePct: a sane name suffix is accepted; an insane one is UNKNOWN; the pool fee field wins', () => {
    expect(parseFeePct({}, 'MEME / USDG 0.3%')).toBe(0.3)
    expect(parseFeePct({}, 'MEME / USDG 1%')).toBe(1)
    expect(parseFeePct({}, 'MOON / USDG 99%')).toBeNull()
    expect(parseFeePct({}, 'MEME / USDG')).toBeNull()
    expect(parseFeePct({ pool_fee_percentage: '0.7' }, 'MEME / USDG 99%')).toBe(0.7) // field overrides name
    expect(parseFeePct({ pool_fee_percentage: '0.7%' }, 'MEME / USDG')).toBe(0.7)
    expect(parseFeePct({ fee_tier: 55 }, 'MEME / USDG 0.3%')).toBeNull() // insane field ⇒ unknown, NOT the name
    expect(MAX_FEE_PCT).toBe(10)
  })
  it('estimateFeeAprPct: n/a when the tier is unknown, TVL is dust, or the result is absurd', () => {
    expect(estimateFeeAprPct(null, 1e6, 1e6)).toBeNull()
    expect(estimateFeeAprPct(0.3, 1e9, 1)).toBeNull() // $1 TVL ⇒ below the floor
    expect(estimateFeeAprPct(0.3, 1e6, MIN_TVL_FOR_APR_USD)).toBeNull() // (0.003 × 1e6 / 1e3 × 365 × 100) > cap
    expect(estimateFeeAprPct(0.3, 29_700_000, 8_100_000)).toBeCloseTo(0.003 * 29_700_000 / 8_100_000 * 365 * 100, 6)
    expect(estimateFeeAprPct(9, 1e12, 1e3)).toBeNull()
    expect(MAX_EST_APR_PCT).toBe(10_000)
  })
  it('the red-team PoC ("MOON / USDG 99%", $1 TVL, $1B vol) now yields feePct null and APR n/a', () => {
    const c = poolToCandidate(gtPool({ name: 'MOON / USDG 99%', reserve_in_usd: '1', volume_usd: { h24: '1000000000' } }), { usdgAddress: USDG })
    expect(c.feePct).toBeNull()
    expect(c.estFeeAprPct).toBeNull()
  })
})

describe('validateGtPayload — malformed shapes never throw', () => {
  it('drops non-object entries and non-array containers', () => {
    expect(validateGtPayload(null)).toEqual({ pools: [], tokens: [] })
    expect(validateGtPayload('x')).toEqual({ pools: [], tokens: [] })
    expect(validateGtPayload({ data: 'nope', included: 5 })).toEqual({ pools: [], tokens: [] })
    const v = validateGtPayload({ data: [null, 1, 'x', gtPool(), []], included: [{ id: 't' }, 7] })
    expect(v.pools.length).toBe(1)
    expect(v.tokens.length).toBe(1)
  })
  it('gtNetwork: the env slug is shape-checked so it can never inject a path', () => {
    process.env.LP_GATEWAY_GT_NETWORK = '../evil?x='
    expect(gtNetwork()).toBe('robinhood')
    process.env.LP_GATEWAY_GT_NETWORK = 'base'
    expect(gtNetwork()).toBe('base')
  })
})

describe('fetchGtPools — timeout + bounded retries + never throws', () => {
  it('passes an AbortSignal and retries a 5xx (bounded), then succeeds', async () => {
    const signals: unknown[] = []
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { signal?: unknown }) => {
      signals.push(init?.signal)
      n++
      if (n < 3) return { ok: false, status: 503, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ data: [gtPool()] }) }
    }))
    const r = await fetchGtPools({ backoffMs: 0 })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(3)
    expect(r.pools.length).toBe(1)
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true)
  })
  it('gives up after retries+1 attempts on persistent 5xx / network errors', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    const r = await fetchGtPools({ backoffMs: 0, retries: 2 })
    expect(r.ok).toBe(false)
    expect(f).toHaveBeenCalledTimes(3)
    const g = vi.fn(async () => { throw new Error('ECONNRESET') })
    vi.stubGlobal('fetch', g)
    const r2 = await fetchGtPools({ backoffMs: 0, retries: 1 })
    expect(r2.ok).toBe(false)
    expect(r2.error).toMatch(/ECONNRESET/)
    expect(g).toHaveBeenCalledTimes(2)
  })
  it('does NOT retry a 429 / 4xx (never amplifies a rate limit)', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    const r = await fetchGtPools({ backoffMs: 0 })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(429)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('a 200 with a non-JSON body or a malformed shape is a clean failure / empty set, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } })))
    const r = await fetchGtPools({ backoffMs: 0 })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('malformed_payload')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { not: 'an array' } }) })))
    const r2 = await fetchGtPools({ backoffMs: 0 })
    expect(r2.ok).toBe(true)
    expect(r2.pools).toEqual([])
  })
  it('aborts a stalled upstream at the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('AbortError')))
    })))
    const t0 = Date.now()
    const r = await fetchGtPools({ timeoutMs: 30, retries: 0 })
    expect(r.ok).toBe(false)
    expect(Date.now() - t0).toBeLessThan(2_000)
  })
})

describe('fetchHotPools', () => {
  it('with LP_GATEWAY_USDG unset it warns and every pool is ineligible (fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [gtPool()] }) })))
    const warn = vi.fn()
    const pools = await fetchHotPools({ log: { info: vi.fn(), warn } })
    expect(pools.length).toBe(1)
    expect(pools[0].verdict).toBe('ineligible')
    expect(warn).toHaveBeenCalledWith('gateway.discover', expect.stringMatching(/LP_GATEWAY_USDG unset/), expect.anything())
  })
  it('with LP_GATEWAY_USDG set it matches by address and sideloads tokens', async () => {
    process.env.LP_GATEWAY_USDG = USDG.toUpperCase().replace('0X', '0x')
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      expect(u).toMatch(/include=base_token,quote_token/)
      return { ok: true, status: 200, json: async () => ({ data: [gtPool()], included: [{ id: `robinhood_${PONS}`, attributes: { symbol: 'PONS', image_url: 'https://assets.geckoterminal.com/p.png' } }] }) }
    }))
    const pools = await fetchHotPools()
    expect(pools[0].verdict).toBe('review')
    expect(pools[0].baseSymbol).toBe('PONS')
    expect(pools[0].baseLogo).toBe('https://assets.geckoterminal.com/p.png')
  })
  it('2026-09-09 fix: LP_GATEWAY_DISCOVER_USDG takes precedence over LP_GATEWAY_USDG (they can diverge — registry vs. mainnet browse)', async () => {
    process.env.LP_GATEWAY_USDG = '0x' + '99'.repeat(20) // e.g. a testnet rig's mock quote asset — wrong for browsing
    process.env.LP_GATEWAY_DISCOVER_USDG = USDG
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [gtPool()] }) })))
    const pools = await fetchHotPools()
    expect(pools[0].verdict).toBe('review') // matched against DISCOVER_USDG, not the diverged LP_GATEWAY_USDG
  })
  it('LP_GATEWAY_DISCOVER_USDG unset falls back to LP_GATEWAY_USDG (single-var case still works)', async () => {
    process.env.LP_GATEWAY_USDG = USDG
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [gtPool()] }) })))
    const pools = await fetchHotPools()
    expect(pools[0].verdict).toBe('review')
  })
})

// ── discoverAndIngest: prune never evicts curator decisions / manual rows, and auto rows get a grace window ──
const NOW = Date.parse('2026-09-08T05:00:00Z')
const HOURS = 3_600_000
function upstream(pools: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: pools }) })))
}
function v4Pool(i: number) {
  return gtPool({ address: '0x' + i.toString(16).padStart(64, 'e'), name: `T${i} / USDG 0.3%` })
}

describe('discoverAndIngest — prune safety (O-7 / R-4 eviction)', () => {
  beforeEach(() => { process.env.LP_GATEWAY_USDG = USDG })

  it('approved / rejected / manual rows are NEVER pruned, even when absent from the top-30', async () => {
    upstream(Array.from({ length: 30 }, (_, i) => v4Pool(100 + i)))
    const stale = new Date(NOW - 200 * HOURS).toISOString()
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [],
        gateway_pool_requests: [
          { id: 'approved', pool_address: '0x' + 'aa'.repeat(32), chain_id: CHAIN, status: 'approved', source: 'auto', created_at: stale },
          { id: 'rejected', pool_address: '0x' + 'bb'.repeat(32), chain_id: CHAIN, status: 'rejected', source: 'auto', created_at: stale },
          { id: 'manual', pool_address: '0x' + 'cd'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'manual', created_at: stale },
          { id: 'otherchain', pool_address: '0x' + 'ee'.repeat(32), chain_id: 1, status: 'pending', source: 'auto', created_at: stale },
        ],
      },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(res.ingested).toBe(30)
    expect(res.pruned).toBe(0)
    for (const id of ['approved', 'rejected', 'manual', 'otherchain']) expect(db.tables.gateway_pool_requests.find((r) => r.id === id)).toBeDefined()
  })

  it('a legit auto candidate seen within the grace window SURVIVES a hostile top-30; a long-unseen one is pruned', async () => {
    upstream(Array.from({ length: 30 }, (_, i) => v4Pool(100 + i)))
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [],
        gateway_pool_requests: [
          { id: 'legit-fresh', pool_address: '0x' + 'ab'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto', created_at: new Date(NOW - 500 * HOURS).toISOString(), hotness: { lastSeenAt: new Date(NOW - 24 * HOURS).toISOString() } },
          { id: 'legacy-no-stamp-fresh', pool_address: '0x' + 'ac'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto', created_at: new Date(NOW - 10 * HOURS).toISOString() },
          { id: 'stale', pool_address: '0x' + 'ad'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto', created_at: new Date(NOW - 500 * HOURS).toISOString(), hotness: { lastSeenAt: new Date(NOW - 100 * HOURS).toISOString() } },
          { id: 'no-anchor', pool_address: '0x' + 'ae'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto' },
        ],
      },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(res.pruned).toBe(1)
    const ids = db.tables.gateway_pool_requests.map((r) => r.id)
    expect(ids).toContain('legit-fresh')
    expect(ids).toContain('legacy-no-stamp-fresh')
    expect(ids).toContain('no-anchor') // unknown anchor ⇒ never evicted on missing data
    expect(ids).not.toContain('stale')
  })

  it('the grace window is env-tunable (LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS)', async () => {
    process.env.LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS = '1'
    upstream([v4Pool(1)])
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [],
        gateway_pool_requests: [
          { id: 'seen-2h-ago', pool_address: '0x' + 'ab'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto', hotness: { lastSeenAt: new Date(NOW - 2 * HOURS).toISOString() } },
        ],
      },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(res.pruned).toBe(1)
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'seen-2h-ago')).toBeUndefined()
  })

  it('ingested rows are stamped with hotness.lastSeenAt and a refresh keeps the row pending/auto', async () => {
    upstream([v4Pool(1)])
    const { db, client } = fakeSupabase({ tables: { gateway_instances: [], gateway_pool_requests: [] } })
    await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    const row = db.tables.gateway_pool_requests[0]
    expect((row.hotness as { lastSeenAt: string }).lastSeenAt).toBe(new Date(NOW).toISOString())
    expect(row.quote_asset).toBe(USDG)
    // second run: same pool → update (not a second insert), no prune
    const res2 = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW + HOURS })
    expect(db.tables.gateway_pool_requests.length).toBe(1)
    expect(res2.pruned).toBe(0)
  })

  it('a failed / malformed / stalled upstream leaves the queue UNTOUCHED (no prune, upstream:"error")', async () => {
    const { db, client } = fakeSupabase({
      tables: { gateway_instances: [], gateway_pool_requests: [{ id: 'keep', pool_address: '0x' + 'ab'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto' }] },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })))
    const r1 = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(r1).toMatchObject({ scanned: 0, ingested: 0, pruned: 0, upstream: 'error' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [null, 'x', 42] }) })))
    const r2 = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(r2).toMatchObject({ scanned: 0, ingested: 0, pruned: 0, upstream: 'ok' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT') }))
    const r3 = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW })
    expect(r3.upstream).toBe('error')
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'keep')).toBeDefined()
    expect(db.calls.filter((c) => c.op === 'delete').length).toBe(0)
  })

  it('with LP_GATEWAY_USDG unset nothing is ingested and nothing is pruned (fail-closed)', async () => {
    delete process.env.LP_GATEWAY_USDG
    upstream([v4Pool(1)])
    const warn = vi.fn()
    const { db, client } = fakeSupabase({
      tables: { gateway_instances: [], gateway_pool_requests: [{ id: 'keep', pool_address: '0x' + 'ab'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto', hotness: { lastSeenAt: new Date(NOW - 900 * HOURS).toISOString() } }] },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN, now: NOW, log: { info: vi.fn(), warn } })
    expect(res).toMatchObject({ scanned: 1, ingested: 0, skipped: 1, pruned: 0, upstream: 'ok' })
    expect(db.tables.gateway_pool_requests.length).toBe(1)
    expect(warn).toHaveBeenCalledWith('gateway.discover', expect.stringMatching(/LP_GATEWAY_USDG unset/), expect.anything())
  })
})
