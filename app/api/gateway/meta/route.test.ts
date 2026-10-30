import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ config: { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }, instance: null as unknown, registryError: false, read: vi.fn() }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => state.config, marketEngineConfigForPool: async () => state.config, marketEngineConfigs: () => [state.config], resolveMarketEngine: async () => { if (state.registryError) throw new Error('missing column'); return state.instance } }))
vi.mock('@/lib/gateway/chain', () => ({ marketEnginePublicClient: () => ({ readContract: state.read }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => fakeSupabase().client }))

const ENGINE = '0x' + '11'.repeat(20)
const TOKEN0 = '0x' + '22'.repeat(20)
const TOKEN1 = '0x' + '33'.repeat(20)
const POOL = '0x' + 'ab'.repeat(32)
const instance = { id: 'engine-1', poolAddress: POOL, chainId: 84532, pairLabel: 'A / USDG', engineAddress: ENGINE, quoteAsset: TOKEN1, token0: TOKEN0, token1: TOKEN1, status: 'active', verified: true, source: 'registry', live: true }
const req = (url: string) => { const r = new Request(url); (r as unknown as { nextUrl: URL }).nextUrl = new URL(url); return r as never }

beforeEach(() => {
  state.config = { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }
  state.instance = instance
  state.registryError = false
  state.read = vi.fn(async (arg: { functionName: string }) => ({ decimals: 6, tickLower: -100, tickUpper: 100, poolKey: { fee: 3000 } } as Record<string, unknown>)[arg.functionName] ?? 6)
})

describe('GET /api/gateway/meta — MarketEngine target', () => {
  it('returns the verified active engine, quote token, token pair, and chain config', async () => {
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL}`))
    expect(res.status).toBe(200)
    expect((await res.json()).meta).toMatchObject({ engineAddress: ENGINE, positionManager: ENGINE, poolAddress: POOL, usdg: TOKEN1, token0: TOKEN0, token1: TOKEN1, source: 'registry', live: true, supportsMin: true })
  })
  it('refuses an unmapped pool', async () => {
    state.instance = null
    const { GET } = await import('./route')
    expect((await GET(req('https://mw.test/api/gateway/meta?pool=0x' + 'ff'.repeat(32)))).status).toBe(404)
  })
  it('fails closed when MarketEngine config is missing', async () => {
    state.config = null as never
    const { GET } = await import('./route')
    expect((await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL}`))).status).toBe(503)
  })
  it('serves a verified-once retired registry engine without current deposit verification', async () => {
    state.instance = { ...instance, status: 'inactive', live: false }
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL}`))
    expect(res.status).toBe(200)
    expect((await res.json()).meta).toMatchObject({ engineAddress: ENGINE, live: false, source: 'registry' })
    expect(state.read).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'activated' }))
  })
  it('degrades registry schema errors to a clear 503', async () => {
    state.registryError = true
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL}`))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'engine_registry_unavailable' })
  })
})
