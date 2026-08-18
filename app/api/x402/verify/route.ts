// POST /api/x402/verify — the x402 facilitator VERIFY endpoint, backed by YPN (edge-auth NAV hold).
// Body: { paymentRequirements, paymentPayload }. Spec: docs/developers/agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator } from '@/lib/x402/config'
import type { PaymentRequirements, PaymentPayload } from '@/lib/x402/types'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  const f = getFacilitator()
  if (!f) return ctx.json({ isValid: false, invalidReason: 'facilitator_unconfigured' }, 503)

  let body: { paymentRequirements?: PaymentRequirements; paymentPayload?: PaymentPayload }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ isValid: false, invalidReason: 'invalid_json' }, 400)
  }
  if (!body.paymentRequirements || !body.paymentPayload) {
    return ctx.json({ isValid: false, invalidReason: 'missing_fields' }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const result = await f.verify(body.paymentRequirements, body.paymentPayload, now)
  return ctx.json(result)
})
