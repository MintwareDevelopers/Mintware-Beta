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
  { title: 'Get liquidity for our token', sub: 'Fund any share of the pair — the public matches the rest — or stage a single side.', dest: '/app/liquidity', tone: 'coral' },
  { title: 'Run our money', sub: 'Spend, cards, payroll, roles — the treasury terminal.', dest: '/app/team', tone: 'peri' },
  { title: 'Fund an AI agent', sub: 'A balance that earns while your agent spends it (x402).', dest: '/app/agents', tone: 'coral' },
]

type Step = 'track' | 'v2-pass' | 'context' | 'team-job'

export function LaunchModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('track')
  const [pw, setPw] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [pwErr, setPwErr] = useState('')
  const privy = useMintwarePrivy()
  const router = useRouter()

  // Every "Launch app" opens the SAME door: a two-track chooser. V1 = the live LP Gateway (open).
  // V2 = the full vision, password-gated "coming soon" for investors. Marketing pages are untouched.
  const launch = useCallback(() => {
    setStep('track')
    setPw('')
    setPwStatus('idle')
    setPwErr('')
    setOpen(true)
  }, [])

  // V1 track — straight to the live V1 platform. No gate; it's the live product.
  function goV1() {
    setOpen(false)
    router.push('/v1')
  }

  // V2 track — always the password gate. V2 is a "coming soon" investor preview, so the password is
  // the real door regardless of the site-wide V2 default (which keeps the marketing pages on V2).
  function pickV2() {
    setStep('v2-pass')
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwStatus === 'loading') return
    setPwStatus('loading')
    setPwErr('')
    try {
      const res = await fetch('/api/v2/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const d = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !d.ok) {
        throw new Error(
          d.error === 'wrong_password' ? 'Wrong password.'
          : d.error === 'gate_not_configured' ? 'The V2 preview isn’t configured here yet.'
          : d.error ?? 'Unlock failed',
        )
      }
      router.refresh() // server components now see the unlock cookie
      setStep('context')
      setPwStatus('idle')
    } catch (e2) {
      setPwErr((e2 as Error).message)
      setPwStatus('error')
    }
  }

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
            {step === 'track' ? (
              <div className="p-5 flex flex-col gap-3">
                <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink">Choose your track</h2>
                <p className="text-[13px] text-ink-mid leading-[1.5] -mt-1">V1 is live now. V2 is the full vision — an investor preview, behind a password.</p>
                <button
                  onClick={goV1}
                  className="mt-1 flex items-center justify-between gap-3 rounded-2xl border border-hair bg-white text-ink px-4 py-3.5 cursor-pointer hover:bg-ground-cool hover:border-[rgba(108,108,240,0.35)] min-h-[64px] text-left transition-colors"
                >
                  <span className="flex items-center gap-3.5 min-w-0">
                    <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: 'var(--color-peri)' }} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[15px]">V1 · Live</span>
                      <span className="block text-[12px] text-ink-mid leading-[1.4] mt-0.5">The live LP Gateway on Robinhood Chain — put USDG to work, earn trading fees.</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-ink-soft">→</span>
                </button>
                <button
                  onClick={pickV2}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-hair bg-white text-ink px-4 py-3.5 cursor-pointer hover:bg-ground-cool hover:border-[rgba(108,108,240,0.35)] min-h-[64px] text-left transition-colors"
                >
                  <span className="flex items-center gap-3.5 min-w-0">
                    <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: 'var(--color-coral2)' }} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[15px]">V2 · Coming soon <span aria-hidden className="text-ink-soft">🔒</span></span>
                      <span className="block text-[12px] text-ink-mid leading-[1.4] mt-0.5">The full vision — treasury OS, YPN, cards, agents. Password-protected investor preview.</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-ink-soft">→</span>
                </button>
              </div>
            ) : step === 'v2-pass' ? (
              <div className="p-5 flex flex-col gap-3">
                <button onClick={() => setStep('track')} className="self-start text-[12px] text-ink-soft hover:text-ink cursor-pointer">← Back</button>
                <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink -mt-1">V2 preview</h2>
                <p className="text-[13px] text-ink-mid leading-[1.5] -mt-1">The live product is the V1 LP Gateway. Enter the password to preview the full V2 vision.</p>
                <form onSubmit={submitPassword} className="flex flex-col gap-2.5 mt-1">
                  <input
                    type="password"
                    placeholder="Password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                    className="py-3 px-4 rounded-full bg-white border border-hair text-[14px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)]"
                    required
                  />
                  <button type="submit" disabled={pwStatus === 'loading'} className="glass-pill-primary disabled:opacity-60">
                    {pwStatus === 'loading' ? '…' : 'Unlock the vision →'}
                  </button>
                  {pwStatus === 'error' && <div className="text-[12.5px] text-[#D14343]">{pwErr}</div>}
                </form>
              </div>
            ) : step === 'context' ? (
              <div className="p-5 flex flex-col gap-3">
                <button onClick={() => setStep('track')} className="self-start text-[12px] text-ink-soft hover:text-ink cursor-pointer">← Back</button>
                <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-[1.15] text-ink -mt-1">How will you use Mintware?</h2>
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
