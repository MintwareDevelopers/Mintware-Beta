import { createHandler } from '@/lib/web2/routeHandler'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createHandler(async (req, ctx) => {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 25)

  ctx.log.info('universal-distribution-bridge', 'Bridge started', { limit })
  const result = await bridgeUniversalEpochsToDistributor(limit)
  ctx.log.info('universal-distribution-bridge', 'Bridge complete', result as Record<string, unknown>)

  return ctx.json({ ok: true, ...result })
}, { auth: 'bearer-token' })
