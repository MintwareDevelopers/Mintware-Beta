// POST /api/cron/yield-reweight — the live rate-keeper as a running service.
// Auth: Bearer CRON_SECRET.
//
// Turns the tested `lib/yield/rateKeeper` brain into a running loop: read live venue rates (the same
// DefiLlama feed /api/benchmarks/yields serves) → map to the configured child adapters → run
// planSetVenues + shouldReweight → RETURN the plan (adapters + weightsBps + whether a re-weight is
// warranted).
//
// ⚠ DARK / READ-ONLY: this route NEVER submits a tx. Actually calling
// `MintwareMultiVenueYieldAdapter.setVenues(...)` needs a funded keeper key + the deployed adapter,
// both deploy-gated. Until `YIELD_KEEPER_ENABLED` + `YIELD_KEEPER_PRIVATE_KEY` + `YIELD_MULTIVENUE_ADAPTER`
// (+ child adapters via `YIELD_VENUES_JSON`) are all set, `wouldSubmit` is false with a reason; even
// when they ARE set, this PR still returns `submitted:false` (same "dark until configured" posture as
// the x402 routes). It never fails closed into a fake submit. TESTNET/UNAUDITED.

import { createHandler } from '@/lib/web2/routeHandler'
import { getYieldVenues, venueMatchers, keeperConfig, keeperReady } from '@/config/yieldVenues'
import { fetchVenueRates } from '@/lib/yield/rateFeed'
import { planSetVenues, shouldReweight, type VenueConfig } from '@/lib/yield/rateKeeper'
import type { RateRouteOptions } from '@/lib/yield/rateRouter'

export const dynamic = 'force-dynamic'

function routeOptions(env: NodeJS.ProcessEnv): RateRouteOptions {
  const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
  return {
    maxVenueBps: num(env.YIELD_MAX_VENUE_BPS),
    idleBufferBps: num(env.YIELD_IDLE_BUFFER_BPS),
    minVenueApyBps: num(env.YIELD_MIN_APY_BPS),
    topN: num(env.YIELD_TOPN),
  }
}

export const POST = createHandler(async (_req, ctx) => {
  const env = process.env
  const venues = getYieldVenues(env)
  const cfg = keeperConfig(env)

  // 1. Live venue rates (fails soft → empty plan, capital stays put).
  const feed = await fetchVenueRates(venueMatchers(venues))
  if (!feed.ok) {
    ctx.log.warn('yield-reweight', 'live rates unavailable', { error: feed.error })
  }

  // 2. Rank + cap-bounded fill → the setVenues plan (adapters + weightsBps).
  const opts = routeOptions(env)
  const configured: VenueConfig[] = venues
    .filter((v): v is typeof v & { adapter: `0x${string}` } => v.adapter != null)
    .map((v) => ({ key: v.key, adapter: v.adapter, label: v.label }))

  // With no adapters wired yet (testnet default), plan against placeholder addresses so the shape +
  // weights are still visible in the dry-run; these are clearly-marked non-deployed sentinels, never
  // submitted. Once adapters are set via YIELD_VENUES_JSON, the real addresses flow through.
  const planTargets: VenueConfig[] = configured.length
    ? configured
    : venues.map((v, i) => ({ key: v.key, adapter: pseudoAddr(i), label: v.label }))

  const plan = planSetVenues(planTargets, feed.ratesByKey, opts)

  // 3. Drift check vs current on-chain allocation. Reading the live allocation needs the deployed
  // adapter + an RPC (deploy-gated); until then `current` is empty → any non-empty plan reads as a
  // warranted first allocation. This stays honest: we report we can't see current state.
  const current: { adapter: `0x${string}`; weightBps: number }[] = []
  const reweightWarranted = shouldReweight(current, plan, cfg.minDeltaBps)

  const ready = keeperReady(cfg, venues)
  const wouldSubmit = ready && reweightWarranted
  const submitReason = ready
    ? (reweightWarranted ? 'within-drift-threshold: a live keeper would submit (submission deploy-gated in this PR)' : 'no-reweight: drift below threshold')
    : submitBlockedReason(cfg, venues)

  return ctx.json({
    ok: true,
    mode: 'dry-run',
    // ── the plan ──
    plan: {
      adapters: plan.adapters,
      weightsBps: plan.weightsBps,
      totalDeployedBps: plan.weightsBps.reduce((a, b) => a + b, 0),
    },
    reweightWarranted,
    // ── posture ──
    submitted: false, // this route NEVER submits a tx
    wouldSubmit,
    submitReason,
    keeper: { enabled: cfg.enabled, hasKey: cfg.hasKey, adapterWired: !!cfg.multiVenueAdapter, minDeltaBps: cfg.minDeltaBps },
    // ── inputs (for observability) ──
    ratesAvailable: feed.ok,
    ratesAsOf: feed.asOf,
    ratesByKey: feed.ratesByKey,
    adaptersWired: configured.length,
    usingPlaceholderAdapters: configured.length === 0,
    source: feed.source,
  })
}, { auth: 'bearer-token' })

/** Deterministic, clearly-non-deployed sentinel address for dry-run plan shape. Never submitted. */
function pseudoAddr(i: number): `0x${string}` {
  // 0xdead…0000 + index — visually obvious as a placeholder in the dry-run output.
  const tail = i.toString(16).padStart(4, '0')
  return `0xdead${'0'.repeat(32)}${tail}` as `0x${string}`
}

function submitBlockedReason(cfg: ReturnType<typeof keeperConfig>, venues: ReturnType<typeof getYieldVenues>): string {
  const missing: string[] = []
  if (!cfg.enabled) missing.push('YIELD_KEEPER_ENABLED')
  if (!cfg.hasKey) missing.push('YIELD_KEEPER_PRIVATE_KEY')
  if (!cfg.multiVenueAdapter) missing.push('YIELD_MULTIVENUE_ADAPTER')
  if (!venues.some((v) => v.adapter)) missing.push('YIELD_VENUES_JSON (child adapters)')
  return `submit deploy-gated — unset: ${missing.join(', ')}`
}
