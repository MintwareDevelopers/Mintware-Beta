// GET /api/vault/volatility?feed_id=<hex>&window_hours=<n>&tick_spacing=<n>
//
// Returns VolatilityMetrics for a Pyth price feed.
// Used by T4.2 range proposal algorithm to decide when and how to rebalance.
//
// Params:
//   feed_id      — Pyth price feed ID (hex, with or without 0x prefix) — required
//   window_hours — lookback window in hours (default 168 = 7 days)
//   tick_spacing — V4 pool tick spacing for range alignment (default 60)
//
// Response is cached at the CDN edge for 5 minutes (price data changes slowly).

import { NextRequest, NextResponse } from 'next/server'
import { computeVolatilityMetrics } from '@/lib/web3/vault/volatilityMonitor'

export const dynamic = 'force-dynamic'  // disable static generation, allow Next.js fetch cache

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const feedId      = searchParams.get('feed_id')
  const windowHours = Number(searchParams.get('window_hours') ?? '168')
  const tickSpacing = Number(searchParams.get('tick_spacing') ?? '60')

  if (!feedId) {
    return NextResponse.json({ error: 'feed_id is required' }, { status: 400 })
  }

  // Basic feed_id format validation (32-byte hex, optionally 0x-prefixed)
  const cleanId = feedId.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(cleanId)) {
    return NextResponse.json(
      { error: 'feed_id must be a 32-byte hex string (64 hex chars, optionally 0x-prefixed)' },
      { status: 400 },
    )
  }

  if (isNaN(windowHours) || windowHours < 1 || windowHours > 8760) {
    return NextResponse.json(
      { error: 'window_hours must be between 1 and 8760' },
      { status: 400 },
    )
  }

  if (isNaN(tickSpacing) || tickSpacing < 1 || tickSpacing > 200) {
    return NextResponse.json(
      { error: 'tick_spacing must be between 1 and 200' },
      { status: 400 },
    )
  }

  try {
    const metrics = await computeVolatilityMetrics(feedId, windowHours, tickSpacing)

    return NextResponse.json(metrics, {
      status: 200,
      headers: {
        // Cache at CDN for 5 min, allow stale for another 5 min while revalidating
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // Insufficient data / no_data from Pyth — not a server error
    if (message.includes('insufficient data') || message.includes('no candle data')) {
      return NextResponse.json({ error: message }, { status: 422 })
    }

    console.error('[volatility] computeVolatilityMetrics error:', message)
    return NextResponse.json({ error: 'Failed to compute volatility metrics' }, { status: 500 })
  }
}
