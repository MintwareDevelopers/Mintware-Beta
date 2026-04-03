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

import { useMintwarePrivy } from '@/components/web2/providers'
import { useAccount, useDisconnect } from 'wagmi'
import { useWallet }                 from '@solana/wallet-adapter-react'
import { useCallback }               from 'react'
import { solanaEnabled }             from '@/lib/web3/featureFlags'

export type WalletChain = 'evm' | 'solana'
export type MintwareWalletType = 'external-evm' | 'privy-embedded' | 'solana' | null

export interface MintwareIdentity {
  address: string | null
  chain: WalletChain | null
  walletType: MintwareWalletType
  isConnected: boolean
  isAuthenticated: boolean
  canTransact: boolean
  isEmbeddedWallet: boolean
  isReady: boolean
  walletSettled: boolean
  evmStatus: ReturnType<typeof useAccount>['status']
  evmAddress: string | null
  solanaAddress: string | null
  embeddedWalletAddress: string | null
  linkedWallets: string[]
  disconnect: () => void
}

export function useMintwareIdentity(): MintwareIdentity {
  const { address: evmAddr, isConnected: evmConnected, status: evmStatus } = useAccount()
  const { publicKey, connected: solConnected, disconnect: solDisconnect } = useWallet()
  const { disconnect: evmDisconnect } = useDisconnect()
  const privy = useMintwarePrivy()

  const evmAddress = evmConnected && evmAddr ? evmAddr : null
  const solanaAddress = solanaEnabled && solConnected && publicKey ? publicKey.toBase58() : null
  const embeddedWalletAddress = privy.embeddedWalletAddress

  const address = evmAddress ?? embeddedWalletAddress ?? solanaAddress ?? null
  const chain: WalletChain | null = (evmAddress || embeddedWalletAddress) ? 'evm' : solanaAddress ? 'solana' : null
  const walletType: MintwareWalletType =
    evmAddress
      ? (embeddedWalletAddress && embeddedWalletAddress.toLowerCase() === evmAddress.toLowerCase() ? 'privy-embedded' : 'external-evm')
      : embeddedWalletAddress
        ? 'privy-embedded'
        : solanaAddress
          ? 'solana'
          : null
  const isConnected = !!address
  const isEmbeddedWallet = walletType === 'privy-embedded'
  const isAuthenticated = privy.authenticated || isConnected
  const canTransact = isConnected
  const isReady = !privy.enabled || privy.ready
  const walletSettled = isReady && (evmStatus === 'connected' || evmStatus === 'disconnected' || !!solanaAddress || !!embeddedWalletAddress)

  const linkedWallets = Array.from(new Set([
    ...privy.evmWalletAddresses.map((wallet) => wallet.toLowerCase()),
    ...(evmAddress ? [evmAddress.toLowerCase()] : []),
    ...(embeddedWalletAddress ? [embeddedWalletAddress.toLowerCase()] : []),
    ...(solanaAddress ? [solanaAddress] : []),
  ]))

  const disconnect = useCallback(() => {
    if (evmAddress) evmDisconnect()
    if (solanaAddress) solDisconnect()
    if (privy.authenticated) void privy.logout()
  }, [evmAddress, solanaAddress, evmDisconnect, solDisconnect, privy])

  return {
    address,
    chain,
    walletType,
    isConnected,
    isAuthenticated,
    canTransact,
    isEmbeddedWallet,
    isReady,
    walletSettled,
    evmStatus,
    evmAddress,
    solanaAddress,
    embeddedWalletAddress,
    linkedWallets,
    disconnect,
  }
}
