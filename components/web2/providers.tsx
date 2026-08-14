'use client'

import { PrivyProvider, type PrivyInterface, type PrivyProviderProps, usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth'
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi'
import { WagmiProvider, useAccount, type State } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/web3/wagmi'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { RefCodePrompt } from '@/components/rewards/referral/RefCodePrompt'
import { LaunchModalProvider } from './LaunchModal'
import { AppModeProvider } from './AppMode'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? ''
const PRIVY_ENABLED = PRIVY_APP_ID.length > 0

const PRIVY_CONFIG: PrivyProviderProps['config'] = {
  appearance: {
    theme: 'light',
    accentColor: '#0052FF',
    landingHeader: 'Bring a wallet or start with email',
    loginMessage: 'Privy helps onboarding, but Mintware still keys reputation to your wallet address.',
    showWalletLoginFirst: false,
    walletChainType: 'ethereum-only',
    walletList: ['detected_wallets', 'metamask', 'coinbase_wallet', 'rainbow', 'wallet_connect'],
  },
  loginMethods: ['wallet', 'email'],
  embeddedWallets: {
    // createOnLogin is 'off' on purpose. Privy 3.18's AUTOMATIC create-on-login
    // flow throws "Cannot destructure property 'onSuccess' of createWallet" — its
    // internal creation modal renders before its own callback store is populated,
    // which crashes the whole app right after a wallet-less (email) user logs in.
    // We provision the embedded wallet MANUALLY in PrivySessionBridge instead
    // (headless useCreateWallet), which populates that store and is crash-free.
    ethereum: { createOnLogin: 'off' },
    showWalletUIs: true,
  },
}

type MintwarePrivyContextValue = {
  enabled: boolean
  ready: boolean
  authenticated: boolean
  hasEmbeddedWallet: boolean
  embeddedWalletAddress: string | null
  evmWalletAddresses: string[]
  login: PrivyInterface['login']
  connectWallet: PrivyInterface['connectWallet']
  connectOrCreateWallet: PrivyInterface['connectOrCreateWallet']
  linkWallet: PrivyInterface['linkWallet']
  logout: PrivyInterface['logout']
}

const noop = () => {}
const noopAsync = async () => {}

const defaultPrivyContextValue: MintwarePrivyContextValue = {
  enabled: false,
  ready: true,
  authenticated: false,
  hasEmbeddedWallet: false,
  embeddedWalletAddress: null,
  evmWalletAddresses: [],
  login: noop,
  connectWallet: noop,
  connectOrCreateWallet: noop,
  linkWallet: noop,
  logout: noopAsync,
}

const MintwarePrivyContext = createContext<MintwarePrivyContextValue>(defaultPrivyContextValue)

export function useMintwarePrivy() {
  return useContext(MintwarePrivyContext)
}

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

function AppWalletProviders({ children }: { children: ReactNode }) {
  // Privy is the single wallet/connect layer — no RainbowKitProvider. Privy's own
  // modal (via LaunchModal → privy.login/connectWallet) handles external wallets
  // and email/embedded onboarding.
  return (
    <>
      <AppModeProvider>
        <LaunchModalProvider>
          {children}
        </LaunchModalProvider>
      </AppModeProvider>
      <GlobalReferralGate />
    </>
  )
}

function PrivySessionBridge({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
    login,
    connectWallet,
    connectOrCreateWallet,
    linkWallet,
    logout,
  } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { createWallet } = useCreateWallet()

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType?.startsWith('privy'))

  // Manually provision an embedded wallet for wallet-less (email/social) users.
  // We do this instead of Privy's automatic `createOnLogin` because that flow is
  // broken in 3.18 (see PRIVY_CONFIG). `createWallet()` is headless and no-ops for
  // users who already have a wallet. Guard: only when authenticated with zero
  // wallets, and only once (createWallet() throws if a wallet already exists).
  const provisioningRef = useRef(false)
  useEffect(() => {
    if (!ready || !walletsReady || !authenticated) return
    if (wallets.length > 0 || provisioningRef.current) return
    provisioningRef.current = true
    createWallet().catch((err) => {
      // "user already has an embedded wallet" is benign; anything else is logged.
      console.warn('[privy] embedded wallet provisioning skipped:', err)
    })
  }, [ready, walletsReady, authenticated, wallets.length, createWallet])
  const evmWalletAddresses = wallets
    .map((wallet) => wallet.address)
    .filter((address): address is string => /^0x[0-9a-fA-F]{40}$/.test(address))

  return (
    <MintwarePrivyContext.Provider
      value={{
        enabled: true,
        ready: ready && walletsReady,
        authenticated,
        hasEmbeddedWallet: !!embeddedWallet,
        embeddedWalletAddress: embeddedWallet?.address ?? null,
        evmWalletAddresses,
        login,
        connectWallet,
        connectOrCreateWallet,
        linkWallet,
        logout,
      }}
    >
      {children}
    </MintwarePrivyContext.Provider>
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

  if (!PRIVY_ENABLED) {
    return (
      <QueryClientProvider client={queryClient}>
        <MintwarePrivyContext.Provider value={defaultPrivyContextValue}>
          <WagmiProvider config={wagmiConfig} initialState={initialState}>
            <AppWalletProviders>
              {children}
            </AppWalletProviders>
          </WagmiProvider>
        </MintwarePrivyContext.Provider>
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
        <PrivySessionBridge>
          <PrivyWagmiProvider
            config={wagmiConfig}
            initialState={initialState}
            setActiveWalletForWagmi={({ wallets }) =>
              wallets.find((wallet) => wallet.walletClientType?.startsWith('privy')) ?? wallets[0]
            }
          >
            <AppWalletProviders>
              {children}
            </AppWalletProviders>
          </PrivyWagmiProvider>
        </PrivySessionBridge>
      </PrivyProvider>
    </QueryClientProvider>
  )
}
