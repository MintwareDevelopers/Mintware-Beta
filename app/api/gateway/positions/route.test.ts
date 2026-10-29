import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ rows: [] as unknown[], reads: vi.fn() }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => ({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }), listMarketEngines: async () => state.rows }))
vi.mock('@/lib/gateway/chain', () => ({ gatewayPublicClient: () => ({ readContract: state.reads }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => fakeSupabase().client }))

const POOL = '0x' + 'ab'.repeat(32)
const ENGINE = '0x' + '11'.repeat(20)
const row = { id: 'e', poolAddress: POOL, chainId: 84532, pairLabel: 'A / USDG', engineAddress: ENGINE, quoteAsset: '0x' + '22'.repeat(20), token0: '0x' + '33'.repeat(20), token1: '0x' + '22'.repeat(20), status: 'active', verified: true }
const req = (url: string) => { const r = new Request(url); (r as unknown as { nextUrl: URL }).nextUrl = new URL(url); return r as never }

beforeEach(() => {
  state.rows = [row]
  state.reads = vi.fn(async ({ functionName }: { functionName: string }) => ({ balanceOf: 1_000_000_000_000_000_000n, totalSupply: 4_000_000_000_000_000_000n, totalNav: 8_000_000n } as Record<string, bigint>)[functionName] ?? 0n)
})

describe('GET /api/gateway/positions — MarketEngine portfolio', () => {
  it('enumerates nonzero engine shares and calculates pro-rata NAV value', async () => {
    const { GET } = await import('./route')
    const body = await (await GET(req(`https://mw.test/api/gateway/positions?address=0x${'44'.repeat(20)}`))).json()
    expect(body.positions).toHaveLength(1)
    expect(body.positions[0]).toMatchObject({ poolAddress: POOL, marketEngine: ENGINE, shares: '1000000000000000000', positionValueAtomic: '2000000' })
    expect(body.complete).toBe(true)
  })
  it('omits pools with zero shares', async () => {
    state.reads = vi.fn(async ({ functionName }: { functionName: string }) => ({ balanceOf: 0n, totalSupply: 1n, totalNav: 1n } as Record<string, bigint>)[functionName] ?? 0n)
    const { GET } = await import('./route')
    expect((await (await GET(req(`https://mw.test/api/gateway/positions?address=0x${'44'.repeat(20)}`))).json()).positions).toEqual([])
  })
  it('rejects an invalid address', async () => {
    const { GET } = await import('./route')
    expect((await GET(req('https://mw.test/api/gateway/positions?address=bad'))).status).toBe(400)
  })
})
