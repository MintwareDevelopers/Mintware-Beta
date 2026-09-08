// RED-TEAM PoC (off-chain, 2026-09-08) — public-route abuse with the rate limiter failing OPEN
// (no Upstash/KV env → every declared limit is a no-op; sparklines declares none at all).
// Passing = demonstrated.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSparklines } from '../sparkline'

vi.mock('@/lib/web2/supabase', () => {
  const inserted: unknown[] = []
  return {
    __inserted: inserted,
    getServiceClient: () => ({
      from: () => ({ insert: async (row: unknown) => { inserted.push(row); return { error: null } } }),
    }),
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('/api/gateway/sparklines → GeckoTerminal fan-out amplifier (no auth, no rate limit, unbounded cache)', () => {
  it('any caller-supplied 64-hex id is treated as a pool → up to 16 upstream requests per call, all cache misses', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [] } } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const junk = Array.from({ length: 16 }, (_, i) => '0x' + i.toString(16).padStart(64, 'f')) // never-existing pool ids
    await fetchSparklines(junk, {})
    expect(fetchMock).toHaveBeenCalledTimes(16)
    // 30 req/min free-tier ⇒ TWO such calls per minute exhaust the shared upstream quota for /api/gateway/discover
    // (fetchHotPools returns [] on !res.ok) → the public Discover feed reads "No pools match yet" for everyone.
    for (const c of fetchMock.mock.calls) expect(String(c[0])).toMatch(/geckoterminal\.com\/api\/v2\/networks\/robinhood\/pools\/0xf+[0-9a-f]\/ohlcv/)
  })
})

describe('/api/gateway/request → unbounded, unauthenticated inserts into the curator queue', () => {
  it('accepts a 100 KB pool_address, any chainId, any pair_label/requester text; no shape validation', async () => {
    const mod = await import('@/lib/web2/supabase') as unknown as { __inserted: Array<Record<string, unknown>> }
    const { POST } = await import('@/app/api/gateway/request/route')
    const body = { poolAddress: 'A'.repeat(100_000), chainId: 999_999, pairLabel: '<img src=x>'.repeat(1000), requesterWallet: 'not-an-address' }
    const req = new Request('https://x.test/api/gateway/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const row = mod.__inserted[0]
    expect(String(row.pool_address).length).toBe(100_000)
    expect(row.chain_id).toBe(999_999)
    // rate limit declared {max:5/min} but Upstash/KV env unset ⇒ rl === null ⇒ never consulted:
    for (let i = 0; i < 20; i++) {
      const r = await POST(new Request('https://x.test/api/gateway/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, poolAddress: `spam-${i}` }) }) as unknown as Parameters<typeof POST>[0])
      expect(r.status).toBe(200)
    }
    expect(mod.__inserted.length).toBe(21)
  })
})
