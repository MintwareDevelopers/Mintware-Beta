import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── fakes ──
let POSITION_ROWS: unknown[] = []
let REFERRER_ROWS: unknown[] = []
vi.mock('@/lib/web2/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: async () => ({ data: REFERRER_ROWS, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: table === 'gateway_positions' ? POSITION_ROWS : [], error: null }),
      }
      return chain
    },
  }),
}))

const readInstanceHoldings = vi.fn()
vi.mock('@/lib/gateway/chainTruth', () => ({ readInstanceHoldings: (...a: unknown[]) => readInstanceHoldings(...a) }))

const gatewayConfig = vi.fn()
vi.mock('@/lib/gateway/chain', () => ({ gatewayConfig: () => gatewayConfig(), gatewayPublicClient: () => ({ tag: 'client' }) }))

const listActiveInstances = vi.fn()
vi.mock('@/lib/gateway/registry', () => ({ listActiveInstances: (...a: unknown[]) => listActiveInstances(...a) }))

import { GET } from '@/app/api/gateway/leaderboard/route'
import { resetLeaderboardCache as __resetLeaderboardCache } from '@/lib/gateway/leaderboardCache'

const A = '0x' + 'a'.repeat(40)
const B = '0x' + 'b'.repeat(40)
const PM = ('0x' + '1'.repeat(40)) as `0x${string}`
const POOL = '0x' + 'p'.repeat(40)
const get = (qs = '') => GET(new NextRequest(`http://localhost/api/gateway/leaderboard${qs}`))

describe('GET /api/gateway/leaderboard — chain truth (O-11)', () => {
  beforeEach(() => {
    __resetLeaderboardCache()
    readInstanceHoldings.mockReset()
    listActiveInstances.mockReset()
    gatewayConfig.mockReset()
    gatewayConfig.mockReturnValue({ chainId: 46630, rpcUrl: 'http://rpc', positionManager: null, staging: null, poolAddress: null })
    listActiveInstances.mockResolvedValue([{ poolAddress: POOL, positionManager: PM, chainId: 46630 }])
    // DB says A has 100 USDG of "entry_nav" (a stale, un-withdrawn record) and B has 10.
    POSITION_ROWS = [
      { user_wallet: A, entry_nav: '100000000', pool_address: POOL },
      { user_wallet: B, entry_nav: '10000000', pool_address: POOL },
    ]
    REFERRER_ROWS = []
  })
  afterEach(() => vi.useRealTimers())

  it('ranks by ON-CHAIN value, not Σ entry_nav — a withdrawn depositor drops off', async () => {
    // Chain says: A holds 0 shares (withdrew), B holds all 10 shares of a 12-USDG pool.
    readInstanceHoldings.mockResolvedValue({ blockNumber: 4242n, holdings: [
      { poolAddress: POOL, totalShares: 10_000_000n, totalNav: 12_000_000n, shares: new Map([[A, 0n], [B, 10_000_000n]]) },
    ] })
    const res = await get(`?me=${A}`)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, source: 'chain', degraded: false, blockNumber: '4242', chainId: 46630, stale: false })
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]).toMatchObject({ rank: 1, wallet: B, pools: 1, shares: '10000000' })
    expect(BigInt(body.providers[0].capitalAtomic)).toBeGreaterThan(11_000_000n) // ~12 USDG, from chain
    expect(body.me.provider).toBeNull() // A is off the board despite the DB row

    // the DB rows were used as the ADDRESS source only
    const spec = readInstanceHoldings.mock.calls[0][0]
    expect(spec.instances).toEqual([{ poolAddress: POOL, positionManager: PM, wallets: [A, B] }])
    expect(spec.client).toEqual({ tag: 'client' })
  })

  it('degrades to the DB sum with an EXPLICIT flag when the chain read fails — never mixed', async () => {
    readInstanceHoldings.mockRejectedValue(new Error('rpc down'))
    const body = await (await get()).json()
    expect(body).toMatchObject({ success: true, source: 'db', degraded: true, degradedReason: 'chain_read_failed', blockNumber: null })
    expect(body.providers.map((p: { wallet: string }) => p.wallet)).toEqual([A, B])
    expect(body.providers[0].capitalAtomic).toBe('100000000')
  })

  it('flags gateway_not_configured when no chain is set', async () => {
    gatewayConfig.mockReturnValue(null)
    const body = await (await get()).json()
    expect(body).toMatchObject({ source: 'db', degraded: true, degradedReason: 'gateway_not_configured', chainId: null })
    expect(readInstanceHoldings).not.toHaveBeenCalled()
  })

  it('caches the chain board for 60 s, then re-reads', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    readInstanceHoldings.mockResolvedValue({ blockNumber: 1n, holdings: [] })
    await get()
    await get()
    expect(readInstanceHoldings).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1_000_000 + 61_000)
    const body = await (await get()).json()
    expect(readInstanceHoldings).toHaveBeenCalledTimes(2)
    expect(body.ageMs).toBe(0)
  })

  it('a degraded board is cached for only 15 s so recovery is quick', async () => {
    vi.useFakeTimers({ now: 5_000_000 })
    readInstanceHoldings.mockRejectedValueOnce(new Error('rpc down'))
    expect((await (await get()).json()).source).toBe('db')
    vi.setSystemTime(5_000_000 + 16_000)
    readInstanceHoldings.mockResolvedValue({ blockNumber: 9n, holdings: [] })
    expect((await (await get()).json()).source).toBe('chain')
  })

  it('skips instances with no known depositors (no wasted RPC)', async () => {
    listActiveInstances.mockResolvedValue([
      { poolAddress: POOL, positionManager: PM, chainId: 46630 },
      { poolAddress: '0x' + 'q'.repeat(40), positionManager: ('0x' + '2'.repeat(40)) as `0x${string}`, chainId: 46630 },
    ])
    readInstanceHoldings.mockResolvedValue({ blockNumber: 1n, holdings: [] })
    await get()
    expect(readInstanceHoldings.mock.calls[0][0].instances).toHaveLength(1)
  })
})
