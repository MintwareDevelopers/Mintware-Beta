'use client'

import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit'
import { WagmiProvider, useAccount, type State } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/web3/wagmi'
import { useEffect, useState, type ComponentType } from 'react'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { RefCodePrompt } from '@/components/rewards/referral/RefCodePrompt'

// ── Global referral gate — mounted inside every page ───────────────────────
// Checks if the connected wallet needs the ref code prompt and renders it.
function GlobalReferralGate() {
  const { address } = useAccount()
  const { showRefCodePrompt, setShowRefCodePrompt } = useReferral(address)

  if (!address || !showRefCodePrompt) return null

  return (
    <RefCodePrompt
      wallet={address}
      onDismiss={() => setShowRefCodePrompt(false)}
    />
  )
}

function MaybeSolanaProvider({ children }: { children: React.ReactNode }) {
  const [Provider, setProvider] = useState<ComponentType<{ children: React.ReactNode }> | null>(null)

  useEffect(() => {
    let active = true

    import('@/components/web3/SolanaProvider')
      .then((mod) => {
        if (active) setProvider(() => mod.SolanaProvider)
      })
      .catch(() => {
        // Fail open: keep the rest of the app rendering even if Solana deps are unavailable.
        if (active) setProvider(null)
      })

    return () => {
      active = false
    }
  }, [])

  if (!Provider) return <>{children}</>

  return <Provider>{children}</Provider>
}

export function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode
  initialState?: State
}) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: '#0052FF',
            accentColorForeground: 'white',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
          modalSize="compact"
        >
          <MaybeSolanaProvider>
            {children}
            <GlobalReferralGate />
          </MaybeSolanaProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
