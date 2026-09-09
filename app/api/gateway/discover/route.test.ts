// /api/gateway/discover — HO-11 (`live` only for ACTIVE instances), O-7 (`usdgConfigured` fail-closed
// signal), O-8 (per-IP floor + coalesced refresh).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const POOL = '0x' + 'ab'.repeat(32)
const state = vi.hoisted(() => ({
  instances: [] as Array<{ pool_address: string; status: string }>,
  filters: [] as Array<[string, unknown]>,
  hotCalls: 0,
}))

vi.mock('@/lib/gateway/chain', () => ({ gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.test' }) }))
vi.mock('@/lib/web2/supabase', () => ({
  getServiceClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => { state.filters.push([col, val]); return b },
        then: (res: (v: unknown) => unknown) => Promise.resolve({
          data: state.instances.filter((r) => state.filters.every(([c, v]) => c !== 'status' || r.status === v)),
          error: null,
        }).then(res),
      }
      return b
    },
  }),
}))
vi.mock('@/lib/gateway/discovery', () => ({
  fetchHotPools: async () => {
    state.hotCalls++
    await new Promise((r) => setTimeout(r, 5))
    return [{
      poolAddress: POOL, pairLabel: 'X / USDG', tvlUsd: 1, vol24Usd: 1, priceQuotePerBase: null,
      signals: { volTvlRatio: null, poolAgeDays: null, txCount24: null }, score: 0, verdict: 'review', reasons: [],
      baseSymbol: 'X', quoteSymbol: 'USDG', baseLogo: null, quoteLogo: null, feePct: null, estFeeAprPct: null,
    }]
  },
  // 2026-09-09 fix: discover has its OWN address (falls back to LP_GATEWAY_USDG) — mirrors the real
  // discoverUsdgEnv() so route.ts's usdgConfigured stays test-covered after the split.
  discoverUsdgEnv: () => process.env.LP_GATEWAY_DISCOVER_USDG ?? process.env.LP_GATEWAY_USDG,
}))

const req = (ip: string) => new NextRequest('https://mintware.test/api/gateway/discover', { headers: { 'x-forwarded-for': ip } })

beforeEach(() => { state.instances = []; state.filters = []; state.hotCalls = 0; vi.resetModules() })
afterEach(() => { delete process.env.LP_GATEWAY_USDG; delete process.env.LP_GATEWAY_DISCOVER_USDG })

describe('/api/gateway/discover', () => {
  it('HO-11: a DEACTIVATED instance is not "live"; an active one is; usdgConfigured reflects the env', async () => {
    state.instances = [{ pool_address: POOL, status: 'inactive' }]
    const { GET } = await import('./route')
    const b1 = await (await GET(req('192.0.2.1'))).json()
    expect(b1.success).toBe(true)
    expect(b1.pools[0].live).toBe(false)
    expect(b1.usdgConfigured).toBe(false)
    expect(state.filters).toContainEqual(['status', 'active'])

    process.env.LP_GATEWAY_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    state.instances = [{ pool_address: POOL, status: 'active' }]
    const b2 = await (await GET(req('192.0.2.1'))).json()
    expect(b2.pools[0].live).toBe(true)
    expect(b2.usdgConfigured).toBe(true)
  })

  it('concurrent cold-cache requests coalesce into ONE upstream read; later ones hit the 3-min cache', async () => {
    const { GET } = await import('./route')
    await Promise.all([GET(req('192.0.2.2')), GET(req('192.0.2.3')), GET(req('192.0.2.4'))])
    expect(state.hotCalls).toBe(1)
    await GET(req('192.0.2.5'))
    expect(state.hotCalls).toBe(1)
  })

  it('per-IP floor: 429-shaped JSON without Upstash', async () => {
    const { GET } = await import('./route')
    let saw429 = false
    for (let i = 0; i < 60; i++) {
      const r = await GET(req('192.0.2.9'))
      if (r.status === 429) { saw429 = true; expect((await r.json()).code).toBe('RATE_LIMITED'); break }
    }
    expect(saw429).toBe(true)
    expect((await GET(req('192.0.2.10'))).status).toBe(200)
  })
})
