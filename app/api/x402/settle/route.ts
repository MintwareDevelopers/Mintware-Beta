// POST /api/x402/settle — x402 DIRECT facilitator settlement endpoint.
import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator } from '@/lib/x402/config'
import type { PaymentRequirements, PaymentPayload } from '@/lib/x402/types'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  const facilitator = getFacilitator()
  if (!facilitator) return ctx.json({ success: false, errorReason: 'direct_facilitator_unconfigured' }, 503)
  let body: { paymentRequirements?: PaymentRequirements; paymentPayload?: PaymentPayload }
  try { body = await req.json() }
  catch { return ctx.json({ success: false, errorReason: 'invalid_json' }, 400) }
  if (!body.paymentRequirements || !body.paymentPayload) {
    return ctx.json({ success: false, errorReason: 'missing_fields' }, 400)
  }
  return ctx.json(await facilitator.settle(body.paymentRequirements, body.paymentPayload))
}, { auth: 'none' })
