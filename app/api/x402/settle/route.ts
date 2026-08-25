// POST /api/x402/settle — the x402 facilitator SETTLE endpoint (relayer submit).
// Body: { paymentRequirements, paymentPayload, holdId? }. Spec: agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator, x402PermitGateway, x402OnchainSettleConfigured } from '@/lib/x402/config'
import { getStandingPermit } from '@/lib/x402/permitStore'
import { verifyEip3009Authorization } from '@/lib/x402/verifyAuthorization'
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

  // Fail closed: with a real settle transport wired (the Rust relayer OR the in-process oracle/Privy
  // settler), settle would submit on-chain — refuse clearly rather than hand it a body the Gateway rejects
  // (or fabricate a signature). When neither is set the facilitator's deferredSettler handles it
  // (deploy-gating unchanged), so only short-circuit here.
  if (!permit && x402OnchainSettleConfigured()) {
    return ctx.json({ success: false, errorReason: 'no_standing_permit' }, 402)
  }

  // H-2 fix — bind the spend to the payer's per-payment authorization. The standing permit is ONLY the
  // daily-cap gate; it binds neither receiver nor amount, and settle is unauthenticated. So whenever we're
  // on the real settle path (a permit present ⇒ the relayer will submit `settleSpend`), we REQUIRE a
  // cryptographically-valid EIP-3009 `TransferWithAuthorization` from the payer, and require its
  // from/to/value to equal the user/receiver/assets the relayer would settle:
  //   from  == user == permit.user   (settleSpend burns from permit.user)
  //   to    == receiver == paymentRequirements.payTo
  //   value == assets                (the amount the relayer settles = the signed amount)
  // Any missing/invalid signature or any mismatch ⇒ refuse (fail closed). Without a permit there is no
  // relayer submission (deferredSettler / no_standing_permit above), so the deploy-gated behavior is
  // preserved and this gate only runs where funds could actually move.
  if (permit) {
    const reqs = body.paymentRequirements
    const auth = body.paymentPayload.payload?.authorization
    const signature = body.paymentPayload.payload?.signature
    if (!auth || !signature) {
      return ctx.json({ success: false, errorReason: 'settlement_authorization_missing' }, 402)
    }

    const from = String(auth.from ?? '').toLowerCase()
    const to = String(auth.to ?? '').toLowerCase()
    const payTo = String(reqs.payTo ?? '').toLowerCase()
    const permitUser = String(permit.user ?? '').toLowerCase()

    if (!from || from !== permitUser) {
      return ctx.json({ success: false, errorReason: 'authorization_payer_mismatch' }, 402)
    }
    if (!to || !payTo || to !== payTo) {
      return ctx.json({ success: false, errorReason: 'authorization_recipient_mismatch' }, 402)
    }

    // value == assets. `assets` is exactly `auth.value` in the relayer body (edgeHttp.httpSettler:
    // `assets = auth?.value ?? reqs.maxAmountRequired`), so this checks the settled amount is the signed
    // amount and, defensively, does not exceed what the requirement advertised.
    let signedValue: bigint
    try {
      signedValue = BigInt(auth.value)
    } catch {
      return ctx.json({ success: false, errorReason: 'authorization_unparseable_amount' }, 402)
    }
    if (signedValue <= 0n) {
      return ctx.json({ success: false, errorReason: 'authorization_non_positive_amount' }, 402)
    }
    try {
      if (reqs.maxAmountRequired != null && signedValue > BigInt(reqs.maxAmountRequired)) {
        return ctx.json({ success: false, errorReason: 'authorization_amount_exceeds_max' }, 402)
      }
    } catch {
      /* maxAmountRequired absent/unparseable — the signature + to/from bindings still gate the spend. */
    }

    const sigOk = await verifyEip3009Authorization({
      network: reqs.network,
      asset: reqs.asset,
      authorization: auth,
      signature,
    })
    if (!sigOk) {
      return ctx.json({ success: false, errorReason: 'invalid_payment_signature' }, 402)
    }
  }

  const result = await f.settle(body.paymentRequirements, body.paymentPayload, body.holdId, permit, body.edge)
  return ctx.json(result)
})
