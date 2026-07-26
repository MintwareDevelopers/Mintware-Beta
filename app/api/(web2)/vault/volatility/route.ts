// GET /api/vault/volatility?feed_id=<hex>&window_hours=<n>&tick_spacing=<n>
// Returns VolatilityMetrics for a Pyth price feed. Cached 5 min at CDN.
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'
import { computeVolatilityMetrics } from '@/lib/web3/vault/volatilityMonitor'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (req, ctx) => {
  const feedId      = req.nextUrl.searchParams.get('feed_id')
  const windowHours = Number(req.nextUrl.searchParams.get('window_hours') ?? '168')
  const tickSpacing = Number(req.nextUrl.searchParams.get('tick_spacing') ?? '60')

  if (!feedId) return ctx.json({ error: 'feed_id is required' }, 400)

  const cleanId = feedId.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(cleanId)) return ctx.json({ error: 'feed_id must be a 32-byte hex string (64 hex chars, optionally 0x-prefixed)' }, 400)
  if (isNaN(windowHours) || windowHours < 1 || windowHours > 8760) return ctx.json({ error: 'window_hours must be between 1 and 8760' }, 400)
  if (isNaN(tickSpacing) || tickSpacing < 1 || tickSpacing > 200) return ctx.json({ error: 'tick_spacing must be between 1 and 200' }, 400)

  try {
    const metrics = await computeVolatilityMetrics(feedId, windowHours, tickSpacing)
    const res = ctx.json(metrics)
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    return res
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('insufficient data') || message.includes('no candle data'))
      return ctx.json({ error: message }, 422)
    ctx.log.error('vault/volatility', 'computeVolatilityMetrics error', { error: message })
    return ctx.json({ error: 'Failed to compute volatility metrics' }, 500)
  }
})
