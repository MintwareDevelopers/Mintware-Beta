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
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { SOLANA_CLIENT_RPC_URL } from '@/config/solana'

export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => {
    if (!solanaEnabled) return []
    return [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      // Backpack auto-detects via wallet standard — no adapter needed
    ]
  }, [])

  return (
    <ConnectionProvider endpoint={SOLANA_CLIENT_RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect={solanaEnabled}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
