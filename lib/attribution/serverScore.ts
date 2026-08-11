// =============================================================================
// Attribution Engine v2 — server-side canonical score (in-process, no HTTP hop).
//
// The server twin of `GET /api/attribution/score-v2?legacy=1`. Runs the exact
// same engine + providers (Etherscan backbone → referral Network → sanctions/
// Nansen Risk) and returns the legacy `/score` shape, so server callers —
// OG image, EAS attestation, campaign-credit score, vault snapshot — read the
// SAME number the UI shows. Pass `supabase` to enable referral-DB Network
// enrichment; omit it for pure on-chain reads.
//
// ⚠ Single-wallet use. The Etherscan provider fans out 6 chains × 2 calls per
// wallet; batch/cron loops over many wallets must add throttling before using
// this (Etherscan free tier ≈ 5 req/sec) — they intentionally stay on the
// external worker until a rate-limited batch reader lands.
// =============================================================================

import { resolveWalletActivity } from './provider'
import { computeScore } from './score'
import { toLegacyScore, type LegacyScore } from './legacyShape'
import { buildReferralFetcher } from './providers/referrals'
import { buildSanctionsFetcher } from './providers/chainalysis'
import { buildNansenRiskFetcher } from './providers/nansen'

type SupabaseArg = Parameters<typeof buildReferralFetcher>[0]

/**
 * Canonical Attribution score for one wallet, in the legacy `/score` response
 * shape. Never throws for provider failures — `resolveWalletActivity` degrades
 * to zerion/mock internally and enrichment is best-effort.
 */
export async function getServerLegacyScore(
  address: string,
  opts: { supabase?: SupabaseArg } = {},
): Promise<LegacyScore & { source: string }> {
  const now = Date.now()
  const { activity, source } = await resolveWalletActivity(address, now, {
    referralFetcher: opts.supabase ? buildReferralFetcher(opts.supabase) : undefined,
    sanctionsFetcher: buildSanctionsFetcher(),
    riskFetcher: buildNansenRiskFetcher(),
  })
  const result = computeScore(activity, now)
  return { ...toLegacyScore(result, activity, now), source }
}
