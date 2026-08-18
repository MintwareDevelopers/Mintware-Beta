import { describe, it, expect } from 'vitest'
import { YpnFacilitator, EdgeAuthorizer, Settler, TrustSource } from './facilitator'
import { buildRequirements } from './protocol'
import { PaymentPayload, PaymentRequirements } from './types'

const NOW = 1_800_000_000
const PAYER = '0x1111111111111111111111111111111111111111'
const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x3600000000000000000000000000000000000000'

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return { ...buildRequirements({ priceAtomic: '1000000', asset: USDC, payTo: PAYTO, resource: 'r', network: 'base', nonce: 'n1', now: NOW }), ...over }
}
function payload(value = '1000000'): PaymentPayload {
  return {
    x402Version: 2, scheme: 'exact', network: 'base',
    payload: { signature: '0xsig', authorization: { from: PAYER, to: PAYTO, value, validAfter: String(NOW - 10), validBefore: String(NOW + 300), nonce: '0xdead' } },
  }
}

const approveEdge = (holdAtomic = '1000000'): EdgeAuthorizer => ({
  authorize: async () => ({ approved: true, holdId: 'hold-1', holdAtomic }),
})
const declineEdge: EdgeAuthorizer = { authorize: async () => ({ approved: false, reason: 'insufficient_equity' }) }
const okSettler: Settler = { settle: async () => ({ success: true, txHash: '0xabc' }) }
const failSettler: Settler = { settle: async () => ({ success: false, errorReason: 'reverted' }) }

describe('YpnFacilitator.verify', () => {
  it('places a hold and returns valid when edge approves', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: okSettler, supportedNetworks: ['base'] })
    const v = await f.verify(reqs(), payload(), NOW)
    expect(v).toMatchObject({ isValid: true, payer: PAYER, holdId: 'hold-1', maxSettleable: '1000000' })
  })

  it('fails structural pre-filter before ever calling edge', async () => {
    let called = false
    const edge: EdgeAuthorizer = { authorize: async () => { called = true; return { approved: true } } }
    const f = new YpnFacilitator({ edge, settler: okSettler, supportedNetworks: ['base'] })
    const v = await f.verify(reqs(), payload('9999999'), NOW) // over max
    expect(v).toMatchObject({ isValid: false, invalidReason: 'amount_exceeds_max' })
    expect(called).toBe(false)
  })

  it('rejects an unsupported network', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: okSettler, supportedNetworks: ['arc'] })
    const v = await f.verify(reqs(), payload(), NOW)
    expect(v).toMatchObject({ isValid: false, invalidReason: 'unsupported_network' })
  })

  it('surfaces an edge decline (insufficient equity)', async () => {
    const f = new YpnFacilitator({ edge: declineEdge, settler: okSettler, supportedNetworks: ['base'] })
    const v = await f.verify(reqs(), payload(), NOW)
    expect(v).toMatchObject({ isValid: false, invalidReason: 'insufficient_equity', payer: PAYER })
  })

  it('authorizes purely on NAV when no trust source is configured (Attribution not required)', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: okSettler, supportedNetworks: ['base'] })
    const v = await f.verify(reqs(), payload('1000000'), NOW)
    expect(v.isValid).toBe(true) // no trust gating at all
  })

  it('OPTIONAL trust-gate: a trusted payer passes, an unknown payer over its headroom is capped', async () => {
    const trusted: TrustSource = { percentileOf: async () => 90 } // headroom 1.0
    const unknown: TrustSource = { percentileOf: async () => 5 } // headroom 0.25
    const base = { edge: approveEdge(), settler: okSettler, supportedNetworks: ['base'] }

    const okv = await new YpnFacilitator({ ...base, trust: trusted }).verify(reqs(), payload('1000000'), NOW)
    expect(okv.isValid).toBe(true)

    const capped = await new YpnFacilitator({ ...base, trust: unknown }).verify(reqs(), payload('1000000'), NOW)
    expect(capped).toMatchObject({ isValid: false, invalidReason: 'exceeds_trust_cap', maxSettleable: '250000' })
  })
})

describe('YpnFacilitator.settle / supported', () => {
  it('settles via the relayer and tags the network', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: okSettler, supportedNetworks: ['base'] })
    expect(await f.settle(reqs(), payload(), 'hold-1')).toMatchObject({ success: true, txHash: '0xabc', network: 'base' })
  })
  it('propagates a settle failure', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: failSettler, supportedNetworks: ['base'] })
    expect(await f.settle(reqs(), payload(), 'hold-1')).toMatchObject({ success: false, errorReason: 'reverted' })
  })
  it('advertises schemes + configured networks', async () => {
    const f = new YpnFacilitator({ edge: approveEdge(), settler: okSettler, supportedNetworks: ['base', 'arc'] })
    expect(await f.supported()).toEqual({ schemes: ['exact', 'deferred'], networks: ['base', 'arc'] })
  })
})
