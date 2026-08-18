import { describe, it, expect } from 'vitest'
import { require402, readPaymentSignature, Require402Config } from './require402'
import { encodePaymentPayload, decodePaymentRequired } from './protocol'
import { Facilitator } from './facilitator'
import { PaymentPayload } from './types'

const NOW = 1_800_000_000
const PAYER = '0x1111111111111111111111111111111111111111'
const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x3600000000000000000000000000000000000000'

const cfg: Require402Config = {
  priceAtomic: '1000000', asset: USDC, payTo: PAYTO, resource: 'https://mintware.finance/score',
  network: 'base', nonce: 'n1', now: NOW, description: 'Attribution score lookup',
}

function payload(value = '1000000'): PaymentPayload {
  return {
    x402Version: 2, scheme: 'exact', network: 'base',
    payload: { signature: '0xsig', authorization: { from: PAYER, to: PAYTO, value, validAfter: String(NOW - 10), validBefore: String(NOW + 300), nonce: '0xdead' } },
  }
}

const okFacilitator: Facilitator = {
  verify: async () => ({ isValid: true, payer: PAYER, holdId: 'hold-1', maxSettleable: '1000000' }),
  settle: async () => ({ success: true, txHash: '0xabc' }),
  supported: async () => ({ schemes: ['exact', 'deferred'], networks: ['base'] }),
}
const rejectFacilitator: Facilitator = {
  ...okFacilitator,
  verify: async () => ({ isValid: false, invalidReason: 'insufficient_equity' }),
}

describe('require402 (seller gate)', () => {
  it('challenges an unpaid request with 402 + a decodable PAYMENT-REQUIRED', async () => {
    const out = await require402(null, cfg, okFacilitator)
    expect(out.paid).toBe(false)
    if (out.paid) return
    expect(out.status).toBe(402)
    const dec = decodePaymentRequired(out.headers['PAYMENT-REQUIRED'])
    expect(dec.accepts[0]).toMatchObject({ payTo: PAYTO, maxAmountRequired: '1000000', network: 'base', asset: USDC })
    expect(out.body.accepts[0].nonce).toBe('n1')
  })

  it('serves a valid paid request (paid:true with payer + holdId + requirements)', async () => {
    const out = await require402(encodePaymentPayload(payload()), cfg, okFacilitator)
    expect(out.paid).toBe(true)
    if (!out.paid) return
    expect(out.payer).toBe(PAYER)
    expect(out.holdId).toBe('hold-1')
    expect(out.requirements.payTo).toBe(PAYTO)
  })

  it('re-challenges (402) when the facilitator rejects, surfacing the reason', async () => {
    const out = await require402(encodePaymentPayload(payload()), cfg, rejectFacilitator)
    expect(out.paid).toBe(false)
    if (out.paid) return
    expect(out.body.error).toBe('insufficient_equity')
  })

  it('re-challenges on a malformed PAYMENT-SIGNATURE header', async () => {
    const out = await require402('!!!not-base64-json!!!', cfg, okFacilitator)
    expect(out.paid).toBe(false)
    if (out.paid) return
    expect(out.body.error).toBe('malformed_payment_signature')
  })

  it('readPaymentSignature reads either header casing', () => {
    const h1 = new Headers({ 'payment-signature': 'abc' })
    const h2 = new Headers({ 'PAYMENT-SIGNATURE': 'def' })
    expect(readPaymentSignature({ headers: h1 })).toBe('abc')
    expect(readPaymentSignature({ headers: h2 })).toBe('def')
    expect(readPaymentSignature({ headers: new Headers() })).toBeNull()
  })
})
