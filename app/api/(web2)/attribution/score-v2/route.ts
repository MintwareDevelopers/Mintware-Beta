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
import { debugZerionChart } from '@/lib/attribution/providers/zerion'

export const dynamic = 'force-dynamic'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')?.trim()
  if (!address) {
    return ctx.json({ success: false, error: 'address query param required', code: 'missing_address' }, 400)
  }
  // Temporary probe: /score-v2?address=0x…&debug=chart → raw Zerion chart result.
  if (url.searchParams.get('debug') === 'chart' && ADDR_RE.test(address)) {
    return ctx.json({ chartDebug: await debugZerionChart(address) })
  }
  // Accept the golden-wallet aliases (0xLP, 0xFARM, …) in preview so the engine
  // is demonstrable before the live data layer lands; real addresses must be well-formed.
  const isGolden = address.toLowerCase().startsWith('0x') && address.length < 42
  if (!isGolden && !ADDR_RE.test(address)) {
    return ctx.json({ success: false, error: 'invalid address', code: 'bad_address' }, 400)
  }

  const { activity, source, degraded } = await resolveWalletActivity(address, Date.now(), {
    referralFetcher: buildReferralFetcher(ctx.supabase),
    sanctionsFetcher: buildSanctionsFetcher(),
  })
  const result = computeScore(activity, Date.now())
  // Diagnostics — safe (never exposes the key, only whether one is present).
  // `zerionKeyPresent:false` = env var not reaching this runtime; true + source
  // 'mock' + a fallbackReason = key is present but the Zerion call failed.
  const diagnostics = {
    zerionKeyPresent: Boolean(process.env.ZERION_API_KEY),
    fallbackReason: degraded ?? null,
    firstSeenMs: activity.firstSeenMs, // 0 = age lookup failed; a real ts = chart worked
    txCount: activity.totalTxCount,
  }
  ctx.log.info('attribution', 'scored wallet', { address, score: result.score, tier: result.tier, source, degraded })
  return ctx.json({ ...result, source, diagnostics })
})
