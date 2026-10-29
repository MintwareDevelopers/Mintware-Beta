import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ instance: null as unknown, reads: vi.fn(), registryError: false }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => ({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }), resolveMarketEngine: async () => { if (state.registryError) throw new Error('missing column'); return state.instance } }))
vi.mock('@/lib/gateway/chain', () => ({ marketEnginePublicClient: () => ({ readContract: state.reads }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => fakeSupabase().client }))

const ENGINE = '0x' + '11'.repeat(20)
const POOL = '0x' + 'ab'.repeat(32)
const instance = { id: 'engine-1', poolAddress: POOL, chainId: 84532, pairLabel: 'A / USDG', engineAddress: ENGINE, quoteAsset: '0x' + '22'.repeat(20), token0: '0x' + '33'.repeat(20), token1: '0x' + '22'.repeat(20), status: 'active', verified: true, source: 'registry', live: true }
const req = (url: string) => { const r = new Request(url); (r as unknown as { nextUrl: URL }).nextUrl = new URL(url); return r as never }

beforeEach(() => {
  state.instance = instance
  state.registryError = false
  state.reads = vi.fn(async ({ functionName }: { functionName: string }) => ({ balanceOf: 2_000_000_000_000_000_000n, totalSupply: 10_000_000_000_000_000_000n, totalNav: 15_000_000n } as Record<string, bigint>)[functionName] ?? 0n)
})

describe('GET /api/gateway/position — MarketEngine shares × NAV', () => {
  it('reads ERC20 shares and marks the position from engine NAV and supply', async () => {
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=0x${'44'.repeat(20)}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.position.shares).toBe('2000000000000000000')
    expect(body.position.positionValueAtomic).toBe('3000000')
    expect(body.totalNav).toBe('15000000')
    expect(body.totalSupply).toBe('10000000000000000000')
  })
  it('reads a retired registry engine position when the generation is named', async () => {
    state.instance = { ...instance, status: 'inactive', live: false }
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&pm=${ENGINE}&address=0x${'44'.repeat(20)}`))
    expect(res.status).toBe(200)
    expect((await res.json()).position.shares).toBe('2000000000000000000')
  })
  it('returns a clear 503 on a registry schema error', async () => {
    state.registryError = true
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=0x${'44'.repeat(20)}`))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'engine_registry_unavailable' })
  })
  it('rejects malformed wallet addresses', async () => {
    const { GET } = await import('./route')
    expect((await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=bad`))).status).toBe(400)
  })
  it('keeps public GET rate limited', async () => {
    const { GET } = await import('./route')
    let status = 200
    for (let i = 0; i < 35; i++) status = (await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=0x${'44'.repeat(20)}`))).status
    expect(status).toBe(429)
  })
})
