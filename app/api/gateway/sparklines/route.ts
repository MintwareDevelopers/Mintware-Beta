import { createHandler } from '@/lib/web2/routeHandler'
import { fetchSparklines } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// Price-trend sparklines for the Discover rows (Meteora standard). The client passes the pool ids it's
// showing (?pools=a,b,c); we return { poolId: number[] } close-price series. Cached ~15 min per id-set —
// sparklines don't need the 3-min freshness the price/TVL numbers do, and it bounds GeckoTerminal calls.
// Fail-soft: pools GeckoTerminal can't serve are simply absent (the row shows no sparkline).

const TTL_MS = 15 * 60_000
const cache = new Map<string, { at: number; series: Record<string, number[]> }>()

export const GET = createHandler(async (req, ctx) => {
  const raw = new URL(req.url).searchParams.get('pools') ?? ''
  const ids = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 30)
  if (ids.length === 0) return ctx.json({ success: true, series: {} })

  const key = [...ids].sort().join(',')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return ctx.json({ success: true, series: hit.series, cachedAt: hit.at })

  const series = await fetchSparklines(ids, { log: ctx.log })
  cache.set(key, { at: Date.now(), series })
  return ctx.json({ success: true, series, cachedAt: Date.now() })
})
