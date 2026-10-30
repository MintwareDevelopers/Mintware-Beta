import { createHandler } from '@/lib/web2/routeHandler'
import { fetchHotPools, discoverUsdgEnv, type PoolCandidate } from '@/lib/gateway/discovery'
import { marketEngineConfig } from '@/lib/gateway/marketEngine'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// Public read for the Discover surface: the hottest Robinhood-Chain pools that pass our criteria
// (v4 + USDG-quoted by ADDRESS, not ineligible), live from GeckoTerminal + our risk score. Marks which are
// already live-depositable (an ACTIVE gateway instance exists) vs still curating. Cached ~3 min to respect
// GT rate limits; concurrent refreshes coalesce into one upstream read. A failed/empty upstream read keeps the
// last good feed and retries in 30 s. Sub-$10k TVL and wash-traded pools are hidden unless live.
// Honest: metrics are real (TVL / 24h vol / activity); no APY/guaranteed framing. Deposits gate to live pools.
// Fail-closed (O-7): with `LP_GATEWAY_DISCOVER_USDG`/`LP_GATEWAY_USDG` unset the quote asset is unknown →
// every pool is ineligible → the feed is EMPTY and `usdgConfigured:false` says why. Set the env; never
// match by name. `LP_GATEWAY_DISCOVER_USDG` is Discover's OWN address (falls back to `LP_GATEWAY_USDG`) —
// separate from registry's `LP_GATEWAY_USDG` (which must match whatever the DEPLOYED rig actually uses
// on-chain, today the testnet mock tUSDG) because the browse feed reads real MAINNET GeckoTerminal data.

const TTL_MS = 3 * 60_000
/** An empty upstream read is retried after 30 s and never replaces a good snapshot (keep the last good feed). */
const EMPTY_RETRY_MS = 30_000
/** Display floor for the browse feed: below this TVL, or with turnover this extreme, a pool is noise or wash
 *  trading, not a market worth showing. Live pools always show. */
const MIN_TVL_USD = 10_000
const MAX_VOL_TVL = 200
let cache: { at: number; pools: PoolCandidate[] } | null = null
let refreshing: Promise<PoolCandidate[]> | null = null

/** Per-IP floor (O-8): the page needs one call per visit; 30 burst then 30/min is generous. */
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })

export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)

  const cfg = marketEngineConfig()
  const usdgConfigured = /^0x[0-9a-fA-F]{40}$/.test(discoverUsdgEnv() ?? '')

  if (!cache || Date.now() - cache.at > TTL_MS) {
    if (!refreshing) {
      refreshing = fetchHotPools({ log: ctx.log })
        .then((pools) => {
          if (pools.length) cache = { at: Date.now(), pools }
          else cache = { at: Date.now() - TTL_MS + EMPTY_RETRY_MS, pools: cache?.pools ?? [] }
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
      .not('market_engine_address', 'is', null)
      .not('engine_verified_at', 'is', null)
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
    .filter((p) => p.live || (p.tvlUsd >= MIN_TVL_USD && (p.volTvlRatio ?? 0) <= MAX_VOL_TVL))
    .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.vol24Usd - a.vol24Usd)

  return ctx.json({ success: true, pools, cachedAt: snapshot.at, usdgConfigured })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
