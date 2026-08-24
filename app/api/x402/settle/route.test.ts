import { beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'

const settleSpy = vi.fn(async (..._args: unknown[]) => ({ success: true, txHash: '0xok', network: 'base-sepolia' }))

vi.mock('@/lib/x402/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/x402/config')>()
  return {
    ...actual,
    getFacilitator: () => ({ settle: settleSpy }),
    x402PermitGateway: () => GATEWAY,
  }
})

vi.mock('@/lib/x402/permitStore', () => ({
  getStandingPermit: vi.fn(async () => null),
}))

import { POST } from '@/app/api/x402/settle/route'
import { getStandingPermit } from '@/lib/x402/permitStore'

// A real signer — the payer whose EIP-3009 signature the settle path now cryptographically verifies.
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const account = privateKeyToAccount(PAYER_KEY)
const PAYER = account.address // the standing permit's `user` and the EIP-3009 `from`
const PAYTO = '0x2222222222222222222222222222222222222222'
const ATTACKER = '0x3333333333333333333333333333333333333333'
const GATEWAY = '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399'
// base-sepolia USDC — the exact (name/version/chainId/verifyingContract) the verifier + the AgentKit signer use.
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const USDC_DOMAIN = { name: 'USDC', version: '2', chainId: 84532, verifyingContract: USDC as `0x${string}` }
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

const STORED_PERMIT = {
  user: PAYER,
  max_daily_spend_usdc: '2000000',
  nonce: '1',
  deadline: '1999999999',
  signature: '0x' + 'ab'.repeat(65),
}

/** Build a payment payload whose EIP-3009 authorization is really signed by the payer for {to, value}. */
async function signedPayload(opts: { to?: string; value?: string; from?: string } = {}) {
  const authorization = {
    from: (opts.from ?? PAYER) as `0x${string}`,
    to: (opts.to ?? PAYTO) as `0x${string}`,
    value: opts.value ?? '1000000',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: ('0x' + 'cd'.repeat(32)) as `0x${string}`,
  }
  const signature = await account.signTypedData({
    domain: USDC_DOMAIN,
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  })
  return { x402Version: 2, scheme: 'exact', network: 'base-sepolia', payload: { signature, authorization } }
}

async function body(over: Record<string, unknown> = {}, payloadOpts?: Parameters<typeof signedPayload>[0]) {
  return {
    paymentRequirements: { payTo: PAYTO, maxAmountRequired: '1000000', network: 'base-sepolia', asset: USDC },
    paymentPayload: await signedPayload(payloadOpts),
    holdId: '0x' + '11'.repeat(32),
    ...over,
  }
}

function post(b: unknown) {
  return POST(new Request('http://localhost/api/x402/settle', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  }) as never)
}

describe('POST /api/x402/settle — standing-permit sourcing + EIP-3009 authorization (H-2)', () => {
  beforeEach(() => {
    settleSpy.mockClear()
    vi.mocked(getStandingPermit).mockReset()
    process.env.X402_RELAYER_URL = 'https://relayer.example'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  })

  it('(a) settles when the EIP-3009 authorization is validly signed for the exact {to, value}', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    const res = await post(await body())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, txHash: '0xok' })
    expect(vi.mocked(getStandingPermit)).toHaveBeenCalledWith(expect.anything(), PAYER, GATEWAY)
    // facilitator.settle(reqs, payload, holdId, permit, edge) — permit is the 4th arg
    expect(settleSpy).toHaveBeenCalledTimes(1)
    expect(settleSpy.mock.calls[0][3]).toEqual(STORED_PERMIT)
  })

  it('(b) REJECTS when paymentRequirements.payTo differs from the signed `to` (redirect-to-attacker)', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    // payer signed `to = PAYTO`, but the attacker sets the settlement recipient to themselves.
    const res = await post(await body({ paymentRequirements: { payTo: ATTACKER, maxAmountRequired: '1000000', network: 'base-sepolia', asset: USDC } }))
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ success: false, errorReason: 'authorization_recipient_mismatch' })
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('(c) REJECTS when the settled value differs from the signed value (signature no longer covers it)', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    // Sign for value 1_000_000 but present an authorization claiming 1_500_000 → signature won't recover.
    const b = await body({ paymentRequirements: { payTo: PAYTO, maxAmountRequired: '2000000', network: 'base-sepolia', asset: USDC } })
    ;(b.paymentPayload.payload.authorization as { value: string }).value = '1500000'
    const res = await post(b)
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ success: false, errorReason: 'invalid_payment_signature' })
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('(d) REJECTS a missing/invalid EIP-3009 signature', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    // missing signature entirely
    const missing = await body()
    ;(missing.paymentPayload.payload as { signature?: string }).signature = undefined
    const res1 = await post(missing)
    expect(res1.status).toBe(402)
    expect(await res1.json()).toMatchObject({ success: false, errorReason: 'settlement_authorization_missing' })
    expect(settleSpy).not.toHaveBeenCalled()

    // present but garbage signature → recovery fails
    const garbage = await body()
    ;(garbage.paymentPayload.payload as { signature: string }).signature = '0x' + '00'.repeat(65)
    const res2 = await post(garbage)
    expect(res2.status).toBe(402)
    expect(await res2.json()).toMatchObject({ success: false, errorReason: 'invalid_payment_signature' })
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('REJECTS when the signed `from` is not the standing permit user (victim-permit hijack)', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(STORED_PERMIT)
    // A different signer signs a self-consistent authorization; its `from` != permit.user (the victim).
    const other = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000002')
    const authorization = {
      from: other.address, to: PAYTO as `0x${string}`, value: '1000000', validAfter: '0', validBefore: '9999999999',
      nonce: ('0x' + 'cd'.repeat(32)) as `0x${string}`,
    }
    const signature = await other.signTypedData({
      domain: USDC_DOMAIN, types: EIP3009_TYPES, primaryType: 'TransferWithAuthorization',
      message: { ...authorization, value: 1000000n, validAfter: 0n, validBefore: 9999999999n },
    })
    const res = await post({
      paymentRequirements: { payTo: PAYTO, maxAmountRequired: '1000000', network: 'base-sepolia', asset: USDC },
      paymentPayload: { x402Version: 2, scheme: 'exact', network: 'base-sepolia', payload: { signature, authorization } },
      holdId: '0x' + '11'.repeat(32),
    })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ success: false, errorReason: 'authorization_payer_mismatch' })
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('fails closed with no_standing_permit when none is registered (relayer configured)', async () => {
    vi.mocked(getStandingPermit).mockResolvedValue(null)
    const res = await post(await body())
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ success: false, errorReason: 'no_standing_permit' })
    expect(settleSpy).not.toHaveBeenCalled() // never reaches the relayer without a permit
  })

  it('a caller-supplied permit wins without a store lookup — but still must carry a valid signature', async () => {
    const res = await post(await body({ permit: STORED_PERMIT }))
    expect(res.status).toBe(200)
    expect(vi.mocked(getStandingPermit)).not.toHaveBeenCalled()
    expect(settleSpy.mock.calls[0][3]).toEqual(STORED_PERMIT)
  })
})
