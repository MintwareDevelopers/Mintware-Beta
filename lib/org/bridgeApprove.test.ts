import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { grantBridgeApproval } from './bridgeApprove'
import type { SignableCall, WalletSigner } from './walletSigner'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SPENDER = '0x2222222222222222222222222222222222222222'
const DAY = 500_000_000n

function recordingSigner(hash = '0xabc' as `0x${string}`): WalletSigner & { calls: SignableCall[] } {
  const calls: SignableCall[] = []
  return { calls, async sendTransaction(call) { calls.push(call); return { txHash: hash } } }
}

const saved = process.env.CARD_BRIDGE_ENABLED
afterEach(() => {
  if (saved === undefined) delete process.env.CARD_BRIDGE_ENABLED
  else process.env.CARD_BRIDGE_ENABLED = saved
})

describe('grantBridgeApproval', () => {
  it('fails closed when the Bridge rail is disabled', async () => {
    delete process.env.CARD_BRIDGE_ENABLED
    const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer: recordingSigner(), spender: SPENDER })
    expect(r).toEqual({ ok: false, reason: 'disabled' })
  })

  it('fails when no spender is configured', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    delete process.env.BRIDGE_CARDS_SPENDER
    const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer: recordingSigner() })
    expect(r).toEqual({ ok: false, reason: 'no_spender' })
  })

  it('signs a capped approve to the spender on USDC', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const signer = recordingSigner('0xfeed')
    const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer, spender: SPENDER, coverageDays: 7 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.txHash).toBe('0xfeed')
    expect(r.allowanceAtomic).toBe(DAY * 7n) // capped, not unlimited

    expect(signer.calls).toHaveLength(1)
    const call = signer.calls[0]
    expect(call.to).toBe(getAddress(USDC))
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args).toEqual([getAddress(SPENDER), DAY * 7n])
  })

  it('reports bad_input on a nonsensical cap, without calling the signer', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const signer = recordingSigner()
    const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: 0n, signer, spender: SPENDER })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('bad_input')
    expect(signer.calls).toHaveLength(0)
  })

  it('surfaces signer_error when the wallet send throws', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const signer: WalletSigner = { sendTransaction: vi.fn().mockRejectedValue(new Error('nope')) }
    const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer, spender: SPENDER })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('signer_error')
    expect(r.detail).toContain('nope')
  })

  it('with confirm, only reports ok when the approve tx actually MINED successfully', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const signer = recordingSigner('0xmined')
    const ok = await grantBridgeApproval({
      usdcAddress: USDC, dailyCapAtomic: DAY, signer, spender: SPENDER,
      confirm: async () => ({ success: true }),
    })
    expect(ok.ok).toBe(true)

    const reverted = await grantBridgeApproval({
      usdcAddress: USDC, dailyCapAtomic: DAY, signer, spender: SPENDER,
      confirm: async () => ({ success: false }), // broadcast then reverted/dropped
    })
    expect(reverted.ok).toBe(false)
    if (reverted.ok) return
    expect(reverted.reason).toBe('not_confirmed')
  })
})
