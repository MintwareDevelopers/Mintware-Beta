// Price-trend sparklines (Meteora standard) for the Discover feed. Pulls 24×1h close prices per pool
// from GeckoTerminal's OHLCV endpoint (v4 poolIds are accepted verbatim). Read-only, fail-soft: any pool
// that errors/rate-limits is simply omitted, so a sparkline never blocks or breaks the table. Kept out of
// the main /discover call (which has its own budget) — this is its own cached endpoint.
//
// Round-2 audit O-8 (R-5 / HO-9): this module is the upstream-fan-out amplifier, so it now carries the
// bounds itself — a hard per-call id cap (MAX_POOLS), a PER-ID LRU cache with TTL (hits never touch
// upstream; misses are cached too, so junk ids can't be replayed for free), in-flight coalescing (N
// concurrent callers for one id = one upstream request), and a small in-memory token bucket the route
// uses as a per-IP floor even when Upstash is unset. All in-process (per instance) — Upstash is still
// the real cross-instance limiter; this is the floor that keeps a single box from starving GeckoTerminal.

type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void }

/** Hard cap on ids per call — bounds the GeckoTerminal burst (free tier ~30 req/min). */
export const MAX_POOLS = 12
/** Per-id cache TTLs: a served series is good for 15 min; a miss (no data) is remembered for 5 min. */
export const SERIES_TTL_MS = 15 * 60_000
export const MISS_TTL_MS = 5 * 60_000
/** Max distinct ids held in the per-id cache (LRU). */
export const CACHE_MAX_ENTRIES = 500

/** Accept only a 20-byte address or a 32-byte v4 poolId (mirrors discovery.ts) so a caller-supplied id
 *  can never inject an arbitrary path segment into the upstream URL — and so a junk string can never
 *  become a cache key. */
export function validId(v: unknown): string | null {
  const s = String(v ?? '').toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(s) || /^0x[0-9a-f]{64}$/.test(s) ? s : null
}

// ── Bounded LRU with TTL (insertion-ordered Map; touch = delete + re-set) ────────────────────────
export class LruCache<V> {
  private map = new Map<string, { at: number; ttl: number; value: V }>()
  constructor(private readonly max: number) {}
  get size() { return this.map.size }
  get(key: string, now = Date.now()): V | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (now - e.at > e.ttl) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, e) // most-recently-used → end
    return e.value
  }
  /** True when the key holds an unexpired entry — a remembered `null` counts as present. */
  has(key: string, now = Date.now()): boolean { return this.get(key, now) !== undefined }
  set(key: string, value: V, ttl: number, now = Date.now()): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { at: now, ttl, value })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }
  clear() { this.map.clear() }
}

// ── In-memory token bucket (per key, bounded key count) — the floor when Upstash is unset ────────
export type TokenBucket = {
  /** Take one token for `key`; false when the bucket is empty (→ 429). */
  take: (key: string, now?: number) => boolean
  /** Number of tracked keys (bounded by `maxKeys`). */
  readonly size: number
}

export function createTokenBucket(opts: { capacity: number; refillPerSec: number; maxKeys?: number }): TokenBucket {
  const { capacity, refillPerSec } = opts
  const maxKeys = opts.maxKeys ?? 10_000
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    take(key, now = Date.now()) {
      let b = buckets.get(key)
      if (!b) {
        b = { tokens: capacity, at: now }
      } else {
        buckets.delete(key) // re-insert → LRU order
        const elapsed = Math.max(0, now - b.at) / 1000
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec)
        b.at = now
      }
      const ok = b.tokens >= 1
      if (ok) b.tokens -= 1
      buckets.set(key, b)
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value
        if (oldest === undefined) break
        buckets.delete(oldest)
      }
      return ok
    },
    get size() { return buckets.size },
  }
}

// ── Upstream read (one id) ───────────────────────────────────────────────────────────────────────
async function oneSeries(network: string, poolId: string, log?: Logger): Promise<number[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolId}/ohlcv/hour?limit=24&currency=token`,
      { headers: { accept: 'application/json' }, signal: ctrl.signal },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: unknown } } }
    const raw = json?.data?.attributes?.ohlcv_list
    const list = Array.isArray(raw) ? raw : []
    // ohlcv_list is [ts, open, high, low, close, volume], newest-first → take closes, oldest→newest.
    const closes = list
      .map((c) => (Array.isArray(c) ? Number(c[4]) : NaN))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse()
      .slice(0, 48)
    return closes.length >= 3 ? closes : null
  } catch (e) {
    log?.warn('gateway.sparkline', 'ohlcv error', { poolId, error: String(e) })
    return null
  } finally {
    clearTimeout(timer)
  }
}

function networkSlug(explicit?: string): string {
  const n = (explicit ?? process.env.LP_GATEWAY_GT_NETWORK ?? 'robinhood').toLowerCase()
  return /^[a-z0-9-]{1,40}$/.test(n) ? n : 'robinhood'
}

/** Validate + dedupe + cap a caller-supplied id list. Returns the accepted ids and whether any were
 *  dropped for shape or for the cap (so the route can tell the client). */
export function normalizeIds(input: unknown[]): { ids: string[]; invalid: number; truncated: boolean } {
  const valid = input.map(validId).filter((x): x is string => !!x)
  const unique = Array.from(new Set(valid))
  return { ids: unique.slice(0, MAX_POOLS), invalid: input.length - valid.length, truncated: unique.length > MAX_POOLS }
}

/** Fetch close-price series for the given pools (capped, in parallel, fail-soft, UNCACHED). Returns a
 *  map poolId → number[] (oldest→newest); pools that fail are absent from the map. */
export async function fetchSparklines(poolAddresses: string[], opts: { network?: string; log?: Logger } = {}): Promise<Record<string, number[]>> {
  const network = networkSlug(opts.network)
  const { ids } = normalizeIds(poolAddresses)
  const out: Record<string, number[]> = {}
  await Promise.all(
    ids.map(async (id) => {
      const s = await oneSeries(network, id, opts.log)
      if (s) out[id] = s
    }),
  )
  return out
}

// ── Cached + coalesced variant (what the route uses) ─────────────────────────────────────────────
// `null` in the cache = a remembered miss (no data / upstream error) so a junk-but-well-formed id costs
// upstream at most once per MISS_TTL_MS per instance.
const seriesCache = new LruCache<number[] | null>(CACHE_MAX_ENTRIES)
const inflight = new Map<string, Promise<number[] | null>>()

/** Test/ops hook — drop every cached series + in-flight promise. */
export function resetSparklineCache(): void {
  seriesCache.clear()
  inflight.clear()
}

export type CachedSparklines = { series: Record<string, number[]>; hits: number; misses: number; coalesced: number }

/** Per-id cache → in-flight coalesce → upstream. Never throws; never more than MAX_POOLS upstream calls. */
export async function fetchSparklinesCached(
  poolAddresses: string[],
  opts: { network?: string; log?: Logger; now?: number } = {},
): Promise<CachedSparklines> {
  const network = networkSlug(opts.network)
  const now = opts.now ?? Date.now()
  const { ids } = normalizeIds(poolAddresses)
  const out: Record<string, number[]> = {}
  let hits = 0
  let misses = 0
  let coalesced = 0
  await Promise.all(
    ids.map(async (id) => {
      const cached = seriesCache.get(id, now)
      if (cached !== undefined) {
        hits++
        if (cached) out[id] = cached
        return
      }
      let p = inflight.get(id)
      if (p) {
        coalesced++
      } else {
        misses++
        p = oneSeries(network, id, opts.log)
          .then((s) => {
            seriesCache.set(id, s, s ? SERIES_TTL_MS : MISS_TTL_MS, now)
            return s
          })
          .catch(() => null)
          .finally(() => inflight.delete(id))
        inflight.set(id, p)
      }
      const s = await p
      if (s) out[id] = s
    }),
  )
  return { series: out, hits, misses, coalesced }
}
