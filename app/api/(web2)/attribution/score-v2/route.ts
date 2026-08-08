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
import { getWalletActivity } from '@/lib/attribution/mockProvider'

export const dynamic = 'force-dynamic'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const address = new URL(req.url).searchParams.get('address')?.trim()
  if (!address) {
    return ctx.json({ success: false, error: 'address query param required', code: 'missing_address' }, 400)
  }
  // Accept the golden-wallet aliases (0xLP, 0xFARM, …) in preview so the engine
  // is demonstrable before the live data layer lands; real addresses must be well-formed.
  const isGolden = address.toLowerCase().startsWith('0x') && address.length < 42
  if (!isGolden && !ADDR_RE.test(address)) {
    return ctx.json({ success: false, error: 'invalid address', code: 'bad_address' }, 400)
  }

  const activity = await getWalletActivity(address)
  const result = computeScore(activity, Date.now())
  ctx.log.info('attribution', 'scored wallet', { address, score: result.score, tier: result.tier })
  return ctx.json(result)
})
