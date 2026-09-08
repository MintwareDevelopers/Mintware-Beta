import { createHandler } from '@/lib/web2/routeHandler'
import { createTokenBucket, fetchSparklinesCached, normalizeIds, MAX_POOLS } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// Price-trend sparklines for the Discover rows (Meteora standard). The client passes the pool ids it's
// showing (?pools=a,b,c); we return { poolId: number[] } close-price series. Fail-soft: pools
// GeckoTerminal can't serve are simply absent (the row shows no sparkline).
//
// Round-2 audit O-8 (R-5 / HO-9) — this route was the upstream-fan-out amplifier:
//   • ids are shape-validated (20/32-byte hex) BEFORE anything is keyed or fetched; ≤ MAX_POOLS (12)
//     per request (extra ids are dropped and `truncated:true` is returned — the client batches);
//   • the cache is PER ID (bounded LRU + TTL, misses remembered) with in-flight coalescing, in
//     lib/gateway/sparkline.ts — a distinct id-set is no longer a distinct cache miss;
//   • a per-IP in-memory token bucket is the 429 FLOOR even when Upstash is unset (the declared
//     `rateLimit` is the real cross-instance limiter once Redis env is set).

/** Per-IP floor: 20 burst, then 20/min sustained (the Discover page needs ~1–3 calls per visit). */
const ipBucket = createTokenBucket({ capacity: 20, refillPerSec: 20 / 60, maxKeys: 5_000 })

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  return xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export const GET = createHandler(async (req, ctx) => {
  const ip = clientIp(req)
  if (!ipBucket.take(ip)) {
    ctx.log.warn('gateway.sparklines', 'per-IP floor exceeded', { ip })
    return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  }

  const raw = new URL(req.url).searchParams.get('pools') ?? ''
  if (raw.length > 4_096) return ctx.json({ success: false, error: 'pools list too long', code: 'INVALID_IDS' }, 400)
  const requested = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (requested.length === 0) return ctx.json({ success: true, series: {} })

  const { ids, invalid, truncated } = normalizeIds(requested)
  if (ids.length === 0) return ctx.json({ success: false, error: 'no valid pool ids (20- or 32-byte hex)', code: 'INVALID_IDS' }, 400)

  const { series, hits, misses, coalesced } = await fetchSparklinesCached(ids, { log: ctx.log })
  if (invalid > 0 || truncated) ctx.log.warn('gateway.sparklines', 'ids dropped', { invalid, truncated, max: MAX_POOLS })
  return ctx.json({ success: true, series, cachedAt: Date.now(), maxIds: MAX_POOLS, truncated, invalid, stats: { hits, misses, coalesced } })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
