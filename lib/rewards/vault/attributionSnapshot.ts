// =============================================================================
// attributionSnapshot.ts — shared "attribution snapshot" core for vault epoch
// weighting. ONE home for (a) the percentile → multiplier BANDING and (b) a
// fresh per-wallet Attribution percentile read.
//
// Two callers share this, so the logic lives in exactly one place (no drift):
//   • the standalone manual-trigger route GET /api/vault/attribution-snapshot,
//     which oracle-signs an AttributionSnapshot for the FeeVault weighting path;
//   • the SCHEDULED vault-weighted-epoch-close cron, which folds this snapshot
//     inline (fresh, in-process) BEFORE it computes the weighted allocation —
//     so the weighted-epoch reward multipliers are never stale and no extra
//     Vercel-Hobby cron slot is needed.
//
// `getAttributionPercentile` does NOT swallow source errors: it returns the
// percentile (or 0 when the score has no percentile) and otherwise throws, so
// each caller keeps its OWN error posture — the route treats a miss as non-fatal
// (→ 0), while the weighted-epoch closer's C9 guard fail-closes (skips the epoch)
// when any wallet's score is unavailable.
// =============================================================================

import { getServerLegacyScore } from '@/lib/attribution/serverScore'

type ScoreOpts = NonNullable<Parameters<typeof getServerLegacyScore>[1]>

/** Combined (attribution × duration) multiplier ceiling, in bps (1.95×). */
export const COMBINED_MULTIPLIER_CAP_BPS = 19500

/** Attribution percentile → multiplier (bps). 0–33% → 1.0×, 34–66% → 1.25×, 67–100% → 1.5×. */
export function attributionMultiplierBps(percentile: number): number {
  if (percentile >= 67) return 15000
  if (percentile >= 34) return 12500
  return 10000
}

/** Days since deposit → duration multiplier (bps). <30d 1.0×, 30–89d 1.1×, 90–179d 1.2×, ≥180d 1.3×. */
export function durationMultiplierBps(depositedAtIso: string): number {
  const days = (Date.now() - new Date(depositedAtIso).getTime()) / 86_400_000
  if (days >= 180) return 13000
  if (days >= 90)  return 12000
  if (days >= 30)  return 11000
  return 10000
}

/** Combined attribution × duration multiplier (bps), capped at COMBINED_MULTIPLIER_CAP_BPS. */
export function combinedMultiplierBps(attrBps: number, durationBps: number): number {
  return Math.min(Math.round((attrBps * durationBps) / 10000), COMBINED_MULTIPLIER_CAP_BPS)
}

/**
 * Fresh per-wallet Attribution percentile (0–100), read in-process via the
 * canonical Engine-v2 score — the SAME number the UI and the standalone snapshot
 * route show. Pass `{ supabase }` to enable referral-DB Network enrichment.
 *
 * Returns 0 only when the score legitimately has no percentile; it THROWS on a
 * score-source failure so the caller decides whether that is fatal.
 */
export async function getAttributionPercentile(wallet: string, opts: ScoreOpts = {}): Promise<number> {
  const { percentile } = await getServerLegacyScore(wallet.toLowerCase(), opts)
  return percentile ?? 0
}
