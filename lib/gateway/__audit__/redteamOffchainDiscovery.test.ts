// RED-TEAM PoC (off-chain, 2026-09-08) — feed poisoning via GeckoTerminal (MITM / compromised upstream /
// or simply an attacker who wash-trades 30 fake v4 "X / USDG" pools to the top of h24 volume).
//
// STATUS AFTER O-7 REMEDIATION (closeout, 2026-09-08): every attack below now FAILS. The suite was flipped
// (as the contract PoC suites were) to assert the fixed behavior and is kept green as regression evidence:
//   • name-suffix APR inflation → fee tier UNKNOWN, APR n/a (bounded);
//   • any-https tracking pixel → dropped (https + allowlisted CDN hosts only);
//   • USDG-by-NAME when LP_GATEWAY_USDG is unset → quote UNKNOWN ⇒ ineligible (fail-closed);
//   • hostile top-30 prune → legit auto candidates survive the grace window; curator rows never pruned;
//   • cron fetch → AbortSignal + bounded retries.
// RESIDUAL (honest, documented): the risk score's NUMERIC inputs (TVL / age / tx count) are still
// upstream-asserted, so a wash-traded fake pool CAN report perfect numbers and score 0. That is why the
// verdict is never better than 'review' (human gate) and why the UI chip must not read as certification.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { poolToCandidate, discoverAndIngest } from '../discovery'
import { fakeSupabase } from './fakeSupabase'

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const CHAIN = 4663

function gtPool(i: number, over: Record<string, unknown> = {}) {
  return {
    attributes: {
      address: '0x' + i.toString(16).padStart(64, 'e'), // 32-byte v4 poolId shape
      name: `SCAM${i} / USDG 0.3%`,
      reserve_in_usd: '200000', // ≥150k → no TVL penalty
      volume_usd: { h24: '1000000' }, // vol/TVL 5 → no wash flag
      pool_created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), // 30d → no age penalty
      transactions: { h24: { buys: 500, sells: 500 } },
      ...over,
    },
    relationships: { dex: { data: { id: 'uniswap_v4' } }, base_token: { data: { id: `robinhood_0x${i.toString(16).padStart(40, '5')}` } }, quote_token: { data: { id: `robinhood_${USDG}` } } },
  }
}

let savedUsdg: string | undefined
beforeEach(() => { savedUsdg = process.env.LP_GATEWAY_USDG; process.env.LP_GATEWAY_USDG = USDG })
afterEach(() => { vi.unstubAllGlobals(); if (savedUsdg === undefined) delete process.env.LP_GATEWAY_USDG; else process.env.LP_GATEWAY_USDG = savedUsdg })

describe('riskScore steering from GeckoTerminal — what is closed and what is the documented residual', () => {
  it('RESIDUAL: a wash-traded fake pool with perfect NUMBERS still scores 0 — but the verdict is review (human gate), never approve', () => {
    const c = poolToCandidate(gtPool(1), { usdgAddress: USDG })
    expect(c.verdict).toBe('review')
    expect(c.score).toBe(0)
  })

  it('FIXED: est. fee APR can no longer be inflated via the pair NAME’s fee suffix + tiny TVL', () => {
    const c = poolToCandidate(gtPool(2, { name: 'MOON / USDG 99%', reserve_in_usd: '1', volume_usd: { h24: '1000000000' } }), { usdgAddress: USDG })
    expect(c.feePct).toBeNull() // 99% is not a sane tier → unknown
    expect(c.estFeeAprPct).toBeNull() // n/a, never "36,135,000,000,000%"
    const c2 = poolToCandidate(gtPool(2, { name: 'MOON / USDG 0.3%', reserve_in_usd: '1', volume_usd: { h24: '1000000000' } }), { usdgAddress: USDG })
    expect(c2.estFeeAprPct).toBeNull() // even a sane tier: $1 TVL is below the floor
  })

  it('FIXED: safeImg drops a third-party https URL (tracking pixel) — only GT/CoinGecko CDN hosts render', () => {
    const tid = `robinhood_0x${(3).toString(16).padStart(40, '5')}`
    const tokens = new Map([[tid, { id: tid, attributes: { symbol: 'SCAM', image_url: 'https://attacker.example/pixel.png?campaign=mintware' } }]])
    const c = poolToCandidate(gtPool(3), { usdgAddress: USDG, tokensById: tokens })
    expect(c.baseLogo).toBeNull()
  })

  it('FIXED: with LP_GATEWAY_USDG unset a "…/ USDG" NAME is worthless — quote unknown ⇒ ineligible (fail-closed)', () => {
    const c = poolToCandidate(gtPool(4, { name: 'NOTUSDG / USDG 0.3%' }), {})
    expect(c.signals.usdgQuoted).toBeNull()
    expect(c.verdict).toBe('ineligible')
  })
})

describe('prune-to-top-30 can no longer EVICT legitimate candidates in one hostile run', () => {
  it('30 attacker pools → a legit auto row seen within the grace window survives; manual + curator rows are never touched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: Array.from({ length: 30 }, (_, i) => gtPool(100 + i)) }) })))
    const LEGIT = '0x' + 'ab'.repeat(32)
    const now = Date.now()
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [],
        gateway_pool_requests: [
          { id: 'legit', pool_address: LEGIT, chain_id: CHAIN, status: 'pending', source: 'auto', pair_label: 'REAL / USDG 0.3%', hotness: { lastSeenAt: new Date(now - 24 * 3_600_000).toISOString() } },
          { id: 'manual', pool_address: '0x' + 'cd'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'manual' },
          { id: 'approved', pool_address: '0x' + 'ef'.repeat(32), chain_id: CHAIN, status: 'approved', source: 'auto', created_at: new Date(0).toISOString() },
        ],
      },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN, now })
    expect(res.ingested).toBe(30)
    expect(res.pruned).toBe(0)
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'legit')).toBeDefined() // ← survives
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'manual')).toBeDefined()
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'approved')).toBeDefined()
    expect(db.tables.gateway_pool_requests.filter((r) => r.source === 'auto' && r.status === 'pending').length).toBe(31)
  })

  it('FIXED: discoverAndIngest passes an AbortSignal (8 s budget) — a stalled upstream can no longer hang the cron', async () => {
    let signalSeen: unknown = 'unset'
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { signal?: unknown }) => { signalSeen = init?.signal; return { ok: true, status: 200, json: async () => ({ data: [] }) } }))
    const { client } = fakeSupabase({ tables: { gateway_instances: [], gateway_pool_requests: [] } })
    await discoverAndIngest({ supabase: client, chainId: CHAIN })
    expect(signalSeen).toBeInstanceOf(AbortSignal)
  })
})
