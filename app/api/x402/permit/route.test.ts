import { beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import {
  DELEGATED_SPEND_PERMIT_DOMAIN_NAME,
  DELEGATED_SPEND_PERMIT_DOMAIN_VERSION,
  DELEGATED_SPEND_PERMIT_TYPES,
} from '@/lib/org/spendPermit'

// Spy on the store so the route never touches real Supabase; ctx.supabase is still evaluated (lazy
// getter) so we set dummy Supabase env below to let getServiceClient() construct without throwing.
vi.mock('@/lib/x402/permitStore', () => ({
  putStandingPermit: vi.fn(async () => ({ ok: true })),
  getStandingPermit: vi.fn(async () => null),
}))

import { POST } from '@/app/api/x402/permit/route'
import { putStandingPermit } from '@/lib/x402/permitStore'

const GATEWAY = '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399'
const CHAIN_ID = 84532 // Base Sepolia (Arc dropped 2026-08-27)

const payerAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const otherAccount = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')

const FUTURE_DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 86_400)

async function sign(account: typeof payerAccount, over: Partial<{ user: `0x${string}`; maxDailySpendUSDC: bigint; nonce: bigint; deadline: bigint }> = {}) {
  const message = {
    user: over.user ?? account.address,
    maxDailySpendUSDC: over.maxDailySpendUSDC ?? 2_000_000n,
    nonce: over.nonce ?? 1n,
    deadline: over.deadline ?? FUTURE_DEADLINE,
  }
  return account.signTypedData({
    domain: { name: DELEGATED_SPEND_PERMIT_DOMAIN_NAME, version: DELEGATED_SPEND_PERMIT_DOMAIN_VERSION, chainId: CHAIN_ID, verifyingContract: GATEWAY as `0x${string}` },
    types: DELEGATED_SPEND_PERMIT_TYPES,
    primaryType: 'DelegatedSpendPermit',
    message,
  })
}

function post(body: unknown) {
  return POST(new Request('http://localhost/api/x402/permit', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
}

describe('POST /api/x402/permit', () => {
  beforeEach(() => {
    vi.mocked(putStandingPermit).mockClear()
    process.env.X402_GATEWAY_ADDRESS = GATEWAY
    process.env.X402_PERMIT_CHAIN_ID = String(CHAIN_ID)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  })

  it('stores a valid standing permit (signature recovers to payer)', async () => {
    const signature = await sign(payerAccount)
    const res = await post({ payer: payerAccount.address, maxDailySpendUsdc: '2000000', nonce: '1', deadline: FUTURE_DEADLINE.toString(), signature })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(vi.mocked(putStandingPermit)).toHaveBeenCalledTimes(1)
    const [, arg] = vi.mocked(putStandingPermit).mock.calls[0]
    expect(arg).toMatchObject({
      payer: payerAccount.address,
      user: payerAccount.address,
      gateway: GATEWAY,
      chainId: CHAIN_ID,
      maxDailySpendUsdc: '2000000',
      nonce: '1',
      signature,
    })
  })

  it('rejects a malformed signature — fail closed, no store write', async () => {
    const res = await post({ payer: payerAccount.address, maxDailySpendUsdc: '2000000', nonce: '1', deadline: FUTURE_DEADLINE.toString(), signature: '0x' + 'ab'.repeat(65) })
    const json = await res.json()
    expect(res.status).toBe(401)
    expect(json.error).toBe('signature_does_not_recover_to_payer')
    expect(vi.mocked(putStandingPermit)).not.toHaveBeenCalled()
  })

  it('rejects a signature from the wrong signer (someone signs, another claims to be payer)', async () => {
    // `other` signs a permit whose `user` field is the payer's address, then submits it as `payer`.
    // The signature recovers to `other`, not `payer` → rejected. settleSpend would burn from payer.
    const signature = await sign(otherAccount, { user: payerAccount.address })
    const res = await post({ payer: payerAccount.address, maxDailySpendUsdc: '2000000', nonce: '1', deadline: FUTURE_DEADLINE.toString(), signature })
    const json = await res.json()
    expect(res.status).toBe(401)
    expect(json.error).toBe('signature_does_not_recover_to_payer')
    expect(vi.mocked(putStandingPermit)).not.toHaveBeenCalled()
  })

  it('rejects a tampered field (sig valid for a different amount than submitted)', async () => {
    const signature = await sign(payerAccount, { maxDailySpendUSDC: 2_000_000n })
    // submit a different amount than was signed → recovery yields a different (wrong) address
    const res = await post({ payer: payerAccount.address, maxDailySpendUsdc: '9999999', nonce: '1', deadline: FUTURE_DEADLINE.toString(), signature })
    expect(res.status).toBe(401)
    expect(vi.mocked(putStandingPermit)).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when no gateway is configured', async () => {
    delete process.env.X402_GATEWAY_ADDRESS
    delete process.env.RELAYER_GATEWAY_ADDRESS
    delete process.env.NEXT_PUBLIC_ARC_GATEWAY_ADDRESS
    const signature = await sign(payerAccount)
    const res = await post({ payer: payerAccount.address, maxDailySpendUsdc: '2000000', nonce: '1', deadline: FUTURE_DEADLINE.toString(), signature })
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.error).toBe('permit_gateway_unconfigured')
  })
})
