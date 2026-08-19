'use client'

// LaunchModal — the app door. Every "Launch app" entry point calls
// useLaunch().launch(); it opens ONE modal that first GATES on context —
// Individual (Retail LP) vs Team (Treasury). Picking a context sets the app mode
// and routes into the matching surface. Phase 1 is a SOFT gate: no sign-in required
// to showcase either side (wallet connect is optional, available inside the app).
// A Privy wallet/email connect is still offered as a secondary path.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useMintwarePrivy } from './providers'
import { persistAppMode, appModeHome, type AppMode } from './AppMode'

const LaunchCtx = createContext<{ launch: (dest?: string) => void } | null>(null)

export function useLaunch() {
  const ctx = useContext(LaunchCtx)
  if (!ctx) throw new Error('useLaunch must be used within <LaunchModalProvider>')
  return ctx
}

const MODES: { mode: AppMode; title: string; sub: string; tone: 'peri' | 'coral' }[] = [
  { mode: 'user', title: 'I’m an individual', sub: 'Deposit into vaults and earn — your personal LP portal.', tone: 'peri' },
  { mode: 'team', title: 'I’m a team', sub: 'Manage a treasury, curate vaults, and run cards.', tone: 'coral' },
]

// Team intake — job-first, not a feature menu. Screen on the OUTCOME the team wants and route
// them straight to the ready surface. Machinery (matched-liquidity vault, Aave yield, cards) stays
// invisible; the label is the job. "Get liquidity" is the capital-constrained / staged-buffer path.
const TEAM_JOBS: { title: string; sub: string; dest: string; tone: 'peri' | 'coral' }[] = [
  { title: 'Earn on our idle cash', sub: 'Put treasury USDC to work — yield from day one.', dest: '/app/org', tone: 'peri' },
  { title: 'Get liquidity for our token', sub: 'Only hold one side? Stage it, earn, and pair when a match arrives.', dest: '/app/liquidity', tone: 'coral' },
  { title: 'Run our money', sub: 'Spend, cards, payroll, roles — the treasury terminal.', dest: '/app/team', tone: 'peri' },
  { title: 'Fund an AI agent', sub: 'A balance that earns while your agent spends it (x402).', dest: '/app/agents', tone: 'coral' },
]

type Step = 'context' | 'team-job'

export function LaunchModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('context')
  const privy = useMintwarePrivy()
  const router = useRouter()

  // Every launch reopens at the context gate (Individual / Team).
  const launch = useCallback(() => { setStep('context'); setOpen(true) }, [])

  // Connect-first: prompt Privy when signed out, so a choice both ENTERS and CONNECTS in one click.
  function connectIfNeeded() {
    if (!privy.authenticated) {
      privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })
    }
  }

  function pick(mode: AppMode) {
    persistAppMode(mode)
    if (mode === 'team') { setStep('team-job'); return } // teams get the job intake before routing
    setOpen(false)
    router.push(appModeHome(mode))
    connectIfNeeded()
  }

  function pickJob(dest: string) {
    persistAppMode('team')
    setOpen(false)
    router.push(dest)
    connectIfNeeded()
  }

  return (
    <LaunchCtx.Provider value={{ launch }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[300] grid place-items-center p-4 font-atx-display" role="dialog" aria-modal="true" aria-label="Launch Mintware">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[440px] rounded-[var(--radius-panel)] border border-hair bg-white shadow-lift overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
              <span className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-soft">Launch Mintware</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-2 -m-2 text-ink-soft hover:text-ink text-[15px] cursor-pointer">✕</button>
            </div>
            {step === 'context' ? (
              <div className="p-5 flex flex-col gap-3">
                <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink">How will you use Mintware?</h2>
                <p className="text-[13px] text-ink-mid leading-[1.5] -mt-1">Pick a starting point — you can switch anytime.</p>
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    onClick={() => pick(m.mode)}
                    className="mt-1 flex items-center justify-between gap-3 rounded-2xl border border-hair bg-white text-ink px-4 py-3.5 cursor-pointer hover:bg-ground-cool hover:border-[rgba(108,108,240,0.35)] min-h-[64px] text-left transition-colors"
                  >
                    <span className="flex items-center gap-3.5 min-w-0">
                      <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: m.tone === 'coral' ? 'var(--color-coral2)' : 'var(--color-peri)' }} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-[15px]">{m.title}</span>
                        <span className="block text-[12px] text-ink-mid leading-[1.4] mt-0.5">{m.sub}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-ink-soft">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-5 flex flex-col gap-3">
                <button onClick={() => setStep('context')} className="self-start text-[12px] text-ink-soft hover:text-ink cursor-pointer">← Back</button>
                <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink -mt-1">What do you want to do first?</h2>
                <p className="text-[13px] text-ink-mid leading-[1.5] -mt-1">We’ll take you straight there. Everything else is one click away inside.</p>
                {TEAM_JOBS.map((j) => (
                  <button
                    key={j.title}
                    onClick={() => pickJob(j.dest)}
                    className="mt-1 flex items-center justify-between gap-3 rounded-2xl border border-hair bg-white text-ink px-4 py-3.5 cursor-pointer hover:bg-ground-cool hover:border-[rgba(108,108,240,0.35)] min-h-[64px] text-left transition-colors"
                  >
                    <span className="flex items-center gap-3.5 min-w-0">
                      <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: j.tone === 'coral' ? 'var(--color-coral2)' : 'var(--color-peri)' }} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-[15px]">{j.title}</span>
                        <span className="block text-[12px] text-ink-mid leading-[1.4] mt-0.5">{j.sub}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-ink-soft">→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </LaunchCtx.Provider>
  )
}
