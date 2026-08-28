// Viem chain objects for the YPN testnet chain(s). Base Sepolia ships built into viem/chains.
// (Arc testnet was dropped 2026-08-27.) This is only for routes that actually sign/submit a
// transaction; read-only eth_calls (lib/org/treasuryReader.ts) don't need this at all.

import { type Chain } from 'viem'
import { baseSepolia } from 'viem/chains'

/** The chain an org treasury can currently live on (matches rpcForChain / the pay page's chain
 *  dropdown). Returns null for anything else — callers should treat that as unsupported. */
export function viemChainFor(chainId: number): Chain | null {
  if (chainId === baseSepolia.id) return baseSepolia
  return null
}
