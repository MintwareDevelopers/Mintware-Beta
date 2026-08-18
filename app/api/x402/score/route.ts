// GET /api/x402/score?address=0x… — the P1 DOGFOOD SELLER: a Mintware Attribution score lookup sold over
// x402. Unpaid → 402 PAYMENT-REQUIRED. Paid + verified (NAV hold) → the real per-wallet score (6-chain
// compute), with settlement kicked best-effort (deferred scheme tolerates async). This is Mintware being an
// x402 SELLER of its own compute, on its own rail. Spec: docs/developers/agentkit-compute-402-spec.md §3C.

import { createHandler } from '@/lib/web2/routeHandler'
import { require402, readPaymentSignature } from '@/lib/x402/require402'
import { getFacilitator, defaultPayTo, supportedNetworks, USDC_BY_NETWORK } from '@/lib/x402/config'
import { getServerLegacyScore } from '@/lib/attribution/serverScore'

export const dynamic = 'force-dynamic'

const EVM_RE = /^0x[0-9a-fA-F]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')
  if (!address || !EVM_RE.test(address)) return ctx.json({ error: 'valid ?address= required' }, 400)

  const facilitator = getFacilitator()
  const payTo = defaultPayTo()
  const networks = supportedNetworks()
  if (!facilitator || !payTo || networks.length === 0) {
    return ctx.json({ error: 'x402_seller_unconfigured', detail: 'set EDGE_AUTH_URL/SECRET + X402_PAY_TO' }, 503)
  }
  const network = networks[0]

  const decision = await require402(
    readPaymentSignature(req),
    {
      priceAtomic: process.env.X402_SCORE_PRICE_ATOMIC ?? '10000', // $0.01 (6dp)
      asset: USDC_BY_NETWORK[network],
      payTo,
      resource: `${url.origin}/api/x402/score?address=${address.toLowerCase()}`,
      network,
      scheme: 'exact',
      nonce: crypto.randomUUID(),
      now: Math.floor(Date.now() / 1000),
      description: 'Mintware Attribution score lookup',
    },
    facilitator,
  )

  if (!decision.paid) {
    const res = ctx.json(decision.body, decision.status)
    for (const [k, v] of Object.entries(decision.headers)) res.headers.set(k, v)
    return res
  }

  // Paid + verified (hold placed). Serve the resource, then settle best-effort (deferred-friendly).
  const score = await getServerLegacyScore(address)
  facilitator
    .settle(decision.requirements, decision.payload, decision.holdId)
    .catch((e) => ctx.log.warn('x402', 'settle failed (deferred)', { err: String(e) }))

  return ctx.json({ paid: true, payer: decision.payer, holdId: decision.holdId, address, score })
})
