// =============================================================================
// Attribution Engine v2 — referral-DB Network adapter.
//
// Builds the Network signal from OUR OWN Supabase referral data (no external
// key): `referral_records` (referrer → referees + status) joined to
// `wallet_profiles.last_seen_at` for retention. Also computes the referral-tree
// sybil features so a referral FARM both scores low on Network AND takes a
// graded Risk deduction — closing the platform's #1 farming exposure.
//
// referredScore is a PROXY (quality tier from status + recency) until we cache
// each referee's own v2 score; the engine already quality-weights by it, so the
// proxy is a conservative stand-in, not a new axis.
// =============================================================================

import type { Referral, RiskFlag } from '../types'
import { sybilRiskFlag, NO_SYBIL_SIGNAL, type SybilFeatures } from '../sybil'

const DAY_MS = 86_400_000
const RETAINED_WINDOW_DAYS = 45

// Proxy per-referee quality (score-units, 0..925). Replaced by cached per-referee
// scores in v2.1; tuned so a large pending/farm tree contributes near-nothing.
const SCORE_RETAINED = 250 // active + seen recently — a genuinely retained referee
const SCORE_ACTIVE_STALE = 60 // transacted once but went quiet
const SCORE_PENDING = 5 // never activated → dust

export interface ReferralRecordRow { referred?: string | null; status?: string | null }
export interface WalletProfileRow { address?: string | null; last_seen_at?: string | null }

export interface ReferralNetwork {
  referrals: Referral[]
  sybilFeatures: SybilFeatures
}

/** Pure: referral rows + referee profiles → Network `referrals[]` + sybil features. */
export function mapReferralsToNetwork(input: {
  records: ReferralRecordRow[]
  profiles: Map<string, WalletProfileRow>
  nowMs: number
}): ReferralNetwork {
  const { records, profiles, nowMs } = input
  let oneShot = 0

  const referrals: Referral[] = records.map(r => {
    const active = (r.status ?? '') === 'active'
    const p = r.referred ? profiles.get(r.referred.toLowerCase()) : undefined
    const seenMs = p?.last_seen_at ? Date.parse(p.last_seen_at) : NaN
    const recent = !Number.isNaN(seenMs) && nowMs - seenMs < RETAINED_WINDOW_DAYS * DAY_MS
    const retained = active && recent
    if (!retained) oneShot++
    const referredScore = retained ? SCORE_RETAINED : active ? SCORE_ACTIVE_STALE : SCORE_PENDING
    return { referredScore, retained }
  })

  const referralCount = records.length
  const oneShotRefereePct = referralCount ? oneShot / referralCount : 0

  // We compute the tree-shape features we can from referral data alone. The
  // funding-graph / temporal-batch / action-similarity features (which unlock
  // `confirmedRing`) need the on-chain sybil pass — v2.1.
  const sybilFeatures: SybilFeatures = { ...NO_SYBIL_SIGNAL, referralCount, oneShotRefereePct }

  return { referrals, sybilFeatures }
}

export type ReferralFetcher = (
  address: string,
  nowMs: number,
) => Promise<{ referrals: Referral[]; sybilFlag: RiskFlag | null }>

// Minimal Supabase surface we use — kept loose so we don't couple to a generated
// Database type. `ctx.supabase` satisfies this structurally.
interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): PromiseLike<{ data: unknown[] | null }>
      in(col: string, vals: string[]): PromiseLike<{ data: unknown[] | null }>
    }
  }
}

/** Bind a fetcher to a Supabase client for the route to inject into the provider. */
export function buildReferralFetcher(supabase: SupabaseLike): ReferralFetcher {
  return async (address, nowMs) => {
    const addr = address.toLowerCase()
    const recRes = await supabase.from('referral_records').select('referred, status').eq('referrer', addr)
    const records = (recRes.data ?? []) as ReferralRecordRow[]

    const referees = records.map(r => r.referred?.toLowerCase()).filter((x): x is string => Boolean(x))
    let profiles = new Map<string, WalletProfileRow>()
    if (referees.length) {
      const profRes = await supabase.from('wallet_profiles').select('address, last_seen_at').in('address', referees)
      profiles = new Map(
        ((profRes.data ?? []) as WalletProfileRow[])
          .filter(p => p.address)
          .map(p => [p.address!.toLowerCase(), p]),
      )
    }

    const { referrals, sybilFeatures } = mapReferralsToNetwork({ records, profiles, nowMs })
    const { flag } = sybilRiskFlag(sybilFeatures)
    return { referrals, sybilFlag: flag }
  }
}
