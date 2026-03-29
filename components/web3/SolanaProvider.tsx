'use client'

// =============================================================================
// components/web3/SolanaProvider.tsx
//
// Solana wallet adapter provider — wraps the app alongside wagmi.
// Supports: Phantom, Backpack, Solflare (the three dominant Solana wallets).
// RPC: public mainnet endpoint — zero cost, sufficient for score reads.
// =============================================================================

import { useMemo }                                from 'react'
import { ConnectionProvider, WalletProvider }    from '@solana/wallet-adapter-react'
import { WalletModalProvider }                   from '@solana/wallet-adapter-react-ui'
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'

// Free public RPC — no API key, no cost
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    // Backpack auto-detects via wallet standard — no adapter needed
  ], [])

  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
