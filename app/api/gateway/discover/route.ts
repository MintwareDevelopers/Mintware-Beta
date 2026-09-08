import { createHandler } from '@/lib/web2/routeHandler'
import { fetchHotPools, type PoolCandidate } from '@/lib/gateway/discovery'
import { gatewayConfig } from '@/lib/gateway/chain'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// Public read for the Discover surface: the hottest Robinhood-Chain pools that pass our criteria
// (v4 + USDG-quoted by ADDRESS, not ineligible), live from GeckoTerminal + our risk score. Marks which are
// already live-depositable (an ACTIVE gateway instance exists) vs still curating. Cached ~3 min to respect
// GT rate limits; concurrent refreshes coalesce into one upstream read.
// Honest: metrics are real (TVL / 24h vol / activity); no APY/guaranteed framing. Deposits gate to live pools.
// Fail-closed (O-7): with `LP_GATEWAY_USDG` unset the quote asset is unknown → every pool is ineligible
// → the feed is EMPTY and `usdgConfigured:false` says why. Set the env; never match by name.

const TTL_MS = 3 * 60_000
let cache: { at: number; pools: PoolCandidate[] } | null = null
let refreshing: Promise<PoolCandidate[]> | null = null

/** Per-IP floor (O-8): the page needs one call per visit; 30 burst then 30/min is generous. */
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })

export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)

  const cfg = gatewayConfig()
  const usdgConfigured = /^0x[0-9a-fA-F]{40}$/.test(process.env.LP_GATEWAY_USDG ?? '')

  if (!cache || Date.now() - cache.at > TTL_MS) {
    if (!refreshing) {
      refreshing = fetchHotPools({ log: ctx.log })
        .then((pools) => {
          cache = { at: Date.now(), pools }
          return pools
        })
        .finally(() => { refreshing = null })
    }
    await refreshing
  }
  const snapshot = cache ?? { at: Date.now(), pools: [] }
  const eligible = snapshot.pools.filter((p) => p.verdict !== 'ineligible' && p.poolAddress)

  // which of these are already live (an ACTIVE deployed gateway instance exists — HO-11)?
  let liveSet = new Set<string>()
  if (cfg?.chainId) {
    const { data } = await ctx.supabase
      .from('gateway_instances')
      .select('pool_address')
      .eq('chain_id', cfg.chainId)
      .eq('status', 'active')
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

  return ctx.json({ success: true, pools, cachedAt: snapshot.at, usdgConfigured })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
