'use client'

// LaunchModal — one onboarding flow for the whole app. Every "Launch app" entry
// point calls useLaunch().launch(dest); if the user is already connected it routes
// straight in, otherwise it opens ONE modal offering both paths: connect an
// existing wallet (Privy's wallet picker) or start with just an email (Privy creates a wallet).
// This replaces the confusing "Launch app" + separate "Email" button pair.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useMintwarePrivy } from './providers'

const LaunchCtx = createContext<{ launch: (dest?: string) => void } | null>(null)

export function useLaunch() {
  const ctx = useContext(LaunchCtx)
  if (!ctx) throw new Error('useLaunch must be used within <LaunchModalProvider>')
  return ctx
}

export function LaunchModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { isConnected } = useAccount()
  const privy = useMintwarePrivy()
  const router = useRouter()

  const launch = useCallback((dest = '/app') => {
    if (isConnected) { router.push(dest); return }   // already in → go straight to the app
    setOpen(true)
  }, [isConnected, router])

  // Both paths go through Privy (the single wallet layer). Wallet users get Privy's
  // external-wallet picker; email users get the email → embedded-wallet flow. If a
  // Privy session already exists, connect/link an external wallet instead of re-login.
  function chooseWallet() {
    setOpen(false)
    if (privy.authenticated) { privy.connectWallet(); return }
    privy.login({ loginMethods: ['wallet'], walletChainType: 'ethereum-only' })
  }
  function chooseEmail() {
    setOpen(false)
    if (privy.authenticated) { privy.connectOrCreateWallet(); return }
    privy.login({ loginMethods: ['email'], walletChainType: 'ethereum-only' })
  }

  return (
    <LaunchCtx.Provider value={{ launch }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[300] grid place-items-center p-4 font-atx-display" role="dialog" aria-modal="true" aria-label="Launch Mintware">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[420px] rounded-[var(--radius-panel)] border border-hair bg-white shadow-lift overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
              <span className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-soft">Launch Mintware</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-2 -m-2 text-ink-soft hover:text-ink text-[15px] cursor-pointer">✕</button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink">Get started</h2>
              <p className="text-[13px] text-ink-mid leading-[1.5] -mt-1">
                Connect a wallet you already have — or start with just an email and we’ll create one for you.
              </p>

              <button onClick={chooseWallet} className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-peri text-white px-4 py-3.5 cursor-pointer min-h-[56px] text-left transition-colors hover:bg-peri-deep">
                <span>
                  <span className="block font-semibold text-[15px]">Connect a wallet</span>
                  <span className="block text-[9.5px] uppercase tracking-[0.08em] text-white/70 mt-0.5">MetaMask · Rainbow · Coinbase · WalletConnect</span>
                </span>
                <span className="shrink-0">→</span>
              </button>

              {privy.enabled && (
                <button onClick={chooseEmail} className="flex items-center justify-between gap-3 rounded-2xl border border-hair bg-white text-ink px-4 py-3.5 cursor-pointer hover:bg-ground-cool min-h-[56px] text-left transition-colors">
                  <span>
                    <span className="block font-semibold text-[15px]">I don’t have a wallet</span>
                    <span className="block text-[9.5px] uppercase tracking-[0.08em] text-ink-soft mt-0.5">Continue with email — no wallet needed</span>
                  </span>
                  <span className="shrink-0 text-ink-soft">→</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </LaunchCtx.Provider>
  )
}
