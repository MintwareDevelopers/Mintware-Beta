// OPTIONAL trust-tiered x402 pricing (P4) — map a payer TRUST percentile onto a spend policy: rate limit,
// price multiplier, and how conservatively to size the facilitator's hold. The percentile can come from ANY
// signal — parked size, deposit tenure, staking, or (optionally) an Attribution score; it is NOT required.
// With no trust source the facilitator authorizes purely on NAV and none of this applies. Pure functions.
// Spec: docs/developers/agentkit-compute-402-spec.md §7.

export type TrustTier = 'unknown' | 'standard' | 'trusted'

export interface SpendPolicy {
  tier: TrustTier
  /** Requests/min the seller/facilitator will serve this payer. */
  rateLimitPerMin: number
  /** Multiplier on the seller's base price (>1 = surcharge for unproven payers). */
  priceMultiplier: number
  /** Fraction (0..1) of fee-net NAV headroom the facilitator will authorize as a hold. */
  navHeadroomFraction: number
}

/** Percentile in [0,100] → tier. Mirrors the rewards multiplier buckets. */
export function tierForPercentile(percentile: number): TrustTier {
  const p = Number.isFinite(percentile) ? Math.max(0, Math.min(100, percentile)) : 0
  if (p >= 67) return 'trusted'
  if (p >= 34) return 'standard'
  return 'unknown'
}

const POLICIES: Record<TrustTier, Omit<SpendPolicy, 'tier'>> = {
  // Unproven: tight rate, small surcharge, conservative hold.
  unknown: { rateLimitPerMin: 10, priceMultiplier: 1.1, navHeadroomFraction: 0.25 },
  standard: { rateLimitPerMin: 60, priceMultiplier: 1.0, navHeadroomFraction: 0.5 },
  // Proven: high rate, a discount, full headroom.
  trusted: { rateLimitPerMin: 300, priceMultiplier: 0.9, navHeadroomFraction: 1.0 },
}

/** Resolve the full policy for a payer at a given Attribution percentile. */
export function policyForPercentile(percentile: number): SpendPolicy {
  const tier = tierForPercentile(percentile)
  return { tier, ...POLICIES[tier] }
}

/** Apply the tier's multiplier to a base atomic price, rounding UP (seller never underprices). */
export function pricedForTier(baseAtomic: bigint, policy: SpendPolicy): bigint {
  // multiplier is one of {0.9,1.0,1.1} → scale by /10 to stay in integer math.
  const numer = BigInt(Math.round(policy.priceMultiplier * 10))
  const scaled = baseAtomic * numer
  // ceil-divide by 10
  return (scaled + 9n) / 10n
}
