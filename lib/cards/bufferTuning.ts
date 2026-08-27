// Adaptive buffer-sizing inputs from a member's real spend history — the spend agent's safety-stock
// tuning job (docs/developers/card-spend-buffer-spec.md §5.3). Pure, integer/bigint.
//
// The sizing math (bufferSizing.ts) needs two inputs it can't invent: the mean spend over one refill
// lead time (μ_L) and the volatility of spend (σ) over a measurement period. This module derives both
// from the member's settled swipes, so the buffer converges toward each user's ACTUAL newsvendor-
// optimal size instead of a static one-size default. The agent applies these gradually
// (`blendToward`, an EMA), so a single unusual week doesn't whipsaw the target.

const BPS = 10_000

/** Integer square root of a bigint (Newton's method) — for the σ = √variance step in bigint space. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt of negative')
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

export interface DemandSwipe {
  amountAtomic: bigint
  atSecs: number
}

export interface DemandStatsParams {
  /** Settled, approved swipes for this card/member (any order). */
  swipes: DemandSwipe[]
  nowSecs: number
  /** How far back to look (e.g. 30 days of seconds). */
  observationWindowSecs: number
  /** The period σ is measured over (matches card_spend_buffers.sigma_period_secs, e.g. 1 day). */
  sigmaPeriodSecs: number
  /** The refill lead time μ_L is scaled to (matches lead_time_secs). */
  leadTimeSecs: number
}

export interface DemandStats {
  /** Expected spend during ONE refill lead time = spend-rate × T. Atomic USDC. */
  meanLeadtimeAtomic: bigint
  /** Stdev of per-period spend (population), over sigmaPeriodSecs. Atomic USDC. */
  demandStdevAtomic: bigint
  /** How many swipes fell in the window (a caller gates on a minimum before applying). */
  sampleCount: number
  /** Number of σ-periods the window spanned (zero-spend periods included). */
  periods: number
}

/**
 * Derive (μ_L, σ) from spend history. μ_L is the spend RATE over the observed span × the lead time.
 * σ buckets spend into `sigmaPeriodSecs` periods — INCLUDING zero-spend periods, which is what makes a
 * bursty spender show high variance and a steady one show low — and takes the population stdev.
 */
export function computeDemandStats(p: DemandStatsParams): DemandStats {
  const start = p.nowSecs - p.observationWindowSecs
  const inWin = p.swipes.filter((s) => s.atSecs >= start && s.atSecs <= p.nowSecs && s.amountAtomic > 0n)
  if (inWin.length === 0) return { meanLeadtimeAtomic: 0n, demandStdevAtomic: 0n, sampleCount: 0, periods: 0 }

  const earliest = inWin.reduce((m, s) => (s.atSecs < m ? s.atSecs : m), p.nowSecs)
  // Rate denominator: the ACTUAL observed span, floored at one σ-period (so a brand-new account with a
  // day of history isn't diluted by the full 30-day window) and capped at the window.
  const observedSpan = Math.max(p.sigmaPeriodSecs, Math.min(p.observationWindowSecs, p.nowSecs - earliest))
  const total = inWin.reduce((a, s) => a + s.amountAtomic, 0n)

  const meanLeadtimeAtomic = (total * BigInt(Math.round(p.leadTimeSecs))) / BigInt(Math.round(observedSpan))

  const periods = Math.max(1, Math.ceil(observedSpan / p.sigmaPeriodSecs))
  const buckets = new Array<bigint>(periods).fill(0n)
  const windowStart = p.nowSecs - observedSpan
  for (const s of inWin) {
    let idx = Math.floor((s.atSecs - windowStart) / p.sigmaPeriodSecs)
    if (idx < 0) idx = 0
    if (idx >= periods) idx = periods - 1
    buckets[idx] += s.amountAtomic
  }
  const meanPerPeriod = total / BigInt(periods)
  let ssd = 0n
  for (const b of buckets) {
    const d = b - meanPerPeriod
    ssd += d * d
  }
  const variance = ssd / BigInt(periods)
  const demandStdevAtomic = isqrt(variance)

  return { meanLeadtimeAtomic, demandStdevAtomic, sampleCount: inWin.length, periods }
}

/**
 * Exponential-moving-average blend of an existing sizing input toward a freshly-measured one, at rate
 * `alphaBps` (e.g. 3000 = 30% of the way each tuning pass). The first measurement (existing 0) is taken
 * whole. This is what "converges toward the actual" (§5.3) means — no single window jerks the target.
 */
export function blendToward(existing: bigint, measured: bigint, alphaBps: number): bigint {
  const a = BigInt(Math.max(0, Math.min(BPS, Math.round(alphaBps))))
  if (existing <= 0n) return measured < 0n ? 0n : measured
  const num = measured * a + existing * (BigInt(BPS) - a)
  return (num + BigInt(BPS) / 2n) / BigInt(BPS) // round to nearest
}
