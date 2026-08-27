// The `grant_approval` onboarding step, isolated: turn the card's daily cap into a CAPPED ERC-20
// allowance and have the buffer wallet sign it so Bridge can pull at swipe time. All policy lives in
// lib/cards/bridge.ts (pure); this file only wires it to a WalletSigner and reports a clean result.

import {
  bridgeCardsEnabled,
  bridgeCardsSpender,
  buildApproveCall,
  computeApproveAllowanceAtomic,
} from '@/lib/cards/bridge'
import type { WalletSigner } from './walletSigner'

export type GrantApprovalResult =
  | { ok: true; txHash: `0x${string}`; allowanceAtomic: bigint; spender: `0x${string}` }
  | { ok: false; reason: 'disabled' | 'no_spender' | 'bad_input' | 'signer_error' | 'not_confirmed'; detail?: string }

/**
 * Grant Bridge the capped standing allowance on USDC from the funding (buffer) wallet. Fail-closed:
 * refuses when the Bridge rail is off or the per-program spender isn't configured, so it can never
 * silently approve a zero/placeholder address. Idempotent to re-run (approve overwrites the allowance).
 *
 * When `confirm` is supplied, `ok:true` means the approve tx MINED SUCCESSFULLY — not merely broadcast.
 * This matters: onboarding writes `bridge_approved_at` on `ok`, then advances to go-live; if we reported
 * success on a broadcast that later reverts/drops, the card would go live with a 0 allowance and the
 * first swipe would decline (defeating the cold-decline guard). Mirrors bufferRefill's receipt check.
 */
export async function grantBridgeApproval(opts: {
  usdcAddress: string
  dailyCapAtomic: bigint
  signer: WalletSigner
  coverageDays?: number
  /** Scope the allowance to the buffer (see computeApproveAllowanceAtomic). Strongly recommended live. */
  bufferTargetAtomic?: bigint
  /** Override the env spender (tests). Defaults to BRIDGE_CARDS_SPENDER via bridgeCardsSpender(). */
  spender?: string
  /** Verify the approve tx mined successfully. When omitted, `ok` reflects broadcast only (tests). */
  confirm?: (txHash: `0x${string}`) => Promise<{ success: boolean }>
}): Promise<GrantApprovalResult> {
  if (!bridgeCardsEnabled()) return { ok: false, reason: 'disabled' }

  const spender = opts.spender ?? bridgeCardsSpender()
  if (!spender) return { ok: false, reason: 'no_spender' }

  let allowanceAtomic: bigint
  let call
  try {
    allowanceAtomic = computeApproveAllowanceAtomic({
      dailyCapAtomic: opts.dailyCapAtomic,
      coverageDays: opts.coverageDays,
      bufferTargetAtomic: opts.bufferTargetAtomic,
    })
    call = buildApproveCall({ usdcAddress: opts.usdcAddress, spender, allowanceAtomic })
  } catch (e) {
    return { ok: false, reason: 'bad_input', detail: e instanceof Error ? e.message : String(e) }
  }

  let txHash: `0x${string}`
  try {
    ;({ txHash } = await opts.signer.sendTransaction(call))
  } catch (e) {
    return { ok: false, reason: 'signer_error', detail: e instanceof Error ? e.message : String(e) }
  }

  if (opts.confirm) {
    try {
      const { success } = await opts.confirm(txHash)
      if (!success) return { ok: false, reason: 'not_confirmed', detail: `approve tx ${txHash} did not succeed` }
    } catch (e) {
      return { ok: false, reason: 'not_confirmed', detail: e instanceof Error ? e.message : String(e) }
    }
  }

  return { ok: true, txHash, allowanceAtomic, spender: spender as `0x${string}` }
}
