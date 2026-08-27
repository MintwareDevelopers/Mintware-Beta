import { afterEach, describe, expect, it } from 'vitest'
import { erc20Abi, decodeFunctionData } from 'viem'
import { sweepBufferToVault } from './bridgeSweep'
import type { SignableCall, WalletSigner } from './walletSigner'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const VAULT = '0x1234567890123456789012345678901234567890'
const MEMBER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

function recordingSigner(hashes: `0x${string}`[]): WalletSigner & { calls: SignableCall[] } {
  const calls: SignableCall[] = []
  let i = 0
  return { calls, async sendTransaction(call) { calls.push(call); return { txHash: hashes[i++] ?? '0xdead' } } }
}

const base = { usdcAddress: USDC, vaultAddress: VAULT, member: MEMBER, availableAtomic: 350_000_000n, targetAtomic: 200_000_000n }

const saved = process.env.CARD_BUFFER_SWEEP_ENABLED
afterEach(() => {
  if (saved === undefined) delete process.env.CARD_BUFFER_SWEEP_ENABLED
  else process.env.CARD_BUFFER_SWEEP_ENABLED = saved
})

describe('sweepBufferToVault', () => {
  it('fails closed when the sweep flag is off', async () => {
    delete process.env.CARD_BUFFER_SWEEP_ENABLED
    const r = await sweepBufferToVault({ ...base, signer: recordingSigner(['0x1']) })
    expect(r).toEqual({ ok: false, reason: 'disabled' })
  })

  it('reports nothing when the buffer is at/below target', async () => {
    process.env.CARD_BUFFER_SWEEP_ENABLED = 'true'
    const r = await sweepBufferToVault({ ...base, availableAtomic: 200_000_000n, signer: recordingSigner(['0x1']) })
    expect(r).toEqual({ ok: false, reason: 'nothing' })
  })

  it('approves the vault for exactly the surplus then deposits it (both confirmed)', async () => {
    process.env.CARD_BUFFER_SWEEP_ENABLED = 'true'
    const signer = recordingSigner(['0xapprove', '0xdeposit'])
    const r = await sweepBufferToVault({ ...base, signer, confirm: async () => ({ success: true }) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sweptAtomic).toBe(150_000_000n)
    expect(r.txHash).toBe('0xdeposit') // the deposit tx is the sweep's result

    expect(signer.calls).toHaveLength(2)
    const approve = decodeFunctionData({ abi: erc20Abi, data: signer.calls[0].data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args?.[1]).toBe(150_000_000n) // approve exactly the surplus, no standing allowance
  })

  it('stops at not_confirmed if the approve does not mine (no deposit sent)', async () => {
    process.env.CARD_BUFFER_SWEEP_ENABLED = 'true'
    const signer = recordingSigner(['0xapprove', '0xdeposit'])
    const r = await sweepBufferToVault({ ...base, signer, confirm: async () => ({ success: false }) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('not_confirmed')
    expect(signer.calls).toHaveLength(1) // never reached the deposit
  })

  it('surfaces signer_error when a send throws', async () => {
    process.env.CARD_BUFFER_SWEEP_ENABLED = 'true'
    const signer: WalletSigner = { async sendTransaction() { throw new Error('rpc down') } }
    const r = await sweepBufferToVault({ ...base, signer })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('signer_error')
  })
})
