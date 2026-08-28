'use client'

// =============================================================================
// Homepage — design v2 (Privy-esque). "Never idle / never locked / always yours"
// hero, then the flagship vault engine, the Liquid Sovereign Account, the two
// vault products, and — in the "How it works" band — the real product loop:
// one deposit → earns three ways while staying liquid → spend the yield as USDC
// without unwinding. Closes on a gentle "Stay in the loop" capture.
// Live wiring kept: Privy launch, WaitlistForm.
// =============================================================================

import React from 'react'
import Link from 'next/link'
import { CountUp, Marquee } from '@/components/web2/motion'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useLaunch } from '@/components/web2/LaunchModal'
import { YieldPaymentNetworkSection } from '@/components/marketing/ypn/YieldPaymentNetworkSection'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { V2Nav } from '@/components/ui2/V2Nav'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'

const STATS = [
  { n: '3', k: 'Yield engines' },
  { n: 'V4', k: 'Uniswap hooks' },
  { n: 'USDC', k: 'Spendable yield' },
  { n: 'Base', k: 'In testing' },
]

// The real product loop that replaces the score-scorer band: one deposit, three jobs, spendable.
const STEPS = [
  { n: '01', t: 'Deposit', d: 'Put one balance to work — both sides of a pair into a vault, or a single asset into Savings.' },
  { n: '02', t: 'It earns three ways', d: 'Idle capital lends on Aave, provides just-in-time liquidity on Uniswap V4, and recaptures MEV — all from the same balance.' },
  { n: '03', t: 'Spend the yield', d: 'Draw it as USDC on a card or over x402. The position keeps earning while you spend — it never unwinds.' },
]

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const hotChip = 'text-[10px] font-semibold rounded-full px-2 py-1 bg-[rgba(108,108,240,0.1)] text-peri-deep border border-[rgba(108,108,240,0.22)]'

export default function HomePage() {
  const { isConnected } = useMintwareIdentity()
  const { launch: launchApp } = useLaunch()
  const launchLabel = isConnected ? 'Go to the app →' : 'Launch app →'

  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* HERO — the tagline: never idle / never locked / always yours (the three proofs) */}
      <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
        <AirbrushSplash tone="mix" />
        <div className="relative mx-auto max-w-[1180px] px-6 max-[800px]:px-4 pt-[104px] pb-[80px] max-[800px]:pt-[64px] max-[800px]:pb-[56px] flex flex-col items-center text-center">
          <span className="live-chip mb-6"><span className="dot" aria-hidden />One balance · three yield engines · always spendable</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.045em] leading-[1.02] text-[clamp(2.6rem,6.8vw,4.9rem)] max-w-[18ch] [text-wrap:balance]">
            Never idle.<br />Never locked.<br /><span className="text-gradient-accent">Always yours.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.05rem,1.7vw,1.3rem)] leading-[1.5] mt-6 max-w-[54ch]">
            Idle liquidity is a design flaw. Yours earns three ways at once — and its yield spends instantly, without ever unwinding your position.
          </p>

          <div className="mt-9 flex flex-wrap gap-3 items-center justify-center">
            <button onClick={() => launchApp()} className="glass-pill-primary">{launchLabel}</button>
            <a href="#how-it-works" className="text-[14px] font-medium text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">See how it works ↓</a>
          </div>
        </div>
      </section>

      {/* FLAGSHIP — the vault engine · dark pop band */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[48px] max-[800px]:py-[36px]">
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(58% 120% at 12% 0%, rgba(108,108,240,0.38), transparent 60%), radial-gradient(52% 130% at 100% 100%, rgba(244,161,131,0.16), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[72px] max-[800px]:py-[52px] flex items-center justify-between gap-8 flex-wrap">
              <div className="max-w-[760px]">
                <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-pas-peri">The vault engine · never idle</div>
                <h2 className="font-atx-display font-semibold tracking-[-0.04em] leading-[1.03] text-[clamp(2rem,4.6vw,3.4rem)] mt-4 text-white [text-wrap:balance]">
                  Your capital earns <span className="text-gradient-accent">three ways at once.</span>
                </h2>
                <p className="text-[15px] leading-[1.55] mt-4 max-w-[54ch]" style={{ color: '#C7C7DC' }}>
                  One balance runs three engines — Aave lending, Uniswap v4 market-making, and recaptured MEV. In testing on Base Sepolia.
                </p>
              </div>
              <button onClick={() => launchApp('/app/vaults')} className="glass-pill-primary whitespace-nowrap shrink-0">Explore the vaults →</button>
            </div>
          </div>
        </div>
      </section>

      {/* LIQUID SOVEREIGN ACCOUNT — liquidity as a public good */}
      <YieldPaymentNetworkSection />

      {/* AMBIENT TICKER — evergreen facts, in motion */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <Marquee className="py-3" speed={38} items={
          ['Three yield engines', 'MEV-protected Uniswap V4', 'Spendable while earning', 'Non-custodial by design', 'In testing on Base Sepolia', 'Idle liquidity is a design flaw']
            .map((t) => (
              <span className="text-[11px] uppercase tracking-[0.16em] font-medium text-ink-mid px-5">
                <span className="text-peri mr-5">◆</span>{t}
              </span>
            ))
        } />
      </div>

      {/* TWO VAULT PRODUCTS */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className={ey}>Two ways to earn</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.2vw,2.6rem)] mt-3 [text-wrap:balance]">
                The same liquidity, <span className="text-gradient-accent">two different jobs.</span>
              </h2>
            </div>
            <span className="live-chip"><span className="dot" aria-hidden />In testing on Base — not yet live</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8 max-[820px]:grid-cols-1">
            {/* Card 1 — Growth Vaults */}
            <div className="soft-card flex flex-col overflow-hidden">
              <div className="p-6 border-b border-hair-soft">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-atx-display text-[19px] font-medium text-ink">Growth Vaults</span>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">For tokens &amp; treasuries</span>
                </div>
                <p className="text-[14px] leading-[1.5] text-ink-mid mt-2.5">
                  MEV-protected, auto-managed LP on Uniswap V4. Your lock tier lifts your fee share over the wallet beside you — longer commitment, larger share.
                </p>
              </div>
              <div className="p-6 bg-ground-cool">
                <div className="text-[9px] uppercase tracking-[0.12em] text-ink-soft mb-2.5">Illustrative example · not a projection</div>
                <div className="flex items-baseline justify-between rounded-2xl border border-hair px-4 py-3 bg-white">
                  <span className="font-atx-display text-[22px] font-medium tracking-tight text-ink">5,000</span>
                  <span className="text-[11px] text-ink-soft">USDC</span>
                </div>
                <div className="mt-3">
                  <Bdr k="Swap fees + MEV" v="8.5%" />
                  <Bdr k="Idle-capital yield" v="+0.6%" />
                  <div className="flex items-center justify-between py-2 border-b border-hair-soft text-[12px] text-ink-mid">
                    <span className="flex items-center gap-2">
                      Lock-tier bonus
                      <span className={hotChip}>90-day lock</span>
                    </span>
                    <span className="tabular-nums">×1.3</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft">Example APY</span>
                  <span className="font-atx-display font-medium text-[24px] tracking-tight text-coral2-deep tabular-nums"><CountUp value={10.4} decimals={1} suffix="%" /></span>
                </div>
              </div>
              <button onClick={() => launchApp('/app/vaults')} className="mt-auto p-5 flex justify-center border-t border-hair-soft cursor-pointer">
                <span className="glass-pill glass-pill-sm pointer-events-none">Browse Growth vaults →</span>
              </button>
            </div>

            {/* Card 2 — Matched Liquidity */}
            <div className="soft-card flex flex-col overflow-hidden">
              <div className="p-6 border-b border-hair-soft">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-atx-display text-[19px] font-medium text-ink">Matched Liquidity</span>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">For teams</span>
                </div>
                <p className="text-[14px] leading-[1.5] text-ink-mid mt-2.5">
                  Teams lock their token. The community matches in USDC — real depth, tighter spreads, better fills. During the lock, every fee earned goes to the community.
                </p>
              </div>
              <div className="p-6 bg-ground-cool flex-1">
                <div className="grid grid-cols-2 gap-2.5">
                  {[['Team locks', 'its own token'], ['Community', 'matches in USDC'], ['Hard cliff', '≥ 90 days'], ['During lock', 'team earns 0%']].map(([k, v]) => (
                    <div key={k} className="rounded-2xl bg-white border border-hair px-3.5 py-3.5">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-ink-soft">{k}</div>
                      <div className="font-atx-display text-[14px] font-medium mt-0.5 text-ink">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-ink-soft leading-[1.5] mt-3">
                  A restriction on withdrawal, not a transfer of ownership — enforced by the contract.
                </p>
              </div>
              <Link href="/teams" className="mt-auto p-5 flex justify-center border-t border-hair-soft no-underline">
                <span className="glass-pill glass-pill-sm">See how it works →</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 grid grid-cols-4 max-[720px]:grid-cols-2">
          {STATS.map((s, i) => (
            <div key={s.k} className={`px-5 py-8 ${i < 3 ? 'border-r border-hair-soft' : ''} max-[720px]:border-b max-[720px]:border-hair-soft`}>
              <div className="font-atx-display text-[28px] font-medium tracking-[-0.03em] text-ink">{s.n}</div>
              <div className="text-[9px] uppercase tracking-[0.14em] font-semibold text-ink-soft mt-1.5">{s.k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS — the real product loop: one deposit → earns three ways → spend the yield */}
      <section id="how-it-works" className="bg-white border-b border-hair-soft scroll-mt-[70px]">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className={ey}>How it works</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(1.8rem,3.4vw,2.8rem)] max-w-[22ch] mt-3.5 [text-wrap:balance]">
                One deposit. Three jobs. <span className="text-gradient-accent">Always spendable.</span>
              </h2>
            </div>
            <span className="live-chip"><span className="dot" aria-hidden />In testing on Base Sepolia — not yet live</span>
          </div>
          <p className="text-ink-mid text-[16px] leading-[1.55] max-w-[60ch] mt-4">
            Your liquidity earns three ways at once — and its yield spends instantly as USDC, without ever unwinding your position.
          </p>

          <div className="grid grid-cols-3 gap-4 mt-9 max-[820px]:grid-cols-1">
            {STEPS.map((s) => (
              <div key={s.n} className="soft-card p-6 flex flex-col gap-3">
                <span className="font-atx-display text-[13px] font-semibold tracking-[0.08em] text-peri-deep tabular-nums">{s.n}</span>
                <div className="font-atx-display text-[19px] font-medium text-ink">{s.t}</div>
                <p className="text-[13.5px] leading-[1.55] text-ink-mid">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="text-[12px] text-ink-mid mt-6 tracking-[0.01em]">
            <b className="text-peri-deep">↳</b> One balance, three engines, spendable the whole time — nothing sits idle, nothing locks up.
          </div>
        </div>
      </section>

      {/* STAY IN THE LOOP — gentle email capture */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <GradientPanel tone="coral" className="p-10 max-[800px]:p-6 grid [grid-template-columns:1fr_0.9fr] gap-10 items-center max-[720px]:grid-cols-1 max-[720px]:gap-6">
            <div>
              <div className={ey}>Stay in the loop</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.1] text-[clamp(1.5rem,2.6vw,2.1rem)] mt-3 [text-wrap:balance]">
                New vaults, cards, and agent rails, <span className="text-gradient-accent">before anyone else.</span>
              </h2>
              <p className="text-[15px] text-ink-mid mt-2.5 max-w-[46ch]">Early access to what&apos;s next. No spam, just the good stuff.</p>
            </div>
            <WaitlistForm />
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}

function Bdr({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-hair-soft text-[12px] text-ink-mid">
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  )
}

// ─── Waitlist form (v2, gentle) ──────────────────────────────────────────────
function WaitlistForm() {
  const [email, setEmail] = React.useState('')
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = React.useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading' || status === 'done') return
    setStatus('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Something went wrong')
      setStatus('done')
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="rounded-full bg-white/70 backdrop-blur-[10px] border border-hair text-[13px] font-medium py-3.5 px-5 text-ink inline-flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" /> You’re on the list
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      <div className="flex gap-2.5 max-[480px]:flex-col">
        <input
          className="flex-1 min-w-0 py-3.5 px-5 rounded-full bg-white border border-hair font-atx-display text-[14px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)] placeholder:text-ink-soft"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" disabled={status === 'loading'} className="glass-pill whitespace-nowrap disabled:opacity-60">
          {status === 'loading' ? '…' : 'Notify me'}
        </button>
      </div>
      {status === 'error' && <div className="text-[12px] text-[#D14343]">{errMsg}</div>}
    </form>
  )
}
