import { describe, it, expect } from 'vitest'
// End-to-end: the REAL modules composed — seller gate (require402) + YPN facilitator (verify=hold,
// settle=relayer) — driven through the full unpaid → 402 → pay → verify → serve → settle flow with mock
// edge/settler transports. Proves the pieces fit, not just each in isolation.
import { require402, Require402Config } from './require402'
import { YpnFacilitator, EdgeAuthorizer, Settler } from './facilitator'
import { encodePaymentPayload } from './protocol'
import { PaymentPayload } from './types'

const NOW = 1_800_000_000
const PAYER = '0x1111111111111111111111111111111111111111'
const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x3600000000000000000000000000000000000000'

const cfg: Require402Config = {
  priceAtomic: '10000', asset: USDC, payTo: PAYTO, resource: 'https://mintware.finance/api/x402/score',
  network: 'base', scheme: 'exact', nonce: 'fixed-nonce-1', now: NOW,
}

// A hold-tracking edge + a settle that only succeeds for a held id — so settle truly depends on verify.
function stackedFacilitator() {
  const holds = new Set<string>()
  const edge: EdgeAuthorizer = {
    authorize: async ({ ref, amountAtomic }) => {
      holds.add(ref)
      return { approved: true, holdId: ref, holdAtomic: amountAtomic }
    },
  }
  const settler: Settler = {
    settle: async ({ holdId }) =>
      holdId && holds.has(holdId)
        ? { success: true, txHash: '0xsettled' }
        : { success: false, errorReason: 'no_such_hold' },
  }
  return new YpnFacilitator({ edge, settler, supportedNetworks: ['base'] })
}

function payloadFor(value = '10000'): PaymentPayload {
  return {
    x402Version: 2, scheme: 'exact', network: 'base',
    payload: { signature: '0xsig', authorization: { from: PAYER, to: PAYTO, value, validAfter: String(NOW - 10), validBefore: String(NOW + 300), nonce: '0xdead' } },
  }
}

describe('x402 end-to-end seller flow', () => {
  it('unpaid → 402 → pay → verify(hold) → serve → settle(on-chain)', async () => {
    const facilitator = stackedFacilitator()

    // 1) unpaid request → 402 challenge with a decodable requirement.
    const challenge = await require402(null, cfg, facilitator)
    expect(challenge.paid).toBe(false)
    if (challenge.paid) return
    expect(challenge.body.accepts[0].maxAmountRequired).toBe('10000')

    // 2) client pays → require402 verifies (places a hold) → seller may serve.
    const decision = await require402(encodePaymentPayload(payloadFor()), cfg, facilitator)
    expect(decision.paid).toBe(true)
    if (!decision.paid) return
    expect(decision.payer).toBe(PAYER)
    expect(decision.holdId).toBe('fixed-nonce-1')

    // 3) seller settles the held payment on-chain — succeeds ONLY because verify placed the hold.
    const settled = await facilitator.settle(decision.requirements, decision.payload, decision.holdId)
    expect(settled).toMatchObject({ success: true, txHash: '0xsettled', network: 'base' })
  })

  it('a settle without a prior verify hold fails (no free serve)', async () => {
    const facilitator = stackedFacilitator()
    const res = await facilitator.settle({ ...cfg, maxAmountRequired: cfg.priceAtomic } as never, payloadFor(), 'never-held')
    expect(res).toMatchObject({ success: false, errorReason: 'no_such_hold' })
  })

  it('overpriced payload is rejected at the gate (re-challenged), no hold placed', async () => {
    const facilitator = stackedFacilitator()
    const decision = await require402(encodePaymentPayload(payloadFor('999999')), cfg, facilitator)
    expect(decision.paid).toBe(false)
    if (decision.paid) return
    expect(decision.body.error).toBe('amount_exceeds_max')
  })
})
