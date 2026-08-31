// Card spend-buffer sizing — newsvendor + safety-stock math. Pure functions, integer/bigint money.
// Spec: docs/developers/card-spend-buffer-spec.md §3.
//
// A card issuer only ever sees the flat spend buffer, never the vault behind it (§1). So the buffer
// must be sized to cover spend over one refill LEAD TIME with a target service level — a classic
// safety-stock / newsvendor problem (the same math ATM cash-loading uses). This mirrors the SHAPE of
// the edge-auth VaR haircut (services/edge-auth/src/haircut.rs::var_haircut_bps): integer config in,
// f64 statistics computed OFF the hot path, result back to integer atomic USDC — but it rounds UP,
// the inverse of the haircut's floor, because a safety stock must never UNDER-provision (an
// under-sized buffer is a declined swipe).
//
// Two framings of one number (§3), unified here: the newsvendor optimal order-up-to quantile is the
// critical ratio Cu/(Cu+Co); for a normal demand distribution its inverse-CDF gives the same z the
// safety-stock formula z·σ·√T uses. So `serviceLevel` and the newsvendor `criticalRatio` are the same
// knob expressed two ways — pick whichever the caller can reason about.

const BPS = 10_000

/** Inputs to a buffer-target computation. All amounts are atomic USDC (6dp). */
export interface BufferSizingParams {
  /** Expected spend during ONE refill lead time — the newsvendor mean μ_L. Atomic USDC. */
  meanDemandLeadTimeAtomic: bigint
  /** Stdev of spend measured over `sigmaPeriodSecs` — the demand volatility σ. Atomic USDC. */
  demandStdevAtomic: bigint
  /** The period (secs) over which `demandStdevAtomic` was measured; σ is per this period. */
  sigmaPeriodSecs: number
  /**
   * Refill lead time T (secs): detect-drain → redeem-vault-slice → fresh-balance-in. Per §3 the
   * single biggest lever on buffer size — measure it worst-case, not best-case, once a rail is live.
   */
  leadTimeSecs: number
  /** Target service level in bps (e.g. `9500` = 95% no-decline, `9900` = 99%). Drives z. */
  serviceLevelBps: number
  /** Floor — never size a usable buffer below this. Atomic USDC. Default 0. */
  minBufferAtomic?: bigint
  /** Ceiling — never park more than this outside vault protection (§3 Co cost). Atomic USDC. */
  maxBufferAtomic?: bigint
}

/** Cost inputs for the newsvendor critical ratio (§3). Relative units — only the ratio matters. */
export interface NewsvendorCosts {
  /** Cu — cost of running out (a declined swipe: trust/UX cost). */
  underageCost: number
  /** Co — cost of overstock (buffer sitting outside tranche protection). */
  overageCost: number
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n)

/**
 * Inverse standard-normal CDF (probit) via Acklam's rational approximation — |error| < 1.15e-9 over
 * the full open interval. Turns a probability into the z-score the sizing formulas need. Input p is
 * clamped into (0,1) so the result is always finite.
 */
export function probit(p: number): number {
  const pp = clamp(p, 1e-12, 1 - 1e-12)
  // Coefficients (Acklam 2003).
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  const phigh = 1 - plow
  let q: number, r: number
  if (pp < plow) {
    q = Math.sqrt(-2 * Math.log(pp))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (pp <= phigh) {
    q = pp - 0.5
    r = q * q
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  q = Math.sqrt(-2 * Math.log(1 - pp))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

/**
 * z-score × 1000 (integer, mirrors `HaircutParams.z_score_milli`) for a target service level in bps.
 * 9500 → ~1645 (1.645, 95%), 9900 → ~2326 (2.326, 99%). Negative z (service level < 50%) clamps to 0
 * — a buffer never sizes BELOW its mean-demand base.
 */
export function zMilliForServiceLevel(serviceLevelBps: number): number {
  const p = clamp(serviceLevelBps, 1, BPS - 1) / BPS
  const z = probit(p)
  return z <= 0 ? 0 : Math.round(z * 1000)
}

/** Newsvendor critical ratio Cu/(Cu+Co) in bps — the optimal no-stockout service level (§3). */
export function newsvendorCriticalRatioBps({ underageCost, overageCost }: NewsvendorCosts): number {
  const cu = Math.max(0, underageCost)
  const co = Math.max(0, overageCost)
  if (cu + co === 0) return 0
  return Math.round((cu / (cu + co)) * BPS)
}

/** Convert a set of newsvendor costs directly into the service-level bps the sizers consume. */
export function serviceLevelForCostsBps(costs: NewsvendorCosts): number {
  return newsvendorCriticalRatioBps(costs)
}

/** ceil( atomic × factor ), factor ≥ 0, done in scaled integer so the round is exact and always UP. */
function ceilScale(atomic: bigint, factor: number): bigint {
  if (atomic <= 0n || factor <= 0) return 0n
  const SCALE = 1_000_000n
  const f = BigInt(Math.round(factor * 1e6)) // factor × 1e6, ≥ 0
  const num = atomic * f
  return (num + SCALE - 1n) / SCALE // ceil-divide
}

/**
 * Safety stock = z · σ · √(T / period), in atomic USDC, rounded UP. This is the variable cushion on
 * top of expected lead-time demand — the part that absorbs spend variance so the buffer isn't caught
 * empty by the next swipe. σ is rescaled from its measurement period to the lead-time horizon by
 * √(T/period) (variance adds linearly in time).
 */
export function safetyStockAtomic(p: BufferSizingParams): bigint {
  if (p.sigmaPeriodSecs <= 0 || p.leadTimeSecs <= 0 || p.demandStdevAtomic <= 0n) return 0n
  const zMilli = zMilliForServiceLevel(p.serviceLevelBps)
  if (zMilli <= 0) return 0n
  const z = zMilli / 1000
  const horizonScale = Math.sqrt(p.leadTimeSecs / p.sigmaPeriodSecs)
  return ceilScale(p.demandStdevAtomic, z * horizonScale)
}

/**
 * Full buffer target = mean lead-time demand (μ_L) + safety stock, clamped to [min, max], atomic
 * USDC, rounded UP. This is the "keep $X ready to spend" number the refill loop tops the buffer back
 * up to. The max clamp is the §3 Co guard — the protocol cap on how much sits outside vault
 * protection. `minBufferAtomic` wins over `maxBufferAtomic` if they cross (a usable floor is
 * non-negotiable), so pass a coherent pair.
 */
export function bufferTargetAtomic(p: BufferSizingParams): bigint {
  const base = p.meanDemandLeadTimeAtomic > 0n ? p.meanDemandLeadTimeAtomic : 0n
  let target = base + safetyStockAtomic(p)
  if (p.maxBufferAtomic !== undefined && target > p.maxBufferAtomic) target = p.maxBufferAtomic
  const min = p.minBufferAtomic ?? 0n
  if (target < min) target = min
  return target
}

/** Defensible starting profiles (§3): a low-variance "coffee" spender vs a bursty "business" one.
 *  These are DEFAULTS to seed a new card from before real spend history exists — the spend agent
 *  (spec §5.3) is meant to converge these toward each user's measured distribution over time. */
export const BUFFER_PROFILE_DEFAULTS = {
  coffee: { serviceLevelBps: 9500, sigmaPeriodSecs: 86_400 },
  business: { serviceLevelBps: 9900, sigmaPeriodSecs: 86_400 },
} as const
