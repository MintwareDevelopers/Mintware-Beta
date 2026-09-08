// ROUND-3 EXPLOIT REPLAY — rate-limit bypass by IP-header spoofing (O-8 in-memory floor) and by
// serverless fan-out. Incident class: every "X-Forwarded-For is the client" limiter ever put behind a
// proxy that does not overwrite the header (Cloudflare→origin, nginx `real_ip` misconfig, GitHub 2017 …).
//
// Finding: the floor keys on `x-forwarded-for` (first hop) — an ATTACKER-CONTROLLED header anywhere the
// platform does not overwrite it. On Vercel the header IS overwritten (live probe 2026-09-08: 26 GETs with
// rotating spoofed XFF → 21×200 then 429; the same from one real IP → 429) so prod is MITIGATED by the
// platform, not by the code. Self-hosted / preview-behind-CDN deployments would be wide open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetSparklineCache, createTokenBucket } from '@/lib/gateway/sparkline'

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }) }) }))
vi.mock('@/lib/gateway/discovery', () => ({ fetchHotPools: async () => [] }))
vi.mock('@/lib/gateway/chain', () => ({ gatewayConfig: () => null, gatewayPublicClient: () => ({}) }))

const POOL = '0x' + 'ab'.repeat(32)
const ohlcv = () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 1, 0], [2, 1, 1, 1, 2, 0], [3, 1, 1, 1, 3, 0]] } } }) })

beforeEach(() => resetSparklineCache())
afterEach(() => vi.unstubAllGlobals())

describe('EXPLOITABLE off-Vercel / MITIGATED on Vercel: the in-memory per-IP floor trusts X-Forwarded-For', () => {
  it('/api/gateway/sparklines — 60 requests from ONE client with rotating spoofed XFF → zero 429s (the same client keyed honestly hits 429 at the 21st)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ohlcv()))
    const { GET } = await import('@/app/api/gateway/sparklines/route')
    let limited = 0
    for (let i = 0; i < 60; i++) {
      const res = await GET(new NextRequest(`https://mintware.test/api/gateway/sparklines?pools=${POOL}`, { headers: { 'x-forwarded-for': `203.0.113.${i % 250}, 10.0.0.1` } }))
      if (res.status === 429) limited++
    }
    expect(limited).toBe(0) // ← floor bypassed by header rotation
    // control: one honest IP
    let ok = 0
    limited = 0
    for (let i = 0; i < 30; i++) {
      const res = await GET(new NextRequest(`https://mintware.test/api/gateway/sparklines?pools=${POOL}`, { headers: { 'x-forwarded-for': '198.51.100.9' } }))
      res.status === 429 ? limited++ : ok++
    }
    expect(ok).toBe(20)
    expect(limited).toBe(10)
  })

  it('/api/gateway/sparklines — with NO x-forwarded-for the fallback is X-Real-IP, then the shared key "unknown" (one bucket for everyone)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ohlcv()))
    const { GET } = await import('@/app/api/gateway/sparklines/route')
    // 25 anonymous callers with neither header share ONE bucket: legit traffic through such a proxy is throttled as one client
    let limited = 0
    for (let i = 0; i < 25; i++) if ((await GET(new NextRequest(`https://mintware.test/api/gateway/sparklines?pools=${POOL}`))).status === 429) limited++
    expect(limited).toBeGreaterThan(0)
  })

  it('/api/gateway/discover — same header trust; also keys ONLY on x-forwarded-for (no x-real-ip fallback)', async () => {
    const { GET } = await import('@/app/api/gateway/discover/route')
    let limited = 0
    for (let i = 0; i < 80; i++) {
      const res = await GET(new NextRequest('https://mintware.test/api/gateway/discover', { headers: { 'x-forwarded-for': `192.0.2.${i % 250}` } }))
      if (res.status === 429) limited++
    }
    expect(limited).toBe(0)
  })

  it('bucket key eviction (maxKeys LRU): 5 001 spoofed IPs evict the FIRST victim key → its budget silently resets (griefing the limiter itself)', () => {
    const b = createTokenBucket({ capacity: 1, refillPerSec: 0, maxKeys: 5000 })
    expect(b.take('victim')).toBe(true)
    expect(b.take('victim')).toBe(false) // exhausted
    for (let i = 0; i < 5000; i++) b.take(`spoof-${i}`)
    expect(b.size).toBe(5000)
    expect(b.take('victim')).toBe(true) // evicted → fresh bucket
  })
})

describe('createHandler (Upstash) keying — INFORMATIONAL', () => {
  it('keys on the WHOLE x-forwarded-for string (not the first hop): behind a CDN that appends, every attacker-chosen prefix is a distinct key', async () => {
    vi.resetModules()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'not-a-real-token')
    const keys: string[] = []
    vi.doMock('@upstash/redis', () => ({ Redis: class { constructor(_o: unknown) {} } }))
    vi.doMock('@upstash/ratelimit', () => ({
      Ratelimit: Object.assign(class { constructor(_o: unknown) {} async limit(k: string) { keys.push(k); return { success: true } } }, { slidingWindow: () => ({}) }),
    }))
    const { createHandler } = await import('@/lib/web2/routeHandler')
    const h = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { rateLimit: { max: 1, windowMs: 60_000 } })
    await h(new NextRequest('https://x.test/a', { headers: { 'x-forwarded-for': '203.0.113.5, 1.2.3.4' } }))
    await h(new NextRequest('https://x.test/a', { headers: { 'x-forwarded-for': '203.0.113.6, 1.2.3.4' } }))
    await h(new NextRequest('https://x.test/a'))
    expect(keys).toEqual(['203.0.113.5, 1.2.3.4', '203.0.113.6, 1.2.3.4', 'unknown'])
    vi.unstubAllEnvs()
    vi.doUnmock('@upstash/redis'); vi.doUnmock('@upstash/ratelimit')
  })

  it('serverless fan-out (quantified): the in-memory floor is per instance — N warm instances = N × (20 burst + 20/min)', () => {
    // Two independent module instances of the bucket (== two Vercel instances) each grant the full budget to the same IP.
    const a = createTokenBucket({ capacity: 20, refillPerSec: 20 / 60 })
    const b = createTokenBucket({ capacity: 20, refillPerSec: 20 / 60 })
    let granted = 0
    for (let i = 0; i < 40; i++) if ((i % 2 ? a : b).take('1.2.3.4')) granted++
    expect(granted).toBe(40) // 2 instances → 40 in the first second; Upstash (60/min/IP, cross-instance) is the real cap once set
  })
})
