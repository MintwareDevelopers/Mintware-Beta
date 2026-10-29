'use client'

// =============================================================================
// Homepage — vision rework (2026-08). Confidence-first, bands that BUILD instead
// of loop: ① the promise · ② WHAT WE ARE (Uniswap V4 vaults for everyone — the
// pros' market-making engine, with an illustrative APY comparison vs a plain USDC
// lender) · ③ the Liquid Sovereign Account · ④ THE CARD (the wow — spend the
// yield, not the position) · ⑤ how the engine earns · ⑥ three doors (You / Teams
// / Agents) · ⑦ the honest handshake ("every claim has an on-chain receipt").
// Live wiring kept: Privy launch, WaitlistForm.
// =============================================================================

import React from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useLaunch } from '@/components/web2/LaunchModal'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { V2Nav } from '@/components/ui2/V2Nav'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'
import { useV2Mode } from '@/components/web2/V2ModeProvider'
import { HomeV1 } from '@/components/web2/HomeV1'
import { LiveTodayStrip } from '@/components/web2/LiveTodayStrip'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

// V1 (default) shows the current MarketEngine testnet entry point; V2 (unlocked) shows the product vision below.
export default function HomePage() {
  return useV2Mode() ? <HomeV2 /> : <HomeV1 />
}

const ENGINES = [
  { n: '01', t: 'Best-rate lending', d: 'Designed to route idle capital to lending venues as rates move, rather than park it in one place.' },
  { n: '02', t: 'Market-making', d: 'The planned engine adds just-in-time Uniswap V4 depth around trades, with swap fees accruing to liquidity.' },
  { n: '03', t: 'Recaptured MEV', d: 'The design aims to return some value otherwise captured by bots to liquidity providers.' },
]

const DOORS = [
  { glyph: '🧍', t: 'You', d: 'The planned Liquid Sovereign Account: cash designed to earn while it stays spendable, including through a future card.', tag: 'In development', tagLive: false, go: 'Explore the vision →', href: '/yield-payment-network' },
  { glyph: '👥', t: 'Teams', d: 'A treasury roadmap spanning matched liquidity, cards, payroll, and role-capped spend.', tag: 'Roadmap', tagLive: false, go: 'See the roadmap →', href: '/teams' },
  { glyph: '🤖', t: 'Agents', d: 'The x402 parking-account concept is designed to let idle USDC earn between per-call payments.', tag: 'Designed for agents', tagLive: false, go: 'Explore agent tools →', href: '/agents' },
]

function HomeV2() {
  const { isConnected } = useMintwareIdentity()
  const { launch: launchApp } = useLaunch()
  const launchLabel = isConnected ? 'Go to the app →' : 'Launch app →'

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* ① HERO — the product vision */}
      <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
        <AirbrushSplash tone="mix" />
        <div className="relative mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] pt-[96px] pb-[88px] max-[640px]:pt-[60px] max-[640px]:pb-[56px] flex flex-col items-center text-center">
          <span className="live-chip mb-6"><span className="dot" aria-hidden />Account in development</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.045em] leading-[1.02] text-[clamp(2.7rem,7vw,5.1rem)] [text-wrap:balance]">
            Never idle.<br />Never locked.<br /><span className="text-gradient-accent">Always yours.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.28rem)] leading-[1.55] mt-6 max-w-[56ch]">
            Money shouldn’t have to choose between earning and being spendable. The planned account is designed to do both, without unwinding or lockups.
          </p>
          <div className="mt-9 flex flex-wrap gap-3.5 items-center justify-center">
            <button onClick={() => launchApp()} className="glass-pill-primary">{launchLabel}</button>
            <a href="#how" className="text-[14.5px] font-semibold text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">See how it works ↓</a>
          </div>
        </div>
      </section>

      {/* Current MarketEngine testnet status and a link to its historical proof. */}
      <LiveTodayStrip />

      {/* ② WHAT WE ARE — Uniswap V4 vaults for everyone (comes out swinging, states it directly) */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className="grid grid-cols-[1.05fr_0.95fr] gap-[44px] items-center max-[860px]:grid-cols-1 max-[860px]:gap-9">
            <div>
              <div className={ey}>Designed for Uniswap V4</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
                The market-making engine the pros use, <span className="text-gradient-accent">opened to everyone.</span>
              </h2>
              <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.2rem)] leading-[1.55] mt-[18px] max-w-[46ch]">
                Mintware is designing a Uniswap&nbsp;V4 vault to combine lending, swap fees, and MEV recapture in one automated strategy.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> Three planned engines, one balance.</div>
            </div>

            {/* illustrative APY comparison — the lender's whole rate is our first segment */}
            <div className="soft-card p-[26px]">
              <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Illustrative design target — not current yield</div>
              <div className="flex items-end justify-center gap-8 h-[210px] mt-4">
                {/* lender */}
                <div className="flex-1 max-w-[110px] flex flex-col items-center justify-end h-full">
                  <div className="font-mono font-bold text-[15px] text-ink-mid mb-2">~5.0%</div>
                  <div className="w-full rounded-[7px] bg-[rgba(138,138,158,0.45)]" style={{ height: '83px' }} />
                </div>
                {/* mintware — stacked */}
                <div className="flex-1 max-w-[110px] flex flex-col items-center justify-end h-full">
                  <div className="font-mono font-bold text-[15px] text-peri-deep mb-2">~10.0%</div>
                  <div className="w-full flex flex-col rounded-[7px] overflow-hidden">
                    <div className="w-full bg-coral2" style={{ height: '27px' }} title="Recaptured MEV" />
                    <div className="w-full bg-peri-mid" style={{ height: '57px' }} title="Swap fees" />
                    <div className="w-full bg-peri" style={{ height: '83px' }} title="Lending" />
                  </div>
                </div>
              </div>
              <div className="flex justify-center gap-8 mt-3 text-center">
                <div className="flex-1 max-w-[110px]"><div className="text-[12.5px] font-semibold text-ink">USDC lender</div><div className="text-[11px] text-ink-soft">one job · lending</div></div>
                <div className="flex-1 max-w-[110px]"><div className="text-[12.5px] font-semibold text-ink">Planned vault</div><div className="text-[11px] text-ink-soft">three jobs</div></div>
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-hair-soft text-[11px] text-ink-mid flex-wrap">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-peri inline-block" />Lending</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-peri-mid inline-block" />Swap fees</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-coral2 inline-block" />Recaptured MEV</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ③ THE IDEA — the Liquid Sovereign Account */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className="grid grid-cols-[1.05fr_0.95fr] gap-[44px] items-center max-[860px]:grid-cols-1 max-[860px]:gap-8">
            <div>
              <div className={ey}>The Liquid Sovereign Account</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
                One balance,<br /><span className="text-gradient-accent">earning and spendable at once.</span>
              </h2>
              <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.2rem)] leading-[1.55] mt-[18px] max-w-[46ch]">
                The account is designed for dollars to earn while staying spendable by card or transfer, without cashing out or unwinding a thing.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> The yield is what you spend. The balance stays put.</div>
            </div>

            {/* balance card */}
            <div className="soft-card p-[30px]">
              <div className="flex justify-between items-start">
                <div>
                <div className="text-[12px] uppercase tracking-[0.1em] text-ink-soft font-semibold">Illustrative balance</div>
                  <div className="font-atx-display font-semibold text-[clamp(2.4rem,5vw,3.3rem)] tracking-[-0.03em] mt-1.5 tabular-nums">$12,480<span className="text-[0.5em] text-ink-soft">.00</span></div>
                </div>
                <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-mw-green-muted text-mw-green"><span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />design</span>
              </div>
              <div className="flex gap-2.5 mt-[22px] flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-mw-green-muted text-mw-green">↑ yield planned</span>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-[rgba(108,108,240,0.11)] text-peri-deep">◆ designed for spending</span>
              </div>
              <div className="flex justify-between mt-5 pt-[18px] border-t border-hair-soft text-[13px] text-ink-soft">
                <span>Position</span><span className="text-ink font-medium">untouched</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ③ THE CARD — the wow */}
      <section id="card" className="border-b border-hair-soft relative overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(108,108,240,0.10), rgba(240,133,94,0.11) 130%)' }}>
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className="grid grid-cols-2 gap-[52px] items-center max-[900px]:grid-cols-1 max-[900px]:gap-9">
            <div>
              <div className={ey}>The card</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
                A card designed to spend accrued <span className="text-gradient-accent">yield</span>, not the position.
              </h2>
              <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.2rem)] leading-[1.55] mt-[18px] max-w-[44ch]">
                The planned card is designed to spend accrued yield while your position stays in place. Authorization and merchant settlement are future work.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> Illustrative future card experience.</div>
            </div>

            {/* card scene — the receipt fills in tap → authorized → settled → still earning, on scroll */}
            <CardScene />
          </div>
        </div>
      </section>

      {/* ④ HOW IT WORKS — the engine, once */}
      <section id="how" className="bg-ground-cool border-b border-hair-soft scroll-mt-[70px]">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className={ey}>How it works</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
            How a dollar earns while you spend it.
          </h2>
          <div className="grid grid-cols-3 gap-[18px] mt-[38px] max-[820px]:grid-cols-1">
            {ENGINES.map((e) => (
              <div key={e.n} className="soft-card p-[26px]">
                <div className="font-mono font-bold text-peri-deep text-[13px]">{e.n}</div>
                <h3 className="font-atx-display font-semibold text-[18px] mt-3 mb-2 text-ink">{e.t}</h3>
                <p className="text-[13.5px] text-ink-mid leading-[1.55]">{e.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-[26px] text-[14.5px] text-ink-mid rounded-[14px] px-5 py-4 bg-[rgba(108,108,240,0.06)] border border-[rgba(108,108,240,0.14)]">
            <b className="text-ink">The design spends yield, not the position.</b> A future payment would hold against the earning balance, then settle only the amount due.
          </div>
        </div>
      </section>

      {/* ⑤ THREE DOORS */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className={ey}>Who it’s for</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
            Built for whoever holds the balance.
          </h2>
          <div className="grid grid-cols-3 gap-[18px] mt-[38px] max-[820px]:grid-cols-1">
            {DOORS.map((d) => (
              <Link key={d.t} href={d.href} className="soft-card p-[28px] flex flex-col no-underline group hover:shadow-card-hover transition-shadow">
                <div className="w-[42px] h-[42px] rounded-[12px] grid place-items-center text-[20px] bg-[rgba(108,108,240,0.1)]">{d.glyph}</div>
                <h3 className="font-atx-display font-semibold text-[20px] mt-4 mb-2 text-ink group-hover:text-peri-deep transition-colors">{d.t}</h3>
                <p className="text-[14px] text-ink-mid leading-[1.55] flex-1">{d.d}</p>
                <div className={`mt-3.5 text-[11px] font-semibold tracking-[0.04em] uppercase ${d.tagLive ? 'text-mw-green' : 'text-ink-soft'}`}>{d.tag}</div>
                <div className="mt-4 text-peri-deep font-semibold text-[14px]">{d.go}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ⑥ THE HANDSHAKE — honesty as confidence */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <GradientPanel tone="lavender" className="p-[56px] max-[820px]:p-9 max-[640px]:p-7 flex flex-col items-center text-center">
            <div className={ey}>Early access</div>
            <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.08] text-[clamp(1.9rem,3.4vw,2.6rem)] mt-3 [text-wrap:balance] max-w-[15ch]">
              Get in before it <span className="text-gradient-accent">opens.</span>
            </h2>
            <p className="text-[15px] text-ink-mid leading-[1.6] mt-4 max-w-[46ch]">
              Historical testnet records are available for inspection.
            </p>
            <Link href="/proof" className="group inline-flex items-center gap-2.5 mt-5 rounded-full border border-hair bg-white/70 pl-3 pr-3.5 py-2 text-[12.5px] text-ink-mid no-underline hover:border-[rgba(76,76,214,0.4)] hover:bg-white transition-colors">
              <span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block shrink-0" />
              <span className="text-ink-soft">Past testnet settle</span>
              <span className="font-mono text-ink font-bold">$2.00 · 12→10 USDC</span>
              <span className="text-peri-deep font-semibold group-hover:translate-x-0.5 transition-transform">proof →</span>
            </Link>
            <div className="w-full max-w-[440px] mt-7">
              <WaitlistForm />
            </div>
            <div className="text-[12px] text-ink-soft mt-4 leading-[1.5] max-w-[52ch]">
              MarketEngine is live on Robinhood Chain testnet. Adapters hold test assets without yield; unaudited. <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
            </div>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}

// ─── Card scene — the tap→settle receipt fills in when scrolled into view ─────
const CARD_SCENE_CSS = `
.cardscene .rrow{opacity:0;transform:translateY(7px)}
.cardscene.in .cc{animation:mwtap 720ms cubic-bezier(.34,1.56,.64,1) 150ms both}
.cardscene.in .rrow{animation:mwrise 440ms ease-out both}
.cardscene.in .rrow:nth-child(1){animation-delay:.35s}
.cardscene.in .rrow:nth-child(2){animation-delay:.70s}
.cardscene.in .rrow:nth-child(3){animation-delay:1.05s}
.cardscene.in .rrow:nth-child(4){animation-delay:1.30s}
.cardscene.in .rrow:nth-child(5){animation-delay:1.55s}
.cardscene.in .rrow:nth-child(6){animation-delay:1.95s}
.cardscene.in .earn-dot{animation:mwpulse 2.2s ease-in-out 2.5s infinite}
@keyframes mwtap{0%{transform:rotate(-6deg) scale(1)}28%{transform:rotate(-6deg) scale(.955)}100%{transform:rotate(-6deg) scale(1)}}
@keyframes mwrise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@keyframes mwpulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}50%{box-shadow:0 0 0 5px rgba(34,197,94,0)}}
@media (prefers-reduced-motion:reduce){
  .cardscene .rrow{opacity:1 !important;transform:none !important;animation:none !important}
  .cardscene .cc,.cardscene .earn-dot{animation:none !important}
}`

function CardScene() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [inView, setInView] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { setInView(true); io.disconnect() }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={`cardscene relative flex justify-center items-center min-h-[340px]${inView ? ' in' : ''}`}>
      <style>{CARD_SCENE_CSS}</style>
      <div className="cc relative w-[min(400px,90%)] aspect-[1.586/1] rounded-[22px] text-white p-[26px] overflow-hidden -rotate-6 shadow-[0_30px_70px_-28px_rgba(40,30,90,0.42)]" style={{ background: 'linear-gradient(135deg, #5a5af0 0%, #7d63e6 44%, #ef8a63 108%)' }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.28), transparent 40%)' }} />
        <div className="relative flex justify-between items-center">
          <span className="font-atx-display font-bold tracking-[-0.01em] text-[17px]">Mintware</span>
          <span className="w-9 h-[27px] rounded-md opacity-95" style={{ background: 'linear-gradient(135deg,#f5d98a,#d9a94e)' }} />
        </div>
        <div className="absolute left-[26px] bottom-[56px] font-mono text-[17px] tracking-[2px]">4823  ••••  ••••  7140</div>
        <div className="absolute left-[26px] bottom-[26px] text-[12px] tracking-[0.5px] uppercase opacity-90">A. Sovereign</div>
        <div className="absolute right-[26px] bottom-[22px] font-atx-display font-bold text-[15px] opacity-95">LSA</div>
      </div>

      {/* floating receipt — rows rise in sequence */}
      <div className="absolute right-[2%] bottom-[6%] w-[236px] soft-card p-[15px_16px] rotate-3 shadow-[0_30px_70px_-28px_rgba(40,30,90,0.42)]">
        <div className="rrow flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Tap</span><b className="font-mono">$42.10</b></div>
        <div className="rrow flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Authorized</span><span className="text-mw-green font-bold">12&nbsp;ms ✓</span></div>
        <div className="rrow flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Settled</span><span className="text-mw-green font-bold">on-chain ✓</span></div>
        <div className="rrow h-px bg-hair-soft my-1.5" />
        <div className="rrow flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Balance</span><b className="font-mono">$12,437.90</b></div>
        <div className="rrow flex items-center gap-[7px] text-[12px] text-mw-green font-semibold mt-1"><span className="earn-dot w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />still earning — position never unwound</div>
      </div>
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
