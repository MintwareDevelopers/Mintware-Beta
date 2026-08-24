// POST /api/x402/settle — the x402 facilitator SETTLE endpoint (relayer submit).
// Body: { paymentRequirements, paymentPayload, holdId? }. Spec: agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator, x402PermitGateway } from '@/lib/x402/config'
import { getStandingPermit } from '@/lib/x402/permitStore'
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

  // Source the payer's standing DelegatedSpendPermit (the card-permit pattern extended to x402): an
  // agent registers it ONCE via POST /api/x402/permit, and every settle looks it up by (payer, gateway)
  // and threads it into the relayer's SettleParams.permit. A caller-supplied `permit` (rare) still wins.
  let permit = body.permit
  const payer = body.paymentPayload.payload?.authorization?.from
  if (!permit && payer) {
    const gateway = x402PermitGateway()
    if (gateway) permit = (await getStandingPermit(ctx.supabase, payer, gateway)) ?? undefined
  }

  // Fail closed: with a relayer configured, settle would submit on-chain — refuse clearly rather than
  // hand the relayer a body the Gateway rejects (or fabricate a signature). When no relayer is set the
  // facilitator's deferredSettler handles it (deploy-gating unchanged), so only short-circuit here.
  if (!permit && process.env.X402_RELAYER_URL) {
    return ctx.json({ success: false, errorReason: 'no_standing_permit' }, 402)
  }

  const result = await f.settle(body.paymentRequirements, body.paymentPayload, body.holdId, permit, body.edge)
  return ctx.json(result)
})
