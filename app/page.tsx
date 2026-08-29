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

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

const ENGINES = [
  { n: '01', t: 'Best-rate lending', d: 'Idle capital is routed to the venue paying the most — and re-routed as rates move. Never parked in one place, earning less than it could.' },
  { n: '02', t: 'Market-making', d: 'Your liquidity provides just-in-time depth on Uniswap V4 exactly when trades need it, and earns the swap fees for it.' },
  { n: '03', t: 'Recaptured MEV', d: 'The value bots usually skim off your trades gets caught and handed back — to you and the pool, not the searchers.' },
]

const DOORS = [
  { glyph: '🧍', t: 'You', d: 'The Liquid Sovereign Account. Cash that earns while it stays spendable — on your card, anywhere. Earn, spend, stay sovereign.', tag: 'Your account', tagLive: false, go: 'Open your account →', href: '/yield-payment-network' },
  { glyph: '👥', t: 'Teams', d: 'A treasury that works: matched liquidity, cards, payroll, and role-capped spend — every balance reading live off the on-chain vault.', tag: 'For treasuries', tagLive: false, go: 'See the treasury →', href: '/teams' },
  { glyph: '🤖', t: 'Agents', d: 'An x402 parking account: idle USDC earns while it pays per call. Your agent’s balance is never dead weight between requests.', tag: '◆ x402 loop live', tagLive: true, go: 'Wire up an agent →', href: '/agents' },
]

export default function HomePage() {
  const { isConnected } = useMintwareIdentity()
  const { launch: launchApp } = useLaunch()
  const launchLabel = isConnected ? 'Go to the app →' : 'Launch app →'

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* ① HERO — the promise, no caveats */}
      <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
        <AirbrushSplash tone="mix" />
        <div className="relative mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] pt-[96px] pb-[88px] max-[640px]:pt-[60px] max-[640px]:pb-[56px] flex flex-col items-center text-center">
          <span className="live-chip mb-6"><span className="dot" aria-hidden />One balance · earning &amp; spendable</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.045em] leading-[1.02] text-[clamp(2.7rem,7vw,5.1rem)] [text-wrap:balance]">
            Never idle.<br />Never locked.<br /><span className="text-gradient-accent">Always yours.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.28rem)] leading-[1.55] mt-6 max-w-[56ch]">
            Money shouldn’t have to choose between earning and being spendable. Yours does both — it earns the moment it lands, and spends the second you need it. No unwinding. No lockups.
          </p>
          <div className="mt-9 flex flex-wrap gap-3.5 items-center justify-center">
            <button onClick={() => launchApp()} className="glass-pill-primary">{launchLabel}</button>
            <a href="#how" className="text-[14.5px] font-semibold text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">See how it works ↓</a>
          </div>
        </div>
      </section>

      {/* ② WHAT WE ARE — Uniswap V4 vaults for everyone (comes out swinging, states it directly) */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[92px] max-[640px]:py-[60px]">
          <div className="grid grid-cols-[1.05fr_0.95fr] gap-[44px] items-center max-[860px]:grid-cols-1 max-[860px]:gap-9">
            <div>
              <div className={ey}>Built on Uniswap V4</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-3.5 [text-wrap:balance]">
                The market-making engine the pros use, <span className="text-gradient-accent">opened to everyone.</span>
              </h2>
              <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.2rem)] leading-[1.55] mt-[18px] max-w-[46ch]">
                Mintware puts your dollars in a Uniswap&nbsp;V4 vault that runs the same automated, MEV-protected strategy the pros deploy — earning lending, swap fees, and recaptured MEV, all at once.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> Three engines, one balance — always working.</div>
            </div>

            {/* illustrative APY comparison — the lender's whole rate is our first segment */}
            <div className="soft-card p-[26px]">
              <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Illustrative — not a projection or guarantee</div>
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
                <div className="flex-1 max-w-[110px]"><div className="text-[12.5px] font-semibold text-ink">Mintware vault</div><div className="text-[11px] text-ink-soft">three jobs</div></div>
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
                Your dollars earn a real yield while they sit — and stay spendable to the cent, on a card or over the wire, without cashing out or unwinding a thing. It’s a checking account that never stops working.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> The yield is what you spend. The balance stays put.</div>
            </div>

            {/* balance card */}
            <div className="soft-card p-[30px]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[12px] uppercase tracking-[0.1em] text-ink-soft font-semibold">Spendable balance</div>
                  <div className="font-atx-display font-semibold text-[clamp(2.4rem,5vw,3.3rem)] tracking-[-0.03em] mt-1.5 tabular-nums">$12,480<span className="text-[0.5em] text-ink-soft">.00</span></div>
                </div>
                <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-mw-green-muted text-mw-green"><span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />earning</span>
              </div>
              <div className="flex gap-2.5 mt-[22px] flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-mw-green-muted text-mw-green">↑ yielding right now</span>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-3 py-2 bg-[rgba(108,108,240,0.11)] text-peri-deep">◆ spendable in full</span>
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
                A card that spends your <span className="text-gradient-accent">yield</span>, not your savings.
              </h2>
              <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.2rem)] leading-[1.55] mt-[18px] max-w-[44ch]">
                Tap to pay — and your balance never stops earning. A swipe is a <b className="text-ink">hold</b> against your working capital, not a withdrawal. Authorized in milliseconds, settled to the exact cent.
              </p>
              <div className="text-[12.5px] text-ink-mid mt-[22px]"><b className="text-peri-deep">↳</b> You spent $42.10. Your position didn’t move — only the yield did.</div>
            </div>

            {/* card scene */}
            <div className="relative flex justify-center items-center min-h-[340px]">
              <div className="relative w-[min(400px,90%)] aspect-[1.586/1] rounded-[22px] text-white p-[26px] overflow-hidden -rotate-6 shadow-[0_30px_70px_-28px_rgba(40,30,90,0.42)]" style={{ background: 'linear-gradient(135deg, #5a5af0 0%, #7d63e6 44%, #ef8a63 108%)' }}>
                <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.28), transparent 40%)' }} />
                <div className="relative flex justify-between items-center">
                  <span className="font-atx-display font-bold tracking-[-0.01em] text-[17px]">Mintware</span>
                  <span className="w-9 h-[27px] rounded-md opacity-95" style={{ background: 'linear-gradient(135deg,#f5d98a,#d9a94e)' }} />
                </div>
                <div className="absolute left-[26px] bottom-[56px] font-mono text-[17px] tracking-[2px]">4823  ••••  ••••  7140</div>
                <div className="absolute left-[26px] bottom-[26px] text-[12px] tracking-[0.5px] uppercase opacity-90">A. Sovereign</div>
                <div className="absolute right-[26px] bottom-[22px] font-atx-display font-bold text-[15px] opacity-95">LSA</div>
              </div>

              {/* floating receipt */}
              <div className="absolute right-[2%] bottom-[6%] w-[236px] soft-card p-[15px_16px] rotate-3 shadow-[0_30px_70px_-28px_rgba(40,30,90,0.42)]">
                <div className="flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Tap</span><b className="font-mono">$42.10</b></div>
                <div className="flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Authorized</span><span className="text-mw-green font-bold">12&nbsp;ms ✓</span></div>
                <div className="flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Settled</span><span className="text-mw-green font-bold">on-chain ✓</span></div>
                <div className="h-px bg-hair-soft my-1.5" />
                <div className="flex justify-between items-center text-[12.5px] py-[5px]"><span className="text-ink-soft">Balance</span><b className="font-mono">$12,437.90</b></div>
                <div className="flex items-center gap-[7px] text-[12px] text-mw-green font-semibold mt-1"><span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />still earning — position never unwound</div>
              </div>
            </div>
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
            <b className="text-ink">You spend the yield, not the position.</b> A payment is a hold against your earning balance, settled in just enough dollars to cover it. Everything else keeps working.
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
          <GradientPanel tone="lavender" className="p-[52px] max-[820px]:p-8 grid grid-cols-[1.1fr_0.9fr] gap-10 items-center max-[820px]:grid-cols-1 max-[820px]:gap-6">
            <div>
              <div className={ey}>Early access</div>
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.6rem,2.8vw,2.3rem)] mt-3 [text-wrap:balance]">
                Every claim here has an <span className="text-gradient-accent">on-chain receipt.</span>
              </h2>
              <p className="text-ink-mid text-[1.05rem] leading-[1.55] mt-3.5 max-w-[44ch]">
                Mintware is in testing on Base Sepolia — non-custodial, and openly unaudited. We’re not asking you to trust us. We’re showing you the ledger.
              </p>
              <div className="flex items-center gap-2.5 mt-[18px] text-[13.5px] text-ink-mid">
                <span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />Last settle: <span className="font-mono text-ink font-bold">$2.00 → 12→10 USDC</span> · <Link href="/proof" className="text-peri-deep font-semibold no-underline hover:underline">see the proof →</Link>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-3 text-[15px] text-ink">New vaults, cards, and agent rails — before anyone else.</div>
              <WaitlistForm />
              <div className="text-[12.5px] text-ink-soft mt-3.5 leading-[1.5]">
                In testing, non-custodial, unaudited — no real funds yet. Nothing here is a deposit, savings account, or guaranteed return. <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal &amp; disclosures →</Link>
              </div>
            </div>
          </GradientPanel>
        </div>
      </section>
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
