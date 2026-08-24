// POST /api/x402/settle — the x402 facilitator SETTLE endpoint (relayer submit).
// Body: { paymentRequirements, paymentPayload, holdId? }. Spec: agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator } from '@/lib/x402/config'
import type { RelayerPermit, RelayerEdgeAuth } from '@/lib/x402/facilitator'
import type { PaymentRequirements, PaymentPayload } from '@/lib/x402/types'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  const f = getFacilitator()
  if (!f) return ctx.json({ success: false, errorReason: 'facilitator_unconfigured' }, 503)

  let body: {
    paymentRequirements?: PaymentRequirements
    paymentPayload?: PaymentPayload
    holdId?: string
    // Optional: a caller that holds the payer's Gateway DelegatedSpendPermit (+ edge auth for >= $250)
    // supplies it here so the relayer can build `settleSpend`. The pure x402 payload does not carry it
    // (EIP-3009 auth, not a DelegatedSpendPermit) — see the TODO in `lib/x402/edgeHttp.ts#httpSettler`.
    permit?: RelayerPermit
    edge?: RelayerEdgeAuth
  }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ success: false, errorReason: 'invalid_json' }, 400)
  }
  if (!body.paymentRequirements || !body.paymentPayload) {
    return ctx.json({ success: false, errorReason: 'missing_fields' }, 400)
  }

  const result = await f.settle(body.paymentRequirements, body.paymentPayload, body.holdId, body.permit, body.edge)
  return ctx.json(result)
})
