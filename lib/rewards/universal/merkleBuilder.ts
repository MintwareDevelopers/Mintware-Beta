import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import type { UniversalAllocationEntry, UniversalMerkleLeaf, UniversalMerkleResult } from './types'

const USDC_DECIMALS = 6
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function usdToUsdcWei(usdAmount: number): bigint {
  return BigInt(Math.round(usdAmount * 10 ** USDC_DECIMALS))
}

export function buildUniversalMerkleTree(entries: UniversalAllocationEntry[]): UniversalMerkleResult {
  if (entries.length === 0) {
    throw new Error('[universalMerkleBuilder] Cannot build Merkle tree with 0 entries')
  }

  const rewardRows = entries
    .filter((entry) => ADDRESS_RE.test(entry.recipient))
    .filter((entry) => entry.amount_usd > 0)
    .map((entry) => ({
      recipient: entry.recipient.toLowerCase(),
      amount_usdc_wei: usdToUsdcWei(entry.amount_usd),
    }))

  if (rewardRows.length === 0) {
    throw new Error('[universalMerkleBuilder] Cannot build Merkle tree with only zero-value entries')
  }

  const tree = StandardMerkleTree.of(
    rewardRows.map((row) => [row.recipient, row.amount_usdc_wei.toString()]),
    ['address', 'uint256']
  )

  const proofMap = new Map<string, string[]>()
  for (const [i, [recipient]] of tree.entries()) {
    proofMap.set((recipient as string).toLowerCase(), tree.getProof(i))
  }

  const leaves: UniversalMerkleLeaf[] = rewardRows.map((row) => ({
    recipient: row.recipient,
    amount_usdc_wei: row.amount_usdc_wei.toString(),
    proof: proofMap.get(row.recipient) ?? [],
  }))

  const total_usdc_wei = rewardRows.reduce((sum, row) => sum + row.amount_usdc_wei, 0n).toString()

  return {
    root: tree.root,
    leaves,
    total_usdc_wei,
    tree_dump: tree.dump(),
  }
}
