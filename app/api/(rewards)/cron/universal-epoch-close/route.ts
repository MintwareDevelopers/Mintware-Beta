import { createHandler } from '@/lib/web2/routeHandler'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createHandler(async (_req, ctx) => {
  ctx.log.info('universal-epoch-close', 'Settlement started')
  const result = await settleUniversalEpochs()
  ctx.log.info('universal-epoch-close', 'Settlement complete', result as unknown as Record<string, unknown>)
  return ctx.json({ ok: true, ...result })
}, { auth: 'bearer-token' })
