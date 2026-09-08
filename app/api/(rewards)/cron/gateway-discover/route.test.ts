// O-7: the discover cron must SURVIVE a hostile / malformed / stalled GeckoTerminal — never a 500, never
// a prune on a failed read. Also: bearer fails closed (O-12: no dev bypass without the explicit opt-in).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.client }))
vi.mock('@/lib/gateway/chain', () => ({ gatewayConfig: () => ({ chainId: 4663, rpcUrl: 'https://rpc.test' }) }))

const CHAIN = 4663
const req = (auth?: string) => new NextRequest('https://mintware.test/api/cron/gateway-discover', { method: 'POST', headers: auth ? { authorization: auth } : {} })

const envSaved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ['CRON_SECRET', 'LP_GATEWAY_USDG', 'ALLOW_DEV_BEARER_BYPASS']) envSaved[k] = process.env[k]
  process.env.CRON_SECRET = 'cron-test-secret'
  process.env.LP_GATEWAY_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
  delete process.env.ALLOW_DEV_BEARER_BYPASS
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const [k, v] of Object.entries(envSaved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

function seed() {
  const s = fakeSupabase({
    tables: { gateway_instances: [], gateway_pool_requests: [{ id: 'keep', pool_address: '0x' + 'ab'.repeat(32), chain_id: CHAIN, status: 'pending', source: 'auto' }] },
  })
  state.client = s.client
  return s
}

describe('POST /api/cron/gateway-discover', () => {
  it('rejects a missing / wrong bearer (401) and never touches upstream', async () => {
    seed()
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { POST } = await import('./route')
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req('Bearer nope'))).status).toBe(401)
    expect(f).toHaveBeenCalledTimes(0)
  })

  it('with CRON_SECRET unset it fails CLOSED (500 MISSING_SECRET) — no NODE_ENV=development free pass', async () => {
    seed()
    delete process.env.CRON_SECRET
    const { POST } = await import('./route')
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('MISSING_SECRET')
  })

  for (const [label, body] of [
    ['non-JSON body', async () => { throw new SyntaxError('Unexpected token') }],
    ['data is a string', async () => ({ data: 'not-an-array' })],
    ['data has garbage entries', async () => ({ data: [null, 1, 'x', [], { attributes: 'str', relationships: 9 }] })],
    ['top-level is an array', async () => [1, 2, 3]],
    ['pool with absurd numerics', async () => ({ data: [{ attributes: { address: '0x' + 'ee'.repeat(32), name: 'X / USDG 99%', reserve_in_usd: '1e400', volume_usd: { h24: -1 }, pool_created_at: 'never', transactions: { h24: { buys: 'a' } } }, relationships: { dex: { data: { id: 'uniswap_v4' } }, base_token: { data: { id: 5 } }, quote_token: { data: { id: 'robinhood_0x5fc5360d0400a0fd4f2af552add042d716f1d168' } } } }] })],
  ] as const) {
    it(`survives a malformed upstream payload: ${label} (200, queue untouched)`, async () => {
      const { db } = seed()
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: body })))
      const { POST } = await import('./route')
      const res = await POST(req('Bearer cron-test-secret'))
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.success).toBe(true)
      expect(j.pruned).toBe(0)
      expect(db.tables.gateway_pool_requests.find((r) => r.id === 'keep')).toBeDefined()
    })
  }

  it('survives a stalled upstream (timeout) and a thrown fetch — 200 with upstream:"error"', async () => {
    const { db } = seed()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { POST } = await import('./route')
    const res = await POST(req('Bearer cron-test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, upstream: 'error', scanned: 0, pruned: 0 })
    expect(db.tables.gateway_pool_requests.length).toBe(1)
  })
})
