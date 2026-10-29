import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ config: { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }, instance: null as unknown, verify: null as unknown, read: vi.fn() }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => state.config, resolveMarketEngine: async () => state.instance, verifyMarketEngine: async () => state.verify }))
vi.mock('@/lib/gateway/chain', () => ({ gatewayPublicClient: () => ({ readContract: state.read }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => fakeSupabase().client }))

const ENGINE = '0x' + '11'.repeat(20)
const TOKEN0 = '0x' + '22'.repeat(20)
const TOKEN1 = '0x' + '33'.repeat(20)
const POOL = '0x' + 'ab'.repeat(32)
const instance = { id: 'engine-1', poolAddress: POOL, chainId: 84532, pairLabel: 'A / USDG', engineAddress: ENGINE, quoteAsset: TOKEN1, token0: TOKEN0, token1: TOKEN1, status: 'active', verified: true, source: 'registry', live: true }
const verified = { ok: true, codeHash: '0x' + '44'.repeat(32), owner: '0x' + '55'.repeat(20), quoteAsset: TOKEN1, token0: TOKEN0, token1: TOKEN1, poolKey: { currency0: TOKEN0, currency1: TOKEN1, fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) } }
const req = (url: string) => { const r = new Request(url); (r as unknown as { nextUrl: URL }).nextUrl = new URL(url); return r as never }

beforeEach(() => {
  state.config = { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }
  state.instance = instance
  state.verify = verified
  state.read = vi.fn(async (arg: { functionName: string }) => ({ decimals: 6, tickLower: -100, tickUpper: 100, activated: true } as Record<string, unknown>)[arg.functionName] ?? 6)
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
  it('does not advertise an engine that fails current on-chain identity checks', async () => {
    state.verify = { ok: false, error: 'engine_owner_mismatch' }
    const { GET } = await import('./route')
    expect((await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL}`))).status).toBe(503)
  })
})
