// =============================================================================
// weightedEpochOrchestrator.ts — close a weighted vault epoch end-to-end
//
// Slice 4 (off-chain) of the oracle migration. Ties the pieces together:
//   slice 3 weighting  →  two-token Merkle tree  →  oracle-signed EpochRoot
// producing exactly the arguments MintwareWeightedDistributor.closeEpoch expects.
//
// The contract enforces provenance + no-over-allocation (C1/C5); this module owns
// the weighting and the signature. Two safety properties live here:
//
//   • FAIL-CLOSED LIVENESS (audit C9): if the Attribution score source is unavailable
//     for the epoch, the caller MUST pass scoresAvailable=false — we then THROW and
//     refuse to sign, rather than signing a degraded (everyone-1.0×) snapshot. The old
//     FeeVault path silently defaulted missing percentiles to 0; that is the bug we
//     refuse to reproduce. A skipped epoch is recoverable; a wrong signed root is not.
//
//   • The signed EpochRoot binds vaultId + epochNumber, so a root can neither be
//     replayed onto another epoch nor close the wrong vault (verified on-chain).
//
// DB-decoupled: callers fetch the LP set / referral graph / percentiles and pass them
// in, so the weighting + signing are unit-testable without Supabase or a live chain.
// =============================================================================

import {
  computeWeightedDistribution,
  type WeightedLpInput,
  type TwoTokenAmount,
} from './weightedDistribution'
import { buildTwoTokenMerkleTree, type TwoTokenLeaf } from './twoTokenMerkleBuilder'
import { getOracleSigner } from '@/lib/web3/oracleSigner'

const EPOCH_ROOT_TYPES = {
  EpochRoot: [
    { name: 'vaultId',      type: 'bytes32' },
    { name: 'epochNumber',  type: 'uint256' },
    { name: 'merkleRoot',   type: 'bytes32' },
    { name: 'totalAmount0', type: 'uint256' },
    { name: 'totalAmount1', type: 'uint256' },
    { name: 'deadline',     type: 'uint256' },
  ],
} as const

export interface WeightedEpochInput {
  vaultId: `0x${string}`            // bytes32 vault id registered with the distributor
  epochNumber: number
  distributorAddress: `0x${string}` // verifyingContract for the EIP-712 domain
  chainId: number
  feesPot: TwoTokenAmount           // the fee pot funded into this epoch (nominal units)
  lps: WeightedLpInput[]            // eligible LPs (with referrer + attrPercentile filled in)
  token0Decimals: number
  token1Decimals: number
  deadline: number                  // unix seconds — signature-freshness bound for closeEpoch
  /** Set false when the Attribution score source failed for this epoch → we refuse to sign (C9). */
  scoresAvailable: boolean
}

export interface WeightedEpochResult {
  merkleRoot: `0x${string}`
  total0Wei: string
  total1Wei: string
  leaves: TwoTokenLeaf[]
  treeDump: object
  marginRequired: TwoTokenAmount    // treasury must fund this much for the referral bonuses
  signature: `0x${string}`
  oracleSigner: `0x${string}`
  /** Positional args for MintwareWeightedDistributor.closeEpoch(...). */
  closeEpochArgs: {
    vaultId: `0x${string}`
    merkleRoot: `0x${string}`
    total0: bigint
    total1: bigint
    signature: `0x${string}`
    deadline: bigint
  }
}

export class ScoreSourceUnavailableError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ScoreSourceUnavailableError' }
}

/** True only if every percentile is a real number in [0,100]. Guards against a
 *  swallowed fetch error silently becoming a 0 (which would sign an all-1.0× epoch). */
function allPercentilesValid(lps: WeightedLpInput[]): boolean {
  return lps.every(
    (lp) => Number.isFinite(lp.attrPercentile) && lp.attrPercentile >= 0 && lp.attrPercentile <= 100
  )
}

/**
 * Build and oracle-sign a weighted epoch. Throws ScoreSourceUnavailableError (fail-closed)
 * if scores are unavailable/invalid — the caller must then leave the epoch OPEN and alert,
 * never close it on a degraded snapshot.
 */
export async function buildAndSignWeightedEpoch(
  input: WeightedEpochInput
): Promise<WeightedEpochResult> {
  // ── C9 fail-closed: never sign a degraded snapshot ──
  if (!input.scoresAvailable) {
    throw new ScoreSourceUnavailableError(
      `[weightedEpoch] Attribution scores unavailable for vault ${input.vaultId} epoch ` +
      `${input.epochNumber}; refusing to sign (fail-closed). Leave the epoch open and retry.`
    )
  }
  if (!allPercentilesValid(input.lps)) {
    throw new ScoreSourceUnavailableError(
      `[weightedEpoch] One or more LP percentiles are missing/out of range for vault ` +
      `${input.vaultId} epoch ${input.epochNumber}; refusing to sign (fail-closed).`
    )
  }

  // ── weight → two-token allocation → tree ──
  const dist = computeWeightedDistribution(input.lps, input.feesPot)
  const tree = buildTwoTokenMerkleTree(dist.entries, input.token0Decimals, input.token1Decimals)

  const merkleRoot = tree.root as `0x${string}`
  const total0 = BigInt(tree.total0Wei)
  const total1 = BigInt(tree.total1Wei)
  const deadline = BigInt(input.deadline)

  // ── oracle-sign the EpochRoot (weight role — audit C2) ──
  const account = await getOracleSigner('weight')
  const signature = await account.signTypedData({
    domain: {
      name: 'MintwareWeightedDistributor',
      version: '1',
      chainId: input.chainId,
      verifyingContract: input.distributorAddress,
    },
    types: EPOCH_ROOT_TYPES,
    primaryType: 'EpochRoot',
    message: {
      vaultId: input.vaultId,
      epochNumber: BigInt(input.epochNumber),
      merkleRoot,
      totalAmount0: total0,
      totalAmount1: total1,
      deadline,
    },
  })

  return {
    merkleRoot,
    total0Wei: tree.total0Wei,
    total1Wei: tree.total1Wei,
    leaves: tree.leaves,
    treeDump: tree.tree_dump,
    marginRequired: dist.marginRequired,
    signature,
    oracleSigner: account.address,
    closeEpochArgs: { vaultId: input.vaultId, merkleRoot, total0, total1, signature, deadline },
  }
}
