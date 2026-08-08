// =============================================================================
// twoTokenMerkleBuilder.ts — Merkle tree for two-token weighted distributions
//
// Slice 3 of the oracle migration. Turns the per-wallet (amount0, amount1)
// allocation from weightedDistribution.ts into the tree whose root the oracle
// signs and MintwareWeightedDistributor verifies.
//
// Leaf encoding MUST match the contract (MintwareWeightedDistributor.claim):
//   keccak256(bytes.concat(keccak256(abi.encode(wallet, amount0, amount1))))
// which is exactly OpenZeppelin StandardMerkleTree with leaf types
//   ['address', 'uint256', 'uint256'].
//
// Amounts are converted to raw integer units per token decimals. Wallets whose
// (amount0, amount1) are both zero are dropped — the contract rejects a zero
// claim, and they carry no value.
// =============================================================================

import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import type { WeightedEntry } from './weightedDistribution'

export interface TwoTokenLeaf {
  wallet: string
  amount0Wei: string  // bigint as string
  amount1Wei: string  // bigint as string
  proof: string[]
}

export interface TwoTokenMerkleResult {
  root: string
  leaves: TwoTokenLeaf[]
  total0Wei: string   // Σ amount0Wei — the total0 the oracle signs (must be ≤ funded pot0)
  total1Wei: string   // Σ amount1Wei — the total1 the oracle signs (must be ≤ funded pot1)
  tree_dump: object
  walletsIncluded: number
  walletsDroppedZero: number
}

/** Convert a nominal token amount to raw integer units for `decimals`. */
export function toWei(amount: number, decimals: number): bigint {
  if (!(amount > 0)) return 0n
  // Scale then round to avoid float dust; never emit a negative.
  const scaled = Math.round(amount * 10 ** decimals)
  return scaled > 0 ? BigInt(scaled) : 0n
}

/**
 * Build the two-token Merkle tree.
 *
 * @param entries          per-wallet allocation from computeWeightedDistribution
 * @param token0Decimals   decimals of token0 (e.g. 18)
 * @param token1Decimals   decimals of token1 (e.g. 6 for USDC)
 */
export function buildTwoTokenMerkleTree(
  entries: WeightedEntry[],
  token0Decimals: number,
  token1Decimals: number
): TwoTokenMerkleResult {
  const rows = entries
    .map((e) => ({
      wallet: e.wallet.toLowerCase(),
      amount0Wei: toWei(e.amount0, token0Decimals),
      amount1Wei: toWei(e.amount1, token1Decimals),
    }))
    .filter((r) => r.amount0Wei > 0n || r.amount1Wei > 0n)

  const walletsDroppedZero = entries.length - rows.length

  if (rows.length === 0) {
    throw new Error('[twoTokenMerkleBuilder] Cannot build a tree with 0 non-zero entries')
  }

  const tree = StandardMerkleTree.of(
    rows.map((r) => [r.wallet, r.amount0Wei.toString(), r.amount1Wei.toString()]),
    ['address', 'uint256', 'uint256']
  )

  const proofByWallet = new Map<string, string[]>()
  for (const [i, [wallet]] of tree.entries()) {
    proofByWallet.set((wallet as string).toLowerCase(), tree.getProof(i))
  }

  const leaves: TwoTokenLeaf[] = rows.map((r) => ({
    wallet: r.wallet,
    amount0Wei: r.amount0Wei.toString(),
    amount1Wei: r.amount1Wei.toString(),
    proof: proofByWallet.get(r.wallet) ?? [],
  }))

  const total0Wei = rows.reduce((s, r) => s + r.amount0Wei, 0n)
  const total1Wei = rows.reduce((s, r) => s + r.amount1Wei, 0n)

  return {
    root: tree.root,
    leaves,
    total0Wei: total0Wei.toString(),
    total1Wei: total1Wei.toString(),
    tree_dump: tree.dump(),
    walletsIncluded: rows.length,
    walletsDroppedZero,
  }
}
