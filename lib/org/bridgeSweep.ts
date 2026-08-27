// Buffer → vault sweep orchestration: the member's funding (Privy) wallet approves the vault for the
// surplus, then deposits it as senior shares to the member. Mirror of grantBridgeApproval/refill; all
// I/O is injected (WalletSigner + confirm) so it's testable with fakes. Fail-closed behind the flag.

import { buildApproveCall } from '@/lib/cards/bridge'
import { bufferSweepEnabled, buildDepositCall, computeSweepAtomic } from '@/lib/cards/sweep'
import type { WalletSigner } from './walletSigner'

export type SweepResult =
  | { ok: true; sweptAtomic: bigint; txHash: `0x${string}` }
  | { ok: false; reason: 'disabled' | 'nothing' | 'bad_input' | 'signer_error' | 'not_confirmed'; detail?: string }

/**
 * Sweep the buffer surplus (above target) back into the vault. Signs an exact-amount approve to the
 * vault then depositUSDC(surplus, minShares, to=member), each receipt-confirmed when `confirm` is
 * supplied. Returns `nothing` when there's no material surplus, `disabled` when the flag is off.
 * The approve is scoped to exactly the swept amount (no standing allowance to the vault).
 */
export async function sweepBufferToVault(opts: {
  usdcAddress: string
  vaultAddress: string
  member: string
  availableAtomic: bigint
  targetAtomic: bigint
  minSweepAtomic?: bigint
  minShares?: bigint
  signer: WalletSigner
  confirm?: (txHash: `0x${string}`) => Promise<{ success: boolean }>
}): Promise<SweepResult> {
  if (!bufferSweepEnabled()) return { ok: false, reason: 'disabled' }

  const sweptAtomic = computeSweepAtomic({
    availableAtomic: opts.availableAtomic,
    targetAtomic: opts.targetAtomic,
    minSweepAtomic: opts.minSweepAtomic,
  })
  if (sweptAtomic <= 0n) return { ok: false, reason: 'nothing' }

  let approveCall
  let depositCall
  try {
    approveCall = buildApproveCall({ usdcAddress: opts.usdcAddress, spender: opts.vaultAddress, allowanceAtomic: sweptAtomic })
    depositCall = buildDepositCall({ vaultAddress: opts.vaultAddress, assetsAtomic: sweptAtomic, minShares: opts.minShares ?? 0n, to: opts.member })
  } catch (e) {
    return { ok: false, reason: 'bad_input', detail: e instanceof Error ? e.message : String(e) }
  }

  const confirmOrThrow = async (hash: `0x${string}`) => {
    if (!opts.confirm) return
    const { success } = await opts.confirm(hash)
    if (!success) throw new Error(`tx ${hash} did not succeed`)
  }

  try {
    const { txHash: approveHash } = await opts.signer.sendTransaction(approveCall)
    await confirmOrThrow(approveHash)
    const { txHash } = await opts.signer.sendTransaction(depositCall)
    await confirmOrThrow(txHash)
    return { ok: true, sweptAtomic, txHash }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // a confirm failure is a not_confirmed; a send failure is a signer_error.
    return { ok: false, reason: msg.includes('did not succeed') ? 'not_confirmed' : 'signer_error', detail: msg }
  }
}
