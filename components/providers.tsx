'use client'

import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit'
import { WagmiProvider, useAccount, type State } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/wagmi'
import { useState } from 'react'
import { useReferral } from '@/lib/referral/useReferral'
import { RefCodePrompt } from '@/components/referral/RefCodePrompt'

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
          {children}
          <GlobalReferralGate />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
