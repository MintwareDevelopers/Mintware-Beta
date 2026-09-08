// O-8 (R-5 / HO-9): /api/gateway/sparklines — id validation before keying, ≤12 ids, per-IP 429 floor
// WITHOUT Upstash, per-id cache + coalescing (no distinct-set cache miss).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetSparklineCache, MAX_POOLS } from '@/lib/gateway/sparkline'

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({}) }))

const id = (i: number) => '0x' + 'f'.repeat(56) + i.toString(16).padStart(8, '0') // unique 32-byte ids
const ohlcv = () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 1, 0], [2, 1, 1, 1, 2, 0], [3, 1, 1, 1, 3, 0]] } } }) })
const req = (pools: string, ip = '203.0.113.7') => new NextRequest(`https://mintware.test/api/gateway/sparklines?pools=${encodeURIComponent(pools)}`, { headers: { 'x-forwarded-for': ip } })

beforeEach(() => resetSparklineCache())
afterEach(() => vi.unstubAllGlobals())

describe('/api/gateway/sparklines', () => {
  it('junk ids never reach the cache or upstream → 400 INVALID_IDS; nothing fetched', async () => {
    const f = vi.fn(async () => ohlcv())
    vi.stubGlobal('fetch', f)
    const { GET } = await import('./route')
    for (let i = 0; i < 5; i++) {
      const res = await GET(req('x'.repeat(2000) + i, '198.51.100.1'))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_IDS')
    }
    expect(f).toHaveBeenCalledTimes(0)
    expect((await GET(req('a'.repeat(5000), '198.51.100.1'))).status).toBe(400) // over-long list
  })

  it('caps to MAX_POOLS ids, flags truncation, and serves repeats from the per-id cache', async () => {
    const f = vi.fn(async () => ohlcv())
    vi.stubGlobal('fetch', f)
    const { GET } = await import('./route')
    const many = Array.from({ length: 30 }, (_, i) => id(i)).join(',')
    const r1 = await GET(req(many, '198.51.100.2'))
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.truncated).toBe(true)
    expect(b1.maxIds).toBe(MAX_POOLS)
    expect(Object.keys(b1.series).length).toBe(MAX_POOLS)
    expect(f).toHaveBeenCalledTimes(MAX_POOLS)
    // a DIFFERENT id-set that overlaps → only the new ids are fetched (per-id cache, not per-set)
    const r2 = await GET(req([id(0), id(1), id(40)].join(','), '198.51.100.2'))
    const b2 = await r2.json()
    expect(b2.stats).toMatchObject({ hits: 2, misses: 1 })
    expect(f).toHaveBeenCalledTimes(MAX_POOLS + 1)
  })

  it('per-IP in-memory floor returns 429-shaped JSON with NO Upstash configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ohlcv()))
    const { GET } = await import('./route')
    let first429 = -1
    for (let i = 0; i < 40; i++) {
      const res = await GET(req(id(1), '198.51.100.3'))
      if (res.status === 429) { first429 = i; expect(await res.json()).toEqual({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }); break }
    }
    expect(first429).toBeGreaterThan(0)
    expect(first429).toBeLessThanOrEqual(20)
    // another IP is unaffected
    expect((await GET(req(id(1), '198.51.100.4'))).status).toBe(200)
  })

  it('an empty list is a cheap 200 with no upstream call', async () => {
    const f = vi.fn(async () => ohlcv())
    vi.stubGlobal('fetch', f)
    const { GET } = await import('./route')
    const res = await GET(req('', '198.51.100.5'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, series: {} })
    expect(f).toHaveBeenCalledTimes(0)
  })
})
