// =============================================================================
// GET /api/attribution/score-v2?address=0x…
//
// Serves the Attribution Engine v2 score. In v2.0 it runs the deterministic
// engine over the mock data provider (golden wallets + empty profile for
// everything else) so the new methodology is callable and reviewable TODAY.
//
// Cutover path: swap `getWalletActivity` (mockProvider) for a live GoldRush/
// Alchemy/subgraph adapter — this route and the engine stay byte-for-byte the
// same. The response is the v2 canonical shape; a compat adapter to the legacy
// `/score` fields is added at cutover time.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { computeScore } from '@/lib/attribution/score'
import { resolveWalletActivity } from '@/lib/attribution/provider'
import { buildReferralFetcher } from '@/lib/attribution/providers/referrals'
import { buildSanctionsFetcher } from '@/lib/attribution/providers/chainalysis'
import { buildNansenRiskFetcher } from '@/lib/attribution/providers/nansen'
import { toLegacyScore } from '@/lib/attribution/legacyShape'

export const dynamic = 'force-dynamic'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')?.trim()
  const legacy = url.searchParams.get('legacy') === '1'
  if (!address) {
    return ctx.json({ success: false, error: 'address query param required', code: 'missing_address' }, 400)
  }
  // Accept the golden-wallet aliases (0xLP, 0xFARM, …) in preview so the engine
  // is demonstrable before the live data layer lands; real addresses must be well-formed.
  const isGolden = address.toLowerCase().startsWith('0x') && address.length < 42
  if (!isGolden && !ADDR_RE.test(address)) {
    return ctx.json({ success: false, error: 'invalid address', code: 'bad_address' }, 400)
  }

  const now = Date.now()
  const { activity, source, degraded } = await resolveWalletActivity(address, now, {
    referralFetcher: buildReferralFetcher(ctx.supabase),
    sanctionsFetcher: buildSanctionsFetcher(),
    riskFetcher: buildNansenRiskFetcher(),
  })
  const result = computeScore(activity, now)
  ctx.log.info('attribution', 'scored wallet', { address, score: result.score, tier: result.tier, source, degraded })

  // Legacy-shaped response for the app UI cutover (drop-in for the old worker's
  // `/score`). Everything derived from real data; invented old-worker fields empty.
  if (legacy) {
    return ctx.json({ ...toLegacyScore(result, activity, now), source })
  }

  // Native v2 response + safe diagnostics (never exposes the key).
  const diagnostics = {
    zerionKeyPresent: Boolean(process.env.ZERION_API_KEY),
    fallbackReason: degraded ?? null,
    firstSeenMs: activity.firstSeenMs,
    txCount: activity.totalTxCount,
  }
  return ctx.json({ ...result, source, diagnostics })
})
