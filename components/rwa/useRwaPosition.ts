'use client'

// A wallet's senior (liquidity-provider) position in an RWA unit, read straight from the vault on its chain.
// Senior shares are a non-transferable ledger (`seniorShares[addr]`), valued here at the mint-side par NAV
// (`convertToAssets`); the redeemable amount can be lower in a tail event (the vault prices exits at
// min(par, realizable)) — the panel says so.

import { useReadContracts } from 'wagmi'
import type { RwaUnit } from '@/lib/rwa/demo'

export const RWA_VAULT_ABI = [
  { type: 'function', name: 'seniorShares', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 's', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'previewDeposit', stateMutability: 'view', inputs: [{ name: 'a', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'activated', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'depositUSDC', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'minShares', type: 'uint256' }, { name: 'to', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'redeemSenior', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'minAssets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

export function useRwaPosition(u: RwaUnit, address?: `0x${string}`) {
  const vault = u.demo.contracts.vault as `0x${string}`
  const usd = u.demo.contracts.usd as `0x${string}`
  const chainId = u.chain.id
  const who = address ?? '0x0000000000000000000000000000000000000000'
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: vault, abi: RWA_VAULT_ABI, functionName: 'seniorShares', args: [who], chainId },
      { address: usd, abi: ERC20_ABI, functionName: 'balanceOf', args: [who], chainId },
      { address: usd, abi: ERC20_ABI, functionName: 'allowance', args: [who, vault], chainId },
      { address: vault, abi: RWA_VAULT_ABI, functionName: 'activated', chainId },
      { address: vault, abi: RWA_VAULT_ABI, functionName: 'paused', chainId },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  const [sharesR, balR, allowR, actR, pausedR] = q.data ?? []
  const shares = (sharesR?.result as bigint | undefined) ?? 0n
  const value = useReadContracts({
    allowFailure: true,
    contracts: [{ address: vault, abi: RWA_VAULT_ABI, functionName: 'convertToAssets', args: [shares], chainId }],
    query: { enabled: !!address && shares > 0n, refetchInterval: 15_000 },
  })
  return {
    shares,
    valueAtomic: shares > 0n ? ((value.data?.[0]?.result as bigint | undefined) ?? 0n) : 0n,
    usdBalance: (balR?.result as bigint | undefined) ?? 0n,
    allowance: (allowR?.result as bigint | undefined) ?? 0n,
    activated: actR?.result as boolean | undefined,
    paused: pausedR?.result as boolean | undefined,
    loading: q.isLoading,
    refetch: () => { q.refetch(); value.refetch() },
  }
}
