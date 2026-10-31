// /api/gateway/markets — lists verified, active MarketEngine markets on every market chain; a failed NAV read
// keeps the market listed with navQuote:null; every listed market is depositable on its own chain.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const RH_POOL = '0x' + 'aa'.repeat(32)
const BASE_POOL = '0x' + 'bb'.repeat(32)
const state = vi.hoisted(() => ({ navFails: false, unverified: false }))

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({}) }))
vi.mock('@/lib/gateway/marketEngine', () => ({
  marketEngineConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.test', defaultEngine: null }),
  listMarketEngines: async (_db: unknown, chainId: number) => {
    const row = (pool: string, engine: string) => ({ id: pool, poolAddress: pool, chainId, pairLabel: 'X/USDG', engineAddress: engine, quoteAsset: '0x' + '11'.repeat(20), token0: '0x' + '11'.repeat(20), token1: '0x' + '22'.repeat(20), status: 'active', verified: !state.unverified })
    if (chainId === 46630) return [row(RH_POOL, '0x' + 'a1'.repeat(20))]
    if (chainId === 84532) return [row(BASE_POOL, '0x' + 'b1'.repeat(20))]
    return []
  },
}))
vi.mock('@/lib/gateway/chain', () => ({
  marketEnginePublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'totalNav') { if (state.navFails) throw new Error('StaleMark()'); return 755_000_000n }
      if (functionName === 'decimals') return 6
      if (functionName === 'symbol') return 'tUSDG'
      if (functionName === 'poolKey') return { fee: 3000 }
      throw new Error(functionName)
    },
  }),
}))

const req = () => new NextRequest('https://mintware.test/api/gateway/markets', { headers: { 'x-forwarded-for': '192.0.2.9' } })

beforeEach(() => { state.navFails = false; state.unverified = false; vi.resetModules() })

describe('/api/gateway/markets', () => {
  it('lists verified markets across Base and Robinhood with chain NAV', async () => {
    const { GET } = await import('./route')
    const b = await (await GET(req())).json()
    expect(b.success).toBe(true)
    expect(b.markets).toHaveLength(2)
    const rh = b.markets.find((m: { chainId: number }) => m.chainId === 46630)
    expect(rh).toMatchObject({ poolAddress: RH_POOL, navQuote: 755, quoteSymbol: 'tUSDG', feePct: 0.3, depositable: true })
    expect(b.markets.find((m: { chainId: number }) => m.chainId === 84532).depositable).toBe(true)
  })

  it('keeps a market listed when its NAV read reverts', async () => {
    state.navFails = true
    const { GET } = await import('./route')
    const b = await (await GET(req())).json()
    expect(b.markets).toHaveLength(2)
    expect(b.markets.every((m: { navQuote: number | null }) => m.navQuote === null)).toBe(true)
  })

  it('never lists an unverified instance', async () => {
    state.unverified = true
    const { GET } = await import('./route')
    const b = await (await GET(req())).json()
    expect(b.markets).toEqual([])
  })
})
