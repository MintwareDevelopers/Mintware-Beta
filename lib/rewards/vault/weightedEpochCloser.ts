// =============================================================================
// weightedEpochCloser.ts — deployment-time glue to close a weighted vault epoch
//
// Slice 4 (deployment glue). Sits between the data sources (Supabase LP records +
// referral graph + Attribution scores) and the tested orchestrator/contract:
//
//   raw LP positions ─┐
//   referral graph  ──┼─▶ assembleLpInputs ─▶ buildAndSignWeightedEpoch (orchestrator)
//   percentiles     ──┘                          │
//                                                ├─▶ submitCloseEpoch (on-chain, keeper)
//                                                └─▶ buildClaimIndex (persist for claims)
//
// The assembly + claim-index are pure and unit-tested here. The on-chain submit is a
// thin viem write kept out of the tested surface (needs a deployed address + keeper key).
//
// FAIL-CLOSED (C9) is preserved end to end: if the score source is unavailable,
// assembleLpInputs returns scoresAvailable=false and the orchestrator refuses to sign.
// =============================================================================

import { createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { LockTier } from '@/lib/web2/vault/types'
import type { WeightedLpInput } from './weightedDistribution'
import type { WeightedEpochResult } from './weightedEpochOrchestrator'

/** A pair-vault LP position as loaded from the LP record source (on-chain shares / indexer). */
export interface RawLpPosition {
  wallet: string
  liquidityUnits: number   // vault shares == V4 liquidity units
  lockTier: LockTier
  daysHeld: number
}

export interface AssembledLps {
  lps: WeightedLpInput[]
  /** false → score source failed for the epoch; caller must NOT sign (fail-closed, C9). */
  scoresAvailable: boolean
}

/**
 * Join the referral graph and Attribution percentiles onto raw LP positions.
 *
 * @param raw                  LP positions this epoch
 * @param referrerByWallet     lowercased LP wallet → lowercased referrer wallet
 * @param percentileByWallet   lowercased wallet → Attribution percentile, or NULL if the
 *                             score source failed WHOLESALE (→ scoresAvailable=false). A
 *                             per-wallet MISS (present map, absent key) yields NaN, which
 *                             the orchestrator also fail-closes on — we never fabricate a 0.
 */
export function assembleLpInputs(
  raw: RawLpPosition[],
  referrerByWallet: Map<string, string>,
  percentileByWallet: Map<string, number> | null
): AssembledLps {
  const lps: WeightedLpInput[] = raw.map((r) => {
    const w = r.wallet.toLowerCase()
    return {
      wallet: w,
      liquidityUnits: r.liquidityUnits,
      lockTier: r.lockTier,
      daysHeld: r.daysHeld,
      attrPercentile: percentileByWallet ? (percentileByWallet.get(w) ?? Number.NaN) : 0,
      referrer: referrerByWallet.get(w),
    }
  })

  const scoresAvailable =
    percentileByWallet !== null && lps.every((l) => Number.isFinite(l.attrPercentile))

  return { lps, scoresAvailable }
}

export interface ClaimEntry {
  amount0Wei: string
  amount1Wei: string
  proof: string[]
}

/** Wallet → claim (amounts + Merkle proof) for serving claim requests from the persisted tree. */
export function buildClaimIndex(result: WeightedEpochResult): Record<string, ClaimEntry> {
  const index: Record<string, ClaimEntry> = {}
  for (const leaf of result.leaves) {
    index[leaf.wallet.toLowerCase()] = {
      amount0Wei: leaf.amount0Wei,
      amount1Wei: leaf.amount1Wei,
      proof: leaf.proof,
    }
  }
  return index
}

// ── on-chain submission (thin; needs a deployed distributor + keeper key) ──────

const CLOSE_EPOCH_ABI = [
  {
    type: 'function',
    name: 'closeEpoch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vaultId', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'total0', type: 'uint256' },
      { name: 'total1', type: 'uint256' },
      { name: 'oracleSig', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export interface SubmitCloseEpochConfig {
  distributorAddress: `0x${string}`
  chainId: number
  rpcUrl: string
  keeperPrivateKey: Hex
}

/**
 * Submit the signed epoch close on-chain via a keeper wallet. The keeper only pays gas —
 * the oracle signature (built by the orchestrator) is what the contract trusts, so the
 * keeper key holds no authority over reward correctness.
 */
export async function submitCloseEpoch(
  cfg: SubmitCloseEpochConfig,
  args: WeightedEpochResult['closeEpochArgs']
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(cfg.keeperPrivateKey)
  const chain = cfg.chainId === 8453 ? base : baseSepolia
  const client = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) })
  return client.writeContract({
    address: cfg.distributorAddress,
    abi: CLOSE_EPOCH_ABI,
    functionName: 'closeEpoch',
    args: [args.vaultId, args.merkleRoot, args.total0, args.total1, args.signature, args.deadline],
  })
}
