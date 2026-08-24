import { beforeEach, describe, expect, it, vi } from 'vitest'

const settleSpy = vi.fn(async (..._args: unknown[]) => ({ success: true, txHash: '0xok', network: 'arc' }))

vi.mock('@/lib/x402/config', () => ({
  getFacilitator: () => ({ settle: settleSpy }),
  x402PermitGateway: () => '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399',
}))

vi.mock('@/lib/x402/permitStore', () => ({
  getStandingPermit: vi.fn(async () => null),
}))

import { POST } from '@/app/api/x402/settle/route'
import { getStandingPermit } from '@/lib/x402/permitStore'

const PAYER = '0x1111111111111111111111111111111111111111'
const GATEWAY = '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399'

const STORED_PERMIT = {
  user: PAYER,
  max_daily_spend_usdc: '2000000',
  nonce: '1',
  deadline: '1999999999',
  signature: '0x' + 'ab'.repeat(65),
}

function body(over: Record<string, unknown> = {}) {
  return {
    paymentRequirements: { payTo: '0x2222222222222222222222222222222222222222', maxAmountRequired: '1000000', network: 'arc' },
    paymentPayload: { payload: { authorization: { from: PAYER, value: '1000000' } } },
    holdId: '0x' + '11'.repeat(32),
    ...over,
  }
}

function post(b: unknown) {
  return POST(new Request('http://localhost/api/x402/settle', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  }) as never)
}

describe('POST /api/x402/settle — standing-permit sourcing', () => {
  beforeEach(() => {
    settleSpy.mockClear()
    vi.mocked(getStandingPermit).mockReset()
    process.env.X402_RELAYER_URL = 'https://relayer.example'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  })

  it('sources the payer standing permit from the store and threads it into settle', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    const res = await post(body())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, txHash: '0xok' })
    expect(vi.mocked(getStandingPermit)).toHaveBeenCalledWith(expect.anything(), PAYER, GATEWAY)
    // facilitator.settle(reqs, payload, holdId, permit, edge) — permit is the 4th arg
    expect(settleSpy).toHaveBeenCalledTimes(1)
    expect(settleSpy.mock.calls[0][3]).toEqual(STORED_PERMIT)
  })

  it('fails closed with no_standing_permit when none is registered (relayer configured)', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(null)
    const res = await post(body())
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ success: false, errorReason: 'no_standing_permit' })
    expect(settleSpy).not.toHaveBeenCalled() // never reaches the relayer without a permit
  })

  it('a caller-supplied permit wins without a store lookup', async () => {
    const res = await post(body({ permit: STORED_PERMIT }))
    expect(res.status).toBe(200)
    expect(vi.mocked(getStandingPermit)).not.toHaveBeenCalled()
    expect(settleSpy.mock.calls[0][3]).toEqual(STORED_PERMIT)
  })
})
