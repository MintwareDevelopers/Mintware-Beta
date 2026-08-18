import { describe, it, expect } from 'vitest'
import {
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentPayload,
  decodePaymentPayload,
  buildRequirements,
  checkPayloadAgainst,
} from './protocol'
import { PaymentPayload, PaymentRequirements } from './types'

const NOW = 1_800_000_000
const PAYER = '0x1111111111111111111111111111111111111111'
const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x3600000000000000000000000000000000000000'

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    ...buildRequirements({
      priceAtomic: '1000000', // 1 USDC
      asset: USDC,
      payTo: PAYTO,
      resource: 'https://mintware.finance/score?address=0xabc',
      network: 'base',
      nonce: 'nonce-1',
      now: NOW,
    }),
    ...over,
  }
}

function payload(over: Partial<PaymentPayload['payload']['authorization']> = {}, top: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: '0xsig',
      authorization: {
        from: PAYER,
        to: PAYTO,
        value: '1000000',
        validAfter: String(NOW - 10),
        validBefore: String(NOW + 300),
        nonce: '0xdead',
        ...over,
      },
    },
    ...top,
  }
}

describe('x402 header codecs', () => {
  it('round-trips PAYMENT-REQUIRED through base64', () => {
    const enc = encodePaymentRequired([reqs()], undefined)
    const dec = decodePaymentRequired(enc)
    expect(dec.x402Version).toBe(2)
    expect(dec.accepts[0].payTo).toBe(PAYTO)
    expect(dec.accepts[0].maxAmountRequired).toBe('1000000')
  })

  it('decodePaymentRequired also accepts raw JSON', () => {
    const dec = decodePaymentRequired(JSON.stringify({ x402Version: 2, accepts: [reqs()] }))
    expect(dec.accepts).toHaveLength(1)
  })

  it('rejects a PAYMENT-REQUIRED with no accepts[]', () => {
    expect(() => decodePaymentRequired(JSON.stringify({ x402Version: 2 }))).toThrow()
  })

  it('round-trips PAYMENT-SIGNATURE and rejects malformed', () => {
    const dec = decodePaymentPayload(encodePaymentPayload(payload()))
    expect(dec.payload.authorization.from).toBe(PAYER)
    const bad = Buffer.from(JSON.stringify({ scheme: 'exact' }), 'utf8').toString('base64')
    expect(() => decodePaymentPayload(bad)).toThrow()
  })
})

describe('checkPayloadAgainst', () => {
  it('accepts a well-formed matching payload', () => {
    expect(checkPayloadAgainst(reqs(), payload(), NOW)).toEqual({ ok: true })
  })

  it('rejects scheme / network mismatch', () => {
    expect(checkPayloadAgainst(reqs(), payload({}, { scheme: 'deferred' }), NOW)).toMatchObject({ ok: false, reason: 'scheme_mismatch' })
    expect(checkPayloadAgainst(reqs(), payload({}, { network: 'arc' }), NOW)).toMatchObject({ ok: false, reason: 'network_mismatch' })
  })

  it('rejects wrong recipient', () => {
    expect(checkPayloadAgainst(reqs(), payload({ to: PAYER }), NOW)).toMatchObject({ ok: false, reason: 'wrong_recipient' })
  })

  it('rejects amount over max and non-positive', () => {
    expect(checkPayloadAgainst(reqs(), payload({ value: '2000000' }), NOW)).toMatchObject({ ok: false, reason: 'amount_exceeds_max' })
    expect(checkPayloadAgainst(reqs(), payload({ value: '0' }), NOW)).toMatchObject({ ok: false, reason: 'non_positive_amount' })
  })

  it('allows amount below max (seller may charge less than the ceiling)', () => {
    expect(checkPayloadAgainst(reqs(), payload({ value: '500000' }), NOW)).toEqual({ ok: true })
  })

  it('enforces the requirements + EIP-3009 validity windows', () => {
    expect(checkPayloadAgainst(reqs(), payload(), NOW + 10_000)).toMatchObject({ ok: false, reason: 'requirements_expired' })
    expect(checkPayloadAgainst(reqs({ validUntil: NOW + 10_000 }), payload({ validAfter: String(NOW + 50) }), NOW)).toMatchObject({ ok: false, reason: 'not_yet_valid' })
    expect(checkPayloadAgainst(reqs({ validUntil: NOW + 10_000 }), payload({ validBefore: String(NOW - 1) }), NOW)).toMatchObject({ ok: false, reason: 'authorization_expired' })
  })

  it('is case-insensitive on the recipient', () => {
    expect(checkPayloadAgainst(reqs(), payload({ to: PAYTO.toUpperCase().replace('0X', '0x') }), NOW)).toEqual({ ok: true })
  })
})
