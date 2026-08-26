// POST /api/x402/scores — BATCH Attribution score lookup sold over x402. Body: { addresses: string[] }.
// The agent-native "reputation-gate a whole set of counterparties in one paid call" primitive. Priced at
// (unique address count × per-score price), so N lookups = N × $0.01. Mirrors the single-score seller
// (GET /api/x402/score): unpaid → 402 PAYMENT-REQUIRED; paid + verified → all scores; settle best-effort.
// The price is derived server-side from the (de-duped) body, and the facilitator enforces the paid amount
// equals it — so an underpayment for a larger set is rejected. Spec: docs/developers/agentkit-compute-402-spec.md.

import { createHandler } from '@/lib/web2/routeHandler'
import { require402, readPaymentSignature } from '@/lib/x402/require402'
import { getFacilitator, defaultPayTo, supportedNetworks, USDC_BY_NETWORK } from '@/lib/x402/config'
import { getServerLegacyScore } from '@/lib/attribution/serverScore'

export const dynamic = 'force-dynamic'

const EVM_RE = /^0x[0-9a-fA-F]{40}$/
const MAX_BATCH = 50

export const POST = createHandler(async (req, ctx) => {
  let body: { addresses?: unknown }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'invalid_json' }, 400)
  }

  const raw = Array.isArray(body?.addresses) ? body.addresses : null
  if (!raw || raw.length === 0) return ctx.json({ error: 'addresses[] required' }, 400)
  if (raw.length > MAX_BATCH) return ctx.json({ error: `too_many_addresses`, max: MAX_BATCH }, 400)

  const addresses = raw.map((a) => String(a).toLowerCase())
  if (!addresses.every((a) => EVM_RE.test(a))) {
    return ctx.json({ error: 'every entry must be a valid 0x EVM address' }, 400)
  }
  // Price + serve on UNIQUE addresses (an agent paying twice for the same lookup gets it once).
  const unique = [...new Set(addresses)]

  const facilitator = getFacilitator()
  const payTo = defaultPayTo()
  const networks = supportedNetworks()
  if (!facilitator || !payTo || networks.length === 0) {
    return ctx.json({ error: 'x402_seller_unconfigured', detail: 'set EDGE_AUTH_URL/SECRET + X402_PAY_TO' }, 503)
  }
  const network = networks[0]

  // Total price = per-score base × unique count (atomic USDC, 6dp). Derived server-side from the body.
  const base = BigInt(process.env.X402_SCORE_PRICE_ATOMIC ?? '10000')
  const priceAtomic = (base * BigInt(unique.length)).toString()

  const decision = await require402(
    readPaymentSignature(req),
    {
      priceAtomic,
      asset: USDC_BY_NETWORK[network],
      payTo,
      resource: `${new URL(req.url).origin}/api/x402/scores#${unique.length}`,
      network,
      scheme: 'exact',
      nonce: crypto.randomUUID(),
      now: Math.floor(Date.now() / 1000),
      description: `Mintware Attribution batch score (${unique.length} addresses)`,
    },
    facilitator,
  )

  if (!decision.paid) {
    const res = ctx.json(decision.body, decision.status)
    for (const [k, v] of Object.entries(decision.headers)) res.headers.set(k, v)
    return res
  }

  // Paid + verified. Serve every score; a per-address failure is isolated, never fails the batch.
  const scores = await Promise.all(
    unique.map(async (address) => {
      try {
        return { address, score: await getServerLegacyScore(address) }
      } catch (e) {
        return { address, error: e instanceof Error ? e.message : String(e) }
      }
    }),
  )

  facilitator
    .settle(decision.requirements, decision.payload, decision.holdId)
    .catch((e) => ctx.log.warn('x402', 'batch settle failed (deferred)', { err: String(e) }))

  return ctx.json({
    paid: true,
    payer: decision.payer,
    holdId: decision.holdId,
    count: unique.length,
    priceAtomic,
    scores,
  })
})
