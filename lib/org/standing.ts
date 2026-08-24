// In-product "Standing" — the active-use benefit whose MARKETING already shipped (constants/cards-
// landing.ts → CARDS_STANDING) but whose LOGIC lives here. Standing is a tier derived PURELY from a
// wallet's own settled card purchases — nothing to deposit, hold, or stake, and every perk is a
// SERVICE improvement (faster/roomier spend), never a payout, token, or return.
//
// NON-NEGOTIABLE (mirrors the shipped copy's guardrails, and lib/x402/no-attribution-in-spend.test.ts):
//   • Earned ONLY by real, settled card spend (decision='approved' AND settled=true). Nothing else.
//   • Completely SEPARATE from the Attribution/reputation score. This file imports NO attribution
//     module and reads no score — standing is spend history, full stop. A tier only ever WIDENS a
//     limit within an existing HARD cap; an unknown/missing tier is always the most conservative
//     (`none`) = today's exact behavior. A tier can never bypass a money-path guard.
//
// Computed ON-READ from card_swipe_events (no new table; a cache column is out of scope). Pure
// functions + a thin data loader; the loader fails safe to `none` on any error.

import { withinDailyCapValue } from '@/lib/org/rolePresets'
import type { getServiceClient } from '@/lib/web2/supabase'

type SupabaseClient = ReturnType<typeof getServiceClient>

export type StandingTier = 'none' | 'active' | 'established' | 'trusted'

export interface Standing {
  tier: StandingTier
  /** Count of the wallet's own settled purchases (approved + settled). */
  settledCount: number
  /** Distinct UTC calendar days on which the wallet settled a purchase (sustained-ness). */
  distinctDays: number
  /** Days between the first and last settled purchase (track-record length). */
  spanDays: number
  firstAt: string | null
  lastAt: string | null
}

/** Shape of a card_swipe_events row this module reads. Deliberately minimal — no score, no wallet
 *  identity beyond what's needed to count settled spend. */
export interface SettledEventLike {
  decision: string | null
  settled: boolean | null
  created_at: string
}

// ─── Tier thresholds (named constants — match the shipped copy's unlock language) ────────────────
// "a handful of real purchases" → Active
export const ACTIVE_MIN_SETTLED = 3
// "sustained spend over time" → Established
export const ESTABLISHED_MIN_SETTLED = 6
export const ESTABLISHED_MIN_DISTINCT_DAYS = 4
export const ESTABLISHED_MIN_SPAN_DAYS = 21
// "a long, consistent track record" → Trusted
export const TRUSTED_MIN_SETTLED = 15
export const TRUSTED_MIN_DISTINCT_DAYS = 10
export const TRUSTED_MIN_SPAN_DAYS = 90

export const NONE_STANDING: Standing = {
  tier: 'none', settledCount: 0, distinctDays: 0, spanDays: 0, firstAt: null, lastAt: null,
}

const MS_PER_DAY = 86_400_000

/** A settled purchase = APPROVED and SETTLED on-chain. Declined events and approved-but-unsettled
 *  holds do NOT count — standing is settled spend only. */
function isSettledPurchase(e: SettledEventLike): boolean {
  return e.decision === 'approved' && e.settled === true
}

/** Pure: derive a wallet's standing from its OWN settled card purchases. Spend-only — this function
 *  never reads a reputation/Attribution score. Ignores any non-settled event. */
export function computeStanding(events: readonly SettledEventLike[]): Standing {
  const settled = (events ?? []).filter(isSettledPurchase)
  if (settled.length === 0) return NONE_STANDING

  const times = settled
    .map((e) => Date.parse(e.created_at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  if (times.length === 0) return NONE_STANDING

  const settledCount = times.length
  const dayKeys = new Set(times.map((t) => Math.floor(t / MS_PER_DAY)))
  const distinctDays = dayKeys.size
  const firstMs = times[0]
  const lastMs = times[times.length - 1]
  const spanDays = Math.floor((lastMs - firstMs) / MS_PER_DAY)

  const tier = tierFor({ settledCount, distinctDays, spanDays })
  return {
    tier,
    settledCount,
    distinctDays,
    spanDays,
    firstAt: new Date(firstMs).toISOString(),
    lastAt: new Date(lastMs).toISOString(),
  }
}

/** Pure tier ladder — highest tier whose count + sustained-ness + track-record all clear. */
export function tierFor(m: { settledCount: number; distinctDays: number; spanDays: number }): StandingTier {
  const { settledCount, distinctDays, spanDays } = m
  if (
    settledCount >= TRUSTED_MIN_SETTLED &&
    distinctDays >= TRUSTED_MIN_DISTINCT_DAYS &&
    spanDays >= TRUSTED_MIN_SPAN_DAYS
  ) {
    return 'trusted'
  }
  if (
    settledCount >= ESTABLISHED_MIN_SETTLED &&
    distinctDays >= ESTABLISHED_MIN_DISTINCT_DAYS &&
    spanDays >= ESTABLISHED_MIN_SPAN_DAYS
  ) {
    return 'established'
  }
  if (settledCount >= ACTIVE_MIN_SETTLED) return 'active'
  return 'none'
}

/** Thin data loader — reads the wallet's OWN settled-spend history and computes standing on-read.
 *  Fails SAFE: any query error, missing data, or unexpected shape resolves to `none` (today's exact
 *  behavior), never a higher tier. `wallet` is lowercased to match how member_wallet is stored. */
export async function getStandingForWallet(
  supabase: SupabaseClient,
  wallet: string,
  orgId?: string,
): Promise<Standing> {
  try {
    let q = supabase
      .from('card_swipe_events')
      .select('decision, settled, created_at')
      .eq('member_wallet', wallet.toLowerCase())
    if (orgId) q = q.eq('org_id', orgId)
    const { data, error } = await q
    if (error || !Array.isArray(data)) return NONE_STANDING
    return computeStanding(data as SettledEventLike[])
  } catch {
    return NONE_STANDING
  }
}

// ─── Perk #1: higher daily limit (Trusted) — widen the role daily cap, CLAMPED to a hard ceiling ──
//
// A tier only ever RAISES the role's daily cap, and only up to an absolute hard ceiling. It can never
// remove the cap (null stays null only for an already-uncapped owner) and never turn a receive-only
// (0n) role into a spender. `none`/`active`/`established` multiply by 1.0 → unchanged. Provably
// widen-only: the result is max(baseCap, min(raised, HARD_CEILING)) ≥ baseCap, ≤ HARD_CEILING.

/** Absolute maximum daily card spend cap. A tier can raise a role cap up to — never past — this. */
export const CARD_HARD_DAILY_CAP_CEILING_USDC = 50_000_000_000n // $50,000/day (6dp)

/** Per-tier multiplier on the role daily cap. Only Trusted widens (matches the copy: Trusted =
 *  "a higher daily limit"). Everything below Trusted is exactly today's cap. */
export const STANDING_DAILY_CAP_MULTIPLIER: Record<StandingTier, number> = {
  none: 1,
  active: 1,
  established: 1,
  trusted: 1.5,
}

/** Effective daily cap for a role cap under a standing tier — widen-only, hard-clamped.
 *  - null cap (owner) → null (already uncapped; tier is irrelevant, never introduces a cap).
 *  - 0n cap (vendor/receive-only) → 0n (NEVER widened into a spender).
 *  - else → max(baseCap, min(baseCap × multiplier, HARD_CEILING)). */
export function effectiveDailyCap(baseCap: bigint | null, tier: StandingTier): bigint | null {
  if (baseCap === null) return null
  if (baseCap === 0n) return 0n
  const mult = STANDING_DAILY_CAP_MULTIPLIER[tier] ?? 1
  const raised = (baseCap * BigInt(Math.round(mult * 1000))) / 1000n
  const clampedToCeiling = raised > CARD_HARD_DAILY_CAP_CEILING_USDC ? CARD_HARD_DAILY_CAP_CEILING_USDC : raised
  // widen-only backstop: never below the base cap, whatever the multiplier/ceiling interplay.
  return clampedToCeiling < baseCap ? baseCap : clampedToCeiling
}

/** Convenience: is a proposed spend within the tier-adjusted daily cap? Delegates to the same
 *  withinDailyCapValue guard the role layer uses, so the belt semantics are identical. */
export function withinStandingDailyCap(
  baseCap: bigint | null,
  tier: StandingTier,
  amount: bigint,
  spentToday: bigint = 0n,
): boolean {
  return withinDailyCapValue(effectiveDailyCap(baseCap, tier), amount, spentToday)
}

// ─── Perk #2: more headroom (Established) — widen a SOFT per-swipe ceiling within the HARD ceiling ─
//
// The hard per-swipe ceiling is the $250 settle-time limit (CARD_HIGH_VALUE_THRESHOLD in
// settleSwipe.ts) — above it, settlement needs an edge-signed leg that isn't wired, so it is an
// absolute wall for BOTH paths. This perk lets a higher tier spend MORE of that ceiling per swipe
// (the copy: Established = "more of your balance, available") — but only ever UP TO the hard ceiling,
// never past it, and never around the edge-auth NAV/equity guard (which still runs regardless).
//
// FAIL-SAFE / base-unchanged: the soft ceiling is DISABLED by default (baseFraction >= 1 → returns
// null → no soft cap at all → today's exact authorize behavior for every tier). It only engages when
// an operator opts into a conservative floor (baseFraction < 1), the same off-by-default-lever idiom
// used across this repo (cf. X402_TRUST_TIERING). When engaged, `none` gets the conservative floor and
// higher tiers widen toward the hard ceiling — never beyond it.

/** MUST equal CARD_HIGH_VALUE_THRESHOLD in lib/org/settleSwipe.ts ($250, 6dp). Re-declared here to
 *  keep this module pure (no viem/supabase import graph); a test asserts the two stay equal. */
export const CARD_HARD_PER_SWIPE_CEILING_USDC = 250_000_000n

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(1, n))
}

/** Per-tier headroom fraction of the HARD per-swipe ceiling. `baseFraction` is the floor applied to
 *  the lowest tiers; Established sits halfway between the floor and full; Trusted gets the full
 *  ceiling. Always in [0,1], so the resulting soft ceiling can never exceed the hard ceiling. */
export function headroomFractionForTier(tier: StandingTier, baseFraction: number): number {
  const bf = clamp01(baseFraction)
  const ladder: Record<StandingTier, number> = {
    none: bf,
    active: bf,
    established: (bf + 1) / 2,
    trusted: 1,
  }
  return Math.min(1, ladder[tier] ?? bf)
}

/** Soft per-swipe ceiling (atomic USDC) for a tier, or null when the lever is disabled.
 *  - baseFraction >= 1 (default) → null → NO soft cap → today's exact behavior. FAIL-SAFE.
 *  - baseFraction < 1 → hardCeiling × headroomFractionForTier(tier), always <= hardCeiling. */
export function softHeadroomCeiling(
  tier: StandingTier,
  hardCeiling: bigint = CARD_HARD_PER_SWIPE_CEILING_USDC,
  baseFraction: number = configuredHeadroomBaseFraction(),
): bigint | null {
  if (!(baseFraction < 1)) return null
  const frac = headroomFractionForTier(tier, baseFraction)
  const ceiling = (hardCeiling * BigInt(Math.round(frac * 1000))) / 1000n
  // widen-only backstop: never exceed the hard ceiling, whatever rounding did.
  return ceiling > hardCeiling ? hardCeiling : ceiling
}

/** Reads the optional conservative floor from env. Default '1' → lever OFF → today's behavior.
 *  A value in [0,1) turns the soft ceiling on (base tier most conservative, tiers widen up). */
export function configuredHeadroomBaseFraction(): number {
  const raw = process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
  if (raw === undefined || raw === '') return 1
  const n = Number(raw)
  return Number.isFinite(n) ? n : 1
}
