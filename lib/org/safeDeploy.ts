// Deploy a team's treasury multisig (a Gnosis Safe) from the browser — no Safe SDK, just the
// canonical 1.4.1 factory via viem/wagmi. Owners are the team's Privy embedded wallets (passkey
// signers, no MetaMask); threshold is M-of-N. Pairs with vault.transferOwnership(safe) to put the
// treasury behind the multisig (P3 L2). Proven flow: this mirrors the cast deploy that produced the
// live 2-of-3 Safe on Base Sepolia.

import { encodeFunctionData, decodeEventLog, type Address, type Hex } from 'viem'
import { SAFE_BASE_SEPOLIA } from '@/config/treasury'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export const SAFE_SETUP_ABI = [
  {
    type: 'function', name: 'setup', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: '_owners', type: 'address[]' }, { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' }, { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' }, { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' }, { name: 'paymentReceiver', type: 'address' },
    ],
  },
] as const

export const SAFE_FACTORY_ABI = [
  {
    type: 'function', name: 'createProxyWithNonce', stateMutability: 'nonpayable',
    inputs: [{ name: '_singleton', type: 'address' }, { name: 'initializer', type: 'bytes' }, { name: 'saltNonce', type: 'uint256' }],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
  {
    type: 'event', name: 'ProxyCreation',
    inputs: [{ name: 'proxy', type: 'address', indexed: true }, { name: 'singleton', type: 'address', indexed: false }],
  },
] as const

export const VAULT_OWNABLE_ABI = [
  { type: 'function', name: 'transferOwnership', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
] as const

/** Safe.setup initializer for a fresh N-of-M multisig — no modules, no fallback handler, no payment. */
export function buildSafeInitializer(owners: Address[], threshold: number): Hex {
  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: 'setup',
    args: [owners, BigInt(threshold), ZERO, '0x', ZERO, ZERO, 0n, ZERO],
  })
}

/** Canonical Safe 1.4.1 addresses for a chain (Base Sepolia today). */
export function safeContractsFor(chainId: number): { proxyFactory: Address; singleton: Address } | null {
  if (chainId === 84532) {
    return { proxyFactory: SAFE_BASE_SEPOLIA.proxyFactory as Address, singleton: SAFE_BASE_SEPOLIA.singletonL2 as Address }
  }
  return null // other chains: add their canonical 1.4.1 deployment
}

/** Pull the deployed Safe address out of a createProxyWithNonce receipt's ProxyCreation event. */
export function safeAddressFromLogs(
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
): Address | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== SAFE_BASE_SEPOLIA.proxyFactory.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: SAFE_FACTORY_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data })
      if (ev.eventName === 'ProxyCreation') return (ev.args as { proxy: Address }).proxy
    } catch { /* not the ProxyCreation event */ }
  }
  return null
}
