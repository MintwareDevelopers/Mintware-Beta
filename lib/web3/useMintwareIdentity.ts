// =============================================================================
// lib/web3/useMintwareIdentity.ts
//
// Unified identity hook — abstracts EVM (wagmi) and Solana (wallet-adapter)
// into a single interface. Either wallet can be the primary session.
//
// Usage:
//   const { address, chain, isConnected, disconnect } = useMintwareIdentity()
//
// address — the active wallet address (0x... for EVM, base58 for Solana)
// chain   — 'evm' | 'solana' | null
// =============================================================================

'use client'

import { useAccount, useDisconnect } from 'wagmi'
import { useWallet }                 from '@solana/wallet-adapter-react'
import { useCallback }               from 'react'
import { solanaEnabled }             from '@/lib/web3/featureFlags'

export type WalletChain = 'evm' | 'solana'

export interface MintwareIdentity {
  address:       string | null
  chain:         WalletChain | null
  isConnected:   boolean
  evmAddress:    string | null
  solanaAddress: string | null
  disconnect:    () => void
}

export function useMintwareIdentity(): MintwareIdentity {
  const { address: evmAddr, isConnected: evmConnected } = useAccount()
  const { publicKey, connected: solConnected, disconnect: solDisconnect } = useWallet()
  const { disconnect: evmDisconnect } = useDisconnect()

  const evmAddress    = evmConnected && evmAddr ? evmAddr : null
  const solanaAddress = solanaEnabled && solConnected && publicKey ? publicKey.toBase58() : null

  // EVM takes priority if both are connected (rare edge case)
  const address = evmAddress ?? solanaAddress ?? null
  const chain: WalletChain | null = evmAddress ? 'evm' : solanaAddress ? 'solana' : null
  const isConnected = !!address

  const disconnect = useCallback(() => {
    if (evmAddress) evmDisconnect()
    if (solanaAddress) solDisconnect()
  }, [evmAddress, solanaAddress, evmDisconnect, solDisconnect])

  return { address, chain, isConnected, evmAddress, solanaAddress, disconnect }
}
