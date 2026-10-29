import { describe, expect, it, vi } from 'vitest'

const settle = vi.fn(async () => ({ success: true, txHash: '0xabc', network: 'base-sepolia' }))
vi.mock('@/lib/x402/config', () => ({ getFacilitator: () => ({ settle }) }))
import { POST } from './route'

describe('POST /api/x402/settle', () => {
  it('passes x402 payment to the configured DIRECT facilitator without Gateway permits', async () => {
    const paymentRequirements = { payTo: '0x1111111111111111111111111111111111111111', network: 'base-sepolia', asset: '0x2222222222222222222222222222222222222222' }
    const paymentPayload = { x402Version: 2, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0x', authorization: { from: paymentRequirements.payTo, to: paymentRequirements.payTo, value: '1' } } }
    const req = new Request('http://localhost/api/x402/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentRequirements, paymentPayload }) })
    const response = await POST(req as never)
    expect(response.status).toBe(200)
    expect(settle).toHaveBeenCalledWith(paymentRequirements, paymentPayload)
  })
})
