// Concrete TrustSource adapters for the OPTIONAL x402 trust-tiering (facilitator hold sizing). The default
// signal is PARKED SIZE — skin in the game, read straight off the vault — so trust-tiering needs no
// reputation oracle and no Attribution. An Attribution-backed source is provided too, but it is opt-in, not
// a dependency. Spec: docs/developers/agentkit-compute-402-spec.md §7. Pure-ish (readers injected).

import { TrustSource } from './facilitator'
import { ParkedReader } from './treasury'

export interface ParkedTierThresholds {
  /** Parked USDC (atomic) at/above which the payer is "trusted" (percentile 80). */
  trustedAtomic: bigint
  /** Parked USDC (atomic) at/above which the payer is "standard" (percentile 50). */
  standardAtomic: bigint
}

export const DEFAULT_PARKED_THRESHOLDS: ParkedTierThresholds = {
  trustedAtomic: 1_000_000_000n, // $1,000
  standardAtomic: 100_000_000n, //  $100
}

/**
 * Trust from PARKED SIZE — the more an agent has parked (and left earning), the more of its ask the
 * facilitator will authorize up front. No reputation, no Attribution; the signal is the balance itself.
 * Maps to the same 0–33 / 34–66 / 67–100 buckets the pricing module uses.
 */
export function parkedSizeTrustSource(reader: ParkedReader, t: ParkedTierThresholds = DEFAULT_PARKED_THRESHOLDS): TrustSource {
  return {
    async percentileOf(address) {
      let parked: bigint
      try {
        parked = await reader.parkedAtomic(address)
      } catch {
        return 0 // can't read → treat as unknown (most conservative)
      }
      if (parked >= t.trustedAtomic) return 80
      if (parked >= t.standardAtomic) return 50
      return 20
    },
  }
}

/**
 * OPTIONAL Attribution-backed trust — for teams that explicitly want reputation-tiering. NOT the default and
 * NOT required (x402 works with no trust source at all). `fetchPercentile` returns the payer's Attribution
 * percentile in [0,100]; any failure degrades to unknown (0).
 */
export function attributionTrustSource(fetchPercentile: (address: string) => Promise<number>): TrustSource {
  return {
    async percentileOf(address) {
      try {
        const p = await fetchPercentile(address)
        return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0
      } catch {
        return 0
      }
    },
  }
}
