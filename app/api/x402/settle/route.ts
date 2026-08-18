// POST /api/x402/settle — the x402 facilitator SETTLE endpoint (relayer submit).
// Body: { paymentRequirements, paymentPayload, holdId? }. Spec: agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator } from '@/lib/x402/config'
import type { PaymentRequirements, PaymentPayload } from '@/lib/x402/types'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  const f = getFacilitator()
  if (!f) return ctx.json({ success: false, errorReason: 'facilitator_unconfigured' }, 503)

  let body: { paymentRequirements?: PaymentRequirements; paymentPayload?: PaymentPayload; holdId?: string }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ success: false, errorReason: 'invalid_json' }, 400)
  }
  if (!body.paymentRequirements || !body.paymentPayload) {
    return ctx.json({ success: false, errorReason: 'missing_fields' }, 400)
  }

  const result = await f.settle(body.paymentRequirements, body.paymentPayload, body.holdId)
  return ctx.json(result)
})
