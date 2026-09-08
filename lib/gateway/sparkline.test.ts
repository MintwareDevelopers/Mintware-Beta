import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  LruCache, createTokenBucket, normalizeIds, validId, fetchSparklines, fetchSparklinesCached, resetSparklineCache,
  MAX_POOLS, SERIES_TTL_MS, MISS_TTL_MS, CACHE_MAX_ENTRIES,
} from './sparkline'

// Unique 32-byte ids: a fixed 'f' prefix + an 8-hex zero-padded counter (a bare padStart('f') collides:
// id(0) === id(240) because 'f0' left-padded with f's equals '0' left-padded with f's).
const id = (i: number) => '0x' + 'f'.repeat(56) + i.toString(16).padStart(8, '0')
const ohlcv = (n = 5) => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: Array.from({ length: n }, (_, k) => [k, 1, 1, 1, k + 1, 0]) } } }) })

beforeEach(() => resetSparklineCache())
afterEach(() => vi.unstubAllGlobals())

describe('validId / normalizeIds (O-8)', () => {
  it('accepts only 20- or 32-byte hex; dedupes; caps at MAX_POOLS; reports drops', () => {
    expect(validId('0x' + 'a'.repeat(40))).toBe('0x' + 'a'.repeat(40))
    expect(validId('0x' + 'A'.repeat(64))).toBe('0x' + 'a'.repeat(64))
    expect(validId('x'.repeat(2000))).toBeNull()
    expect(validId('0x' + 'a'.repeat(63))).toBeNull()
    expect(validId('../ohlcv')).toBeNull()
    const junk = ['junk', ...Array.from({ length: 20 }, (_, i) => id(i)), id(0)]
    const r = normalizeIds(junk)
    expect(r.ids.length).toBe(MAX_POOLS)
    expect(MAX_POOLS).toBe(12)
    expect(r.invalid).toBe(1)
    expect(r.truncated).toBe(true)
    expect(normalizeIds([id(1), id(2)])).toEqual({ ids: [id(1), id(2)], invalid: 0, truncated: false })
  })
})

describe('LruCache — bounded, TTL, LRU eviction', () => {
  it('evicts the least-recently-used entry past max and expires by TTL', () => {
    const c = new LruCache<number>(2)
    c.set('a', 1, 1000, 0)
    c.set('b', 2, 1000, 0)
    expect(c.get('a', 1)).toBe(1) // touch a → b is now LRU
    c.set('c', 3, 1000, 2)
    expect(c.size).toBe(2)
    expect(c.get('b', 3)).toBeUndefined()
    expect(c.get('a', 3)).toBe(1)
    expect(c.get('a', 5_000)).toBeUndefined() // expired
    expect(c.size).toBe(1)
  })
  it('stores null as a real (remembered-miss) value distinct from a miss', () => {
    const c = new LruCache<number[] | null>(5)
    c.set('m', null, 1000, 0)
    expect(c.get('m', 1)).toBeNull()
    expect(c.has('m', 1)).toBe(true) // a remembered miss is a present entry
    expect(c.get('zzz', 1)).toBeUndefined()
    expect(c.has('zzz', 1)).toBe(false)
  })
})

describe('createTokenBucket — per-key floor with bounded keys', () => {
  it('allows `capacity` burst then refills at the rate; keys are LRU-bounded', () => {
    const b = createTokenBucket({ capacity: 3, refillPerSec: 1, maxKeys: 2 })
    expect(b.take('ip1', 0)).toBe(true)
    expect(b.take('ip1', 0)).toBe(true)
    expect(b.take('ip1', 0)).toBe(true)
    expect(b.take('ip1', 0)).toBe(false) // 429 floor
    expect(b.take('ip1', 1_000)).toBe(true) // +1 token after 1 s
    expect(b.take('ip1', 1_000)).toBe(false)
    b.take('ip2', 1_000)
    b.take('ip3', 1_000) // evicts ip1 (LRU)
    expect(b.size).toBe(2)
    expect(b.take('ip1', 1_000)).toBe(true) // fresh bucket after eviction
  })
})

describe('fetchSparklines (uncached) — hard cap on upstream fan-out', () => {
  it('never issues more than MAX_POOLS upstream calls, and only for valid ids', async () => {
    const f = vi.fn(async () => ohlcv())
    vi.stubGlobal('fetch', f)
    const junk = ['nope', 'x'.repeat(2000), ...Array.from({ length: 16 }, (_, i) => id(i))]
    const out = await fetchSparklines(junk, {})
    expect(f).toHaveBeenCalledTimes(MAX_POOLS)
    expect(Object.keys(out).length).toBe(MAX_POOLS)
    for (const c of f.mock.calls) expect(String((c as unknown[])[0])).toMatch(/\/pools\/0xf{56}[0-9a-f]{8}\/ohlcv/)
  })
  it('a malformed ohlcv body is a null series, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: 'nope' } } }) })))
    expect(await fetchSparklines([id(1)])).toEqual({})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 'x', 0], null, 5] } } }) })))
    expect(await fetchSparklines([id(1)])).toEqual({})
  })
})

describe('fetchSparklinesCached — per-id cache + remembered misses + coalescing', () => {
  it('a second request for the same ids is served from cache (0 upstream calls); a miss is remembered too', async () => {
    const f = vi.fn(async (u: string) => (u.includes(id(2)) ? { ok: false, status: 404, json: async () => ({}) } : ohlcv()))
    vi.stubGlobal('fetch', f)
    const r1 = await fetchSparklinesCached([id(1), id(2)])
    expect(f).toHaveBeenCalledTimes(2)
    expect(r1.misses).toBe(2)
    expect(Object.keys(r1.series)).toEqual([id(1)])
    const r2 = await fetchSparklinesCached([id(1), id(2)])
    expect(f).toHaveBeenCalledTimes(2) // both hits — including the remembered miss for id(2)
    expect(r2.hits).toBe(2)
    expect(r2.misses).toBe(0)
  })
  it('a remembered miss expires after MISS_TTL_MS; a series after SERIES_TTL_MS', async () => {
    const f = vi.fn(async (u: string) => (u.includes(id(2)) ? { ok: false, status: 404, json: async () => ({}) } : ohlcv()))
    vi.stubGlobal('fetch', f)
    const t0 = Date.now()
    await fetchSparklinesCached([id(1), id(2)], { now: t0 })
    await fetchSparklinesCached([id(1), id(2)], { now: t0 + MISS_TTL_MS + 1 })
    expect(f).toHaveBeenCalledTimes(3) // only the miss re-fetched
    await fetchSparklinesCached([id(1), id(2)], { now: t0 + MISS_TTL_MS + 2 })
    expect(f).toHaveBeenCalledTimes(3) // both cached again (series still fresh, miss just refreshed)
    await fetchSparklinesCached([id(1), id(2)], { now: t0 + SERIES_TTL_MS + 1 })
    expect(f).toHaveBeenCalledTimes(5) // series expired; the refreshed miss (5-min TTL) expired again too
  })
  it('concurrent callers for one id coalesce into ONE upstream request', async () => {
    let resolve!: (v: unknown) => void
    const gate = new Promise((r) => { resolve = r })
    const f = vi.fn(async () => { await gate; return ohlcv() })
    vi.stubGlobal('fetch', f)
    const p = Promise.all([fetchSparklinesCached([id(1)]), fetchSparklinesCached([id(1)]), fetchSparklinesCached([id(1)])])
    await new Promise((r) => setTimeout(r, 5))
    expect(f).toHaveBeenCalledTimes(1)
    resolve(null)
    const rs = await p
    expect(rs.filter((r) => r.coalesced === 1).length).toBe(2)
    expect(rs.every((r) => r.series[id(1)]?.length === 5)).toBe(true)
  })
  it('the per-id cache is bounded (LRU) — junk-but-valid ids can never grow it past CACHE_MAX_ENTRIES', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    for (let batch = 0; batch < Math.ceil((CACHE_MAX_ENTRIES + 100) / MAX_POOLS); batch++) {
      await fetchSparklinesCached(Array.from({ length: MAX_POOLS }, (_, i) => id(batch * MAX_POOLS + i)))
    }
    // First ids were evicted → a re-request is a miss again (bounded memory, bounded replay cost)
    const r = await fetchSparklinesCached([id(0)])
    expect(r.misses).toBe(1)
  })
})
