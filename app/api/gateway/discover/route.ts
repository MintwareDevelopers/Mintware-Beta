import { createHandler } from '@/lib/web2/routeHandler'
import { fetchHotPools, type PoolCandidate } from '@/lib/gateway/discovery'
import { gatewayConfig } from '@/lib/gateway/chain'

export const dynamic = 'force-dynamic'

// Public read for the Discover surface: the hottest Robinhood-Chain pools that pass our criteria
// (v4 + USDG-quoted, not ineligible), live from GeckoTerminal + our risk score. Marks which are already
// live-depositable (a deployed gateway exists) vs still curating. Cached ~3 min to respect GT rate limits.
// Honest: metrics are real (TVL / 24h vol / activity); no APY/guaranteed framing. Deposits gate to live pools.

const TTL_MS = 3 * 60_000
let cache: { at: number; pools: PoolCandidate[] } | null = null

export const GET = createHandler(async (_req, ctx) => {
  const cfg = gatewayConfig()

  if (!cache || Date.now() - cache.at > TTL_MS) {
    const pools = await fetchHotPools({ log: ctx.log })
    cache = { at: Date.now(), pools }
  }
  const eligible = cache.pools.filter((p) => p.verdict !== 'ineligible' && p.poolAddress)

  // which of these are already live (a deployed gateway instance exists)?
  let liveSet = new Set<string>()
  if (cfg?.chainId) {
    const { data } = await ctx.supabase
      .from('gateway_instances')
      .select('pool_address')
      .eq('chain_id', cfg.chainId)
    liveSet = new Set((data ?? []).map((r: { pool_address: string }) => String(r.pool_address).toLowerCase()))
  }

  const pools = eligible
    .map((p) => ({
      poolAddress: p.poolAddress,
      pairLabel: p.pairLabel,
      tvlUsd: p.tvlUsd,
      vol24Usd: p.vol24Usd,
      volTvlRatio: p.signals.volTvlRatio,
      priceQuotePerBase: p.priceQuotePerBase,
      poolAgeDays: p.signals.poolAgeDays,
      txCount24: p.signals.txCount24,
      riskScore: p.score,
      reasons: p.reasons,
      baseSymbol: p.baseSymbol,
      quoteSymbol: p.quoteSymbol,
      baseLogo: p.baseLogo,
      quoteLogo: p.quoteLogo,
      feePct: p.feePct,
      estFeeAprPct: p.estFeeAprPct,
      live: liveSet.has(p.poolAddress),
    }))
    .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.vol24Usd - a.vol24Usd)

  return ctx.json({ success: true, pools, cachedAt: cache.at })
})
