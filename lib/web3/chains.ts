// Viem chain objects for the two YPN testnet chains. Base Sepolia ships built into viem/chains;
// Arc testnet doesn't (it's Circle's new USDC-native L1), so it's defined once here from the same
// public constants config/arc.ts already carries — no new source of truth, just the viem shape
// writeContract/signTypedData need. Read-only eth_calls (lib/org/treasuryReader.ts) don't need this
// at all; this is only for routes that actually sign/submit a transaction.

import { defineChain, type Chain } from 'viem'
import { baseSepolia } from 'viem/chains'
import { ARC_TESTNET } from '@/config/arc'

export const arcTestnetChain: Chain = defineChain({
  id: ARC_TESTNET.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, // Arc: USDC is the gas token
  rpcUrls: { default: { http: [ARC_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: 'Arcscan', url: ARC_TESTNET.explorer } },
  testnet: true,
})

/** The two chains an org treasury can currently live on (matches rpcForChain / the pay page's
 *  chain dropdown). Returns null for anything else — callers should treat that as unsupported. */
export function viemChainFor(chainId: number): Chain | null {
  if (chainId === ARC_TESTNET.chainId) return arcTestnetChain
  if (chainId === baseSepolia.id) return baseSepolia
  return null
}
