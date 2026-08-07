// =============================================================================
// weightedDistribution.ts — reputation + referral weighted two-token allocation
//
// Slice 3 of the oracle migration (docs/developers/oracle-audit-and-hardening-plan.md §6).
// Produces the per-wallet (amount0, amount1) allocation that the oracle signs and
// MintwareWeightedDistributor.closeEpoch verifies. This module owns the WEIGHTING
// FORMULA (the on-chain contract only enforces provenance + no-over-allocation).
//
// Two pots, by design (docs/developers/reward-weighting-decision.md):
//   1. BASE pot  = swap fees. Split pro-rata by liquidity-time × attribution × lock.
//                  Referral is NOT in the base weight, so a referred LP's bonus can
//                  never dilute another LP's fee share.
//   2. MARGIN pot = protocol top-up. Funds two referral bonuses computed off the base:
//        • referee boost   — the referred LP earns REFEREE_BOOST extra on their base.
//        • referrer reward  — the referrer earns REFERRER_RATE of each referred LP's
//                             base earning, scaled linearly by that LP's Attribution
//                             percentile (a score-0 sybil earns its referrer ~nothing).
//   Both bonuses are LIFETIME (paid every epoch the referred LP stays an LP) and
//   DOUBLE-SIDED. `marginRequired` is exactly what the treasury must fund into the
//   epoch — the contract's C5 guard then forces that funding to be real.
//
// Pure + DB-decoupled: inputs are plain values so the economics are unit-testable.
// =============================================================================

import type { LockTier } from '@/lib/web2/vault/types'

// ── Locked parameters (product decision 2026-08-07) ─────────────────────────
/** Referred LP earns +10% on their own base fee earning, from margin. */
export const REFEREE_BOOST = 0.10
/** Referrer earns 20% of each referred LP's base earning, lifetime, from margin. */
export const REFERRER_RATE = 0.20
/**
 * Anti-sybil quality scaling: the referrer's reward for a given referred LP is
 * multiplied by that LP's Attribution percentile / 100 (linear). Percentile 0 →
 * referrer earns nothing for them; percentile 100 → full REFERRER_RATE.
 */
export function referralQualityFactor(refereePercentile: number): number {
  const p = Math.max(0, Math.min(100, refereePercentile))
  return p / 100
}

// ── Weight multipliers (mirror the existing single-token vault processor) ────

const TIER_MULTIPLIER: Record<LockTier, number> = {
  flex:      1.0,
  committed: 1.1,
  aligned:   1.25,
  core:      1.5,
}

export function durationMultiplier(daysHeld: number): number {
  if (daysHeld >= 180) return 1.3
  if (daysHeld >= 90)  return 1.2
  if (daysHeld >= 30)  return 1.1
  return 1.0
}

export function attrMultiplier(percentile: number): number {
  if (percentile >= 67) return 1.5
  if (percentile >= 34) return 1.25
  return 1.0
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeightedLpInput {
  wallet: string          // lowercased address
  liquidityUnits: number  // base liquidity measure (LP shares / V4 liquidity L) — the
                          //   token-agnostic "how much liquidity did you provide"
  lockTier: LockTier
  daysHeld: number
  attrPercentile: number  // 0–100, from Attribution
  referrer?: string       // lowercased wallet that referred this LP, if any
}

export interface TwoTokenAmount { amount0: number; amount1: number }

export interface WeightedEntry {
  wallet: string
  baseWeight: number        // liquidityUnits × duration × attr × lock
  baseShare: number         // baseWeight / Σ baseWeight
  base0: number; base1: number
  refereeBonus0: number; refereeBonus1: number
  referrerReward0: number; referrerReward1: number
  amount0: number; amount1: number   // base + bonuses (what goes in the leaf)
}

export interface WeightedDistributionResult {
  entries: WeightedEntry[]
  feesPot: TwoTokenAmount        // input fee pot (base split source)
  marginRequired: TwoTokenAmount // extra the treasury must fund for referral bonuses
  total: TwoTokenAmount          // Σ amount = feesPot + marginRequired
  totalBaseWeight: number
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute the two-token weighted distribution for one epoch.
 *
 * @param lps      eligible LPs this epoch (zero-liquidity LPs contribute no base weight)
 * @param feesPot  the swap-fee pot to split as the base (token0, token1 nominal units)
 */
export function computeWeightedDistribution(
  lps: WeightedLpInput[],
  feesPot: TwoTokenAmount
): WeightedDistributionResult {
  // 1. Base weights.
  const weights = new Map<string, number>()
  let totalBaseWeight = 0
  for (const lp of lps) {
    const w =
      Math.max(0, lp.liquidityUnits) *
      durationMultiplier(lp.daysHeld) *
      attrMultiplier(lp.attrPercentile) *
      TIER_MULTIPLIER[lp.lockTier]
    weights.set(lp.wallet, w)
    totalBaseWeight += w
  }

  // 2. Base pro-rata split of the fee pot (referral NOT included — non-dilutive).
  const entryMap = new Map<string, WeightedEntry>()
  const base0Of = new Map<string, number>()
  const base1Of = new Map<string, number>()
  for (const lp of lps) {
    const w = weights.get(lp.wallet) ?? 0
    const share = totalBaseWeight > 0 ? w / totalBaseWeight : 0
    const base0 = feesPot.amount0 * share
    const base1 = feesPot.amount1 * share
    base0Of.set(lp.wallet, base0)
    base1Of.set(lp.wallet, base1)
    entryMap.set(lp.wallet, {
      wallet: lp.wallet,
      baseWeight: w,
      baseShare: share,
      base0, base1,
      refereeBonus0: 0, refereeBonus1: 0,
      referrerReward0: 0, referrerReward1: 0,
      amount0: 0, amount1: 0,
    })
  }

  // Percentile lookup for anti-sybil scaling of the referrer reward.
  const pctOf = new Map<string, number>()
  for (const lp of lps) pctOf.set(lp.wallet, lp.attrPercentile)

  // 3. Referral bonuses (margin-funded).
  let marginRequired0 = 0
  let marginRequired1 = 0
  for (const lp of lps) {
    if (!lp.referrer) continue
    const base0 = base0Of.get(lp.wallet) ?? 0
    const base1 = base1Of.get(lp.wallet) ?? 0

    // 3a. Referee boost — the referred LP's own bonus.
    const referee = entryMap.get(lp.wallet)!
    const rb0 = REFEREE_BOOST * base0
    const rb1 = REFEREE_BOOST * base1
    referee.refereeBonus0 += rb0
    referee.refereeBonus1 += rb1
    marginRequired0 += rb0
    marginRequired1 += rb1

    // 3b. Referrer reward — lifetime cut, scaled by the referred LP's Attribution.
    const q = referralQualityFactor(pctOf.get(lp.wallet) ?? 0)
    const rr0 = REFERRER_RATE * base0 * q
    const rr1 = REFERRER_RATE * base1 * q
    if (rr0 > 0 || rr1 > 0) {
      // Referrer may not be an LP this epoch — create a bonus-only entry if needed.
      let referrerEntry = entryMap.get(lp.referrer)
      if (!referrerEntry) {
        referrerEntry = {
          wallet: lp.referrer,
          baseWeight: 0, baseShare: 0,
          base0: 0, base1: 0,
          refereeBonus0: 0, refereeBonus1: 0,
          referrerReward0: 0, referrerReward1: 0,
          amount0: 0, amount1: 0,
        }
        entryMap.set(lp.referrer, referrerEntry)
      }
      referrerEntry.referrerReward0 += rr0
      referrerEntry.referrerReward1 += rr1
      marginRequired0 += rr0
      marginRequired1 += rr1
    }
  }

  // 4. Finalize per-wallet amounts.
  let total0 = 0
  let total1 = 0
  const entries: WeightedEntry[] = []
  for (const e of entryMap.values()) {
    e.amount0 = e.base0 + e.refereeBonus0 + e.referrerReward0
    e.amount1 = e.base1 + e.refereeBonus1 + e.referrerReward1
    total0 += e.amount0
    total1 += e.amount1
    entries.push(e)
  }

  return {
    entries,
    feesPot,
    marginRequired: { amount0: marginRequired0, amount1: marginRequired1 },
    total: { amount0: total0, amount1: total1 },
    totalBaseWeight,
  }
}
