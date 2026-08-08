// =============================================================================
// Attribution Engine v2 — Chainalysis Sanctions Oracle adapter (Risk).
//
// The sanctions HARD-GATE for the Risk signal: a free, on-chain smart-contract
// call `isSanctioned(address) → bool` (OFAC/EU/UN designations), needing only an
// RPC — no paid key. The designation list is the same across every EVM
// deployment, so we query one chain (Base, since the app already has its RPC).
// Graded illicit-exposure (mixer/scam beyond sanctions) is the paid TRM/Elliptic
// or Nansen tier — a later adapter.
//
// The on-chain reader is INJECTED so the mapping logic is unit-tested without a
// live chain; the default reader uses viem.
// =============================================================================

import type { RiskFlag } from '../types'

// Oracle deployments. Most EVM chains share one address; Base is distinct.
const ORACLE_STANDARD = '0x40C57923924B5c5c5455c48D93317139ADDaC8fb'
const ORACLE_BASE = '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B'

export const SANCTIONS_ORACLE: Record<number, `0x${string}`> = {
  1: ORACLE_STANDARD,      // ethereum
  10: ORACLE_STANDARD,     // optimism
  56: ORACLE_STANDARD,     // bnb
  137: ORACLE_STANDARD,    // polygon
  8453: ORACLE_BASE,       // base — distinct address
  42161: ORACLE_STANDARD,  // arbitrum
  43114: ORACLE_STANDARD,  // avalanche
}

export const SANCTIONS_ABI = [
  {
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'isSanctioned',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export function oracleFor(chainId: number): `0x${string}` | undefined {
  return SANCTIONS_ORACLE[chainId]
}

/** Pure: sanctioned boolean → a max-severity sanctions RiskFlag (or none). */
export function toSanctionsFlag(isSanctioned: boolean): RiskFlag | null {
  return isSanctioned ? { type: 'sanctioned', severity: 1 } : null
}

// Injected reader — resolves the oracle answer for (chainId, address).
export type SanctionReader = (args: {
  chainId: number
  oracle: `0x${string}`
  address: `0x${string}`
}) => Promise<boolean>

// Default reader: one `isSanctioned` eth_call via viem against the given chain.
const defaultSanctionReader: SanctionReader = async ({ oracle, address }) => {
  const { createPublicClient, http } = await import('viem')
  const { base } = await import('viem/chains')
  const rpc = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
  const client = createPublicClient({ chain: base, transport: http(rpc) })
  return (await client.readContract({
    address: oracle,
    abi: SANCTIONS_ABI,
    functionName: 'isSanctioned',
    args: [address],
  })) as boolean
}

export type SanctionsFetcher = (address: string) => Promise<RiskFlag | null>

/**
 * Bind a sanctions fetcher for the route to inject. Fails OPEN (returns null) on
 * any RPC error — a reputation score must not 500 because an RPC blipped; the
 * miss is logged upstream. `chainId` defaults to Base (its RPC is already wired).
 */
export function buildSanctionsFetcher(
  reader: SanctionReader = defaultSanctionReader,
  chainId = 8453,
): SanctionsFetcher {
  const oracle = oracleFor(chainId)
  return async (address: string) => {
    if (!oracle) return null
    try {
      const sanctioned = await reader({ chainId, oracle, address: address as `0x${string}` })
      return toSanctionsFlag(sanctioned)
    } catch {
      return null // fail open — never block a score on an RPC error
    }
  }
}
