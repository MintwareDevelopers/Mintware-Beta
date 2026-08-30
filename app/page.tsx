'use client'

// =============================================================================
// Homepage — design v2 (Privy-esque). "Liquidity IS a public good" hero, then
// the flagship vault, the Liquid Sovereign Account teaser, the two vault
// products, and — in the "How it works" band — the live Attribution scorer:
// paste any wallet (or a sample) and its live score reveals inline, then the
// signals that feed it. Closes on a gentle "Stay in the loop" capture.
// Live wiring kept: Privy launch, /score fetch, WaitlistForm.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getAddress } from 'viem'
import { scoreApiUrl } from '@/lib/web2/api'
import { CountUp, Marquee } from '@/components/web2/motion'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useLaunch } from '@/components/web2/LaunchModal'
import { YieldPaymentNetworkSection } from '@/components/marketing/ypn/YieldPaymentNetworkSection'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { V2Nav } from '@/components/ui2/V2Nav'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'

const SAMPLE_ADDRS = [
  { label: 'vitalik.eth', addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: '0xAb58…eC9B', addr: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { label: '0x47ac…D503', addr: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
]

const STATS = [
  { n: '925', k: 'Max score' },
  { n: '100+', k: 'Chains indexed' },
  { n: '6', k: 'Signals scored' },
  { n: 'Free', k: 'Always' },
]

const SIGNALS = [
  { n: 'Liquidity', w: '74%', v: '111', c: 'var(--color-peri)' },
  { n: 'Volume', w: '41%', v: '41', c: 'var(--color-peri)' },
  { n: 'Sharing', w: '58%', v: '232', c: 'var(--color-coral2)' },
  { n: 'Holding', w: '39%', v: '39', c: 'var(--color-peri)' },
]

const ACTIONS = [
  { b: 'Swap', fd: 'Every trade feeds Volume + Trading', pts: 'Volume · Trading', hot: false },
  { b: 'Provide liquidity', fd: 'Real LP positions, held', pts: 'Liquidity · 150', hot: true },
  { b: 'Refer a friend', fd: 'Their activity grows your tree, for life', pts: 'Sharing · 400', hot: true },
  { b: 'Hold quality', fd: 'Conviction — positions over 7 days', pts: 'Holding · 100', hot: false },
  { b: 'Govern', fd: 'Votes and proposals across protocols', pts: 'Governance · 100', hot: false },
  { b: 'Run an agent', fd: 'Machines earn reputation — ERC-8004', pts: 'Agent trust', hot: false },
]

const LOOP = [
  { tag: 'Earn',      t: 'Working from second one', d: 'Your capital sits in a lending market and earns immediately. Idle is the exception, not the rule.' },
  { tag: 'Depth',     t: 'Becomes depth on demand', d: 'The instant a trade needs it, it’s provisioned as deep liquidity — then returns to earning.' },
  { tag: 'Fees',      t: 'Traders arrive',          d: 'Deep, reliable execution draws real flow. Every swap pays a fee.' },
  { tag: 'Protected', t: 'Your side stays safe',    d: 'A senior / junior split keeps the spendable side protected while risk sits on first-loss capital.' },
  { tag: 'Spend',     t: 'Spend the yield',         d: 'Pay from realized earnings — cards, payroll, vendors — while the position keeps working.' },
  { tag: 'Always',    t: '…and it never stopped',   d: 'Out only for the microseconds of a swap. That’s the whole idea.' },
]

const TIERS = [
  { n: 'Blue-chip',        d: 'Deep, stable pairs. A thin first-loss layer, tight risk.', accent: 'rgba(108,108,240,0.9)',  hot: false },
  { n: 'Liquid markets',   d: 'Active pairs with dynamic fees and recaptured MEV.',        accent: 'rgba(108,108,240,0.9)',  hot: false },
  { n: 'Community tokens', d: 'Your token, backstopped by its own first-loss — real depth without renting a market maker.', accent: 'rgba(232,138,103,0.95)', hot: true },
]

const MAX_SCORE = 925
const RING_C = 2 * Math.PI * 90 // circumference for r=90

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const hotChip = 'text-[10px] font-semibold rounded-full px-2 py-1 bg-[rgba(108,108,240,0.1)] text-peri-deep border border-[rgba(108,108,240,0.22)]'

interface ScoreSignal { key: string; name: string; max: number; color: string; score: number }
interface ScoreData {
  score: number; tier: string; percentile: number
  walletAge?: string; firstSeen?: string; chains?: number; totalTxCount?: number
  signals: ScoreSignal[]
}

// ─── Score card — the live Attribution scorer. /score fetch, ring + count-up ──
function ScoreCard() {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [data, setData] = useState<ScoreData | null>(null)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(0)
  const reqId = useRef(0)

  async function load(raw: string, label?: string) {
    const q = (raw || '').trim()
    if (!q) return
    let a = q
    try { if (q.startsWith('0x') && q.length === 42) a = getAddress(q) } catch { /* keep raw (ENS) */ }
    const id = ++reqId.current
    setStatus('loading'); setInput(label ?? q)
    try {
      const res = await fetch(scoreApiUrl(a))
      if (!res.ok) throw new Error('not found')
      const d = (await res.json()) as ScoreData
      if (id !== reqId.current) return
      setData(d); setShown(0); setStatus('idle'); setOpen(true)
    } catch {
      if (id !== reqId.current) return
      setStatus('error')
    }
  }

  // count the score up when the modal opens
  useEffect(() => {
    if (!open || !data) return
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { setShown(data.score); return }
    let raf = 0; const t0 = performance.now(); const target = data.score
    const tick = (t: number) => {
      const e = Math.min(1, (t - t0) / 1100)
      setShown(Math.round(target * (1 - Math.pow(1 - e, 3))))
      if (e < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, data])

  // esc-to-close + lock body scroll while the modal is open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const frac = data ? Math.min(1, data.score / MAX_SCORE) : 0
  const topPct = data ? Math.max(1, 100 - data.percentile) : 0
  const tierTxt = data ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : ''
  const tierCls = data?.tier === 'gold' ? 'text-coral2-deep border-[rgba(232,138,103,0.5)]'
    : data?.tier === 'silver' ? 'text-ink-mid border-hair'
    : 'text-peri-deep border-[rgba(108,108,240,0.4)]'

  return (
    <>
      {/* SEARCH CARD (always) */}
      <div className="soft-card w-full max-w-[720px] p-[26px] grid gap-4">
        <span className="live-chip"><span className="dot" aria-hidden />Live score engine — try any wallet</span>
        <div className="flex gap-2.5 max-[480px]:flex-col">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(input)}
            placeholder="0x… wallet address or ENS name"
            className="flex-1 min-w-0 py-3 px-4 rounded-full bg-white border border-hair font-atx-display text-[15px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)] placeholder:text-ink-soft"
          />
          <button onClick={() => load(input)} disabled={status === 'loading'} className="glass-pill-primary whitespace-nowrap disabled:opacity-70">
            {status === 'loading' ? 'Scoring…' : 'Check my score'}
          </button>
        </div>
        {status === 'error' && <div className="text-[12px] text-[#D14343]">Couldn’t score that address — check it and try again.</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Try</span>
          {SAMPLE_ADDRS.map((s) => (
            <button key={s.label} onClick={() => load(s.addr, s.label)} className="glass-pill glass-pill-sm">{s.label}</button>
          ))}
        </div>
      </div>

      {/* MODAL — the reveal */}
      {open && data && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[680px] max-h-[92vh] overflow-auto rounded-[var(--radius-panel)] border border-hair bg-white/95 backdrop-blur-md shadow-lift">
            <div className="flex items-center justify-between px-6 py-4 border-b border-hair-soft">
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft">Attribution score</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[15px] text-ink-soft hover:text-ink cursor-pointer bg-transparent border-0">✕</button>
            </div>

            <div className="p-6 grid grid-cols-[auto_1fr] gap-7 items-center max-[560px]:grid-cols-1 max-[560px]:justify-items-center max-[560px]:text-center">
              <div className="grid justify-items-center gap-3">
                <div className="relative w-[172px] h-[172px]">
                  <svg viewBox="0 0 208 208" className="w-full h-full -rotate-90">
                    <circle cx="104" cy="104" r="90" fill="none" stroke="rgba(23,23,31,0.10)" strokeWidth="13" />
                    <circle cx="104" cy="104" r="90" fill="none" stroke="var(--color-peri)" strokeWidth="13" strokeLinecap="round"
                      strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)}
                      style={{ transition: 'stroke-dashoffset 1.15s cubic-bezier(.22,1,.36,1)' }} />
                  </svg>
                  <div className="absolute inset-0 grid place-content-center text-center">
                    <div className="font-atx-display text-[42px] font-medium tracking-[-0.03em] leading-none tabular-nums text-ink">{shown}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-ink-soft">of {MAX_SCORE} pts</div>
                  </div>
                </div>
                <span className={`text-[11px] uppercase tracking-[0.06em] font-semibold rounded-full px-3 py-1 border ${tierCls}`}>{tierTxt}</span>
              </div>

              <div className="grid gap-3 min-w-0 w-full">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-atx-display text-[16px] text-ink">{input}</span>
                  <span className="text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full px-2.5 py-1 border border-[rgba(108,108,240,0.4)] text-peri-deep">Top {topPct}%</span>
                </div>
                <div className="flex gap-4 flex-wrap text-[12px] text-ink-soft">
                  {data.walletAge && <span><b className="text-ink-mid">{data.walletAge}</b> old</span>}
                  {data.chains != null && <span><b className="text-ink-mid">{data.chains}</b> chains</span>}
                  {data.totalTxCount != null && <span><b className="text-ink-mid">{data.totalTxCount.toLocaleString()}</b> txns</span>}
                </div>
                <div className="grid gap-2">
                  {data.signals?.map((s) => (
                    <div key={s.key} className="grid grid-cols-[80px_1fr_auto] items-center gap-3">
                      <span className="text-[11px] uppercase tracking-[0.03em] text-ink-mid">{s.name}</span>
                      <span className="h-2 rounded-full bg-ground-cool overflow-hidden">
                        <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.round((s.score / s.max) * 100)}%`, background: s.color }} />
                      </span>
                      <span className="text-[10.5px] text-ink-soft text-right min-w-[52px] tabular-nums">{s.score} / {s.max}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* vault CTA inside the modal */}
            <div className="border-t border-hair-soft bg-[rgba(108,108,240,0.06)] px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="max-w-[440px]">
                <div className="font-atx-display font-medium text-[17px] tracking-[-0.01em] leading-tight text-ink">Explore the vaults.</div>
                <div className="text-[13px] text-ink-mid">One balance, earning three ways at once — in testing on Base Sepolia.</div>
              </div>
              <Link href="/app/vaults" className="glass-pill glass-pill-sm whitespace-nowrap">See the vaults →</Link>
            </div>

            <div className="px-6 py-3.5 flex items-center gap-4 text-[11px] uppercase tracking-[0.05em] font-semibold border-t border-hair-soft">
              <button onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink-mid cursor-pointer bg-transparent border-0 p-0">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

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
          <span className="live-chip mb-6"><span className="dot" aria-hidden />Live · scoring 100+ chains right now</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.045em] leading-[1.02] text-[clamp(2.6rem,6.8vw,4.9rem)] max-w-[18ch] [text-wrap:balance]">
            Never idle.<br />Never locked.<br /><span className="text-gradient-accent">Always yours.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.05rem,1.7vw,1.3rem)] leading-[1.5] mt-6 max-w-[54ch]">
            Idle liquidity is a design flaw. Yours earns three ways at once — and its yield spends instantly, without ever unwinding your position.
          </p>

          <div className="mt-9 flex flex-wrap gap-3 items-center justify-center">
            <button onClick={() => launchApp()} className="glass-pill-primary">{launchLabel}</button>
            <a href="#how-it-works" className="text-[14px] font-medium text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">Check your score ↓</a>
          </div>
        </div>
      </section>

      {/* FLAGSHIP — never-idle V4 vaults · dark pop band */}
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

      {/* THE LOOP — how a dollar works: earn → depth → fees → tranche → spend → still earning */}
      <TheLoopSection launchApp={launchApp} />

      {/* LIQUID SOVEREIGN ACCOUNT — liquidity as a public good */}
      <YieldPaymentNetworkSection />

      {/* AMBIENT TICKER — evergreen facts, in motion */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <Marquee className="py-3" speed={38} items={
          ['100+ chains scored', 'In testing on Base Sepolia', 'MEV-protected Uniswap V4', 'Fees shared pro-rata by liquidity', 'Spend the yield, not your position', 'Free — no connection needed']
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
                  MEV-protected, auto-managed LP on Uniswap V4. Fees are shared pro-rata by the liquidity you provide — and your yield stays spendable while the position keeps working.
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
                  <Bdr k="Your share" v="pro-rata by liquidity" />
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft">Example APY</span>
                  <span className="font-atx-display font-medium text-[24px] tracking-tight text-coral2-deep tabular-nums"><CountUp value={9.1} decimals={1} suffix="%" /></span>
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

      {/* HOW IT WORKS — the live Attribution scorer + what feeds it */}
      <section id="how-it-works" className="bg-white border-b border-hair-soft scroll-mt-[70px]">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className={ey}>How it works</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(1.8rem,3.4vw,2.8rem)] max-w-[24ch] mt-3.5 [text-wrap:balance]">
            See your <span className="text-gradient-accent">Attribution score</span> — then watch every action feed it.
          </h2>
          <p className="text-ink-mid text-[16px] leading-[1.55] max-w-[60ch] mt-4">
            Paste any wallet and its live score reveals inline — six signals, tier, percentile. Everything you already do on-chain feeds it.
          </p>

          <div className="mt-9">
            <ScoreCard />
          </div>

          <div className="grid [grid-template-columns:0.85fr_1.15fr] gap-[26px] mt-10 items-start max-[720px]:grid-cols-1">
            <div className="soft-card overflow-hidden">
              <div className="flex items-end justify-between p-5 border-b border-hair-soft">
                <div>
                  <div className={ey}>Attribution</div>
                  <div className="font-atx-display text-[52px] font-medium tracking-[-0.04em] leading-[0.9] text-ink mt-1">82</div>
                </div>
                <span className={hotChip}>Builder · top 5%</span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-2.5">
                {SIGNALS.map((s) => (
                  <div key={s.n} className="flex items-center gap-2.5">
                    <span className="text-[10px] text-ink-soft w-[74px]">{s.n}</span>
                    <span className="flex-1 h-2 rounded-full bg-ground-cool overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: s.w, background: s.c }} />
                    </span>
                    <span className="text-[10px] w-7 text-right text-ink-mid tabular-nums">{s.v}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-ink-soft px-5 py-3 border-t border-hair-soft">
                vaultking.mintware · scored across 6 chains
              </div>
            </div>
            <div>
              <div className={`${ey} mb-2.5`}>What feeds your score</div>
              <div>
                {ACTIONS.map((a) => (
                  <div key={a.b} className="flex items-center gap-3.5 py-3.5 border-b border-hair-soft">
                    <b className="font-atx-display font-medium text-[15px] min-w-[132px] max-[720px]:min-w-[110px] text-ink">{a.b}</b>
                    <span className="text-[10.5px] text-ink-soft flex-1 leading-[1.4]">{a.fd}</span>
                    <span className={a.hot ? hotChip + ' whitespace-nowrap' : 'text-[10px] text-peri-deep whitespace-nowrap font-medium'}>
                      {a.pts}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="text-[12px] text-ink-mid mt-6 tracking-[0.01em]">
            <b className="text-peri-deep">↳</b> All six roll into one Attribution score — a portable, on-chain reputation. Free to check, yours to build.
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
                New vaults, drops, and score boosts, <span className="text-gradient-accent">before anyone else.</span>
              </h2>
              <p className="text-[15px] text-ink-mid mt-2.5 max-w-[46ch]">Score-holders get priority access. No spam, just the good stuff.</p>
            </div>
            <WaitlistForm />
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}

// ─── The loop — numbered vertical flow → tiers → Treasury Mesh teaser ────────
function TheLoopSection({ launchApp }: { launchApp: (path?: string) => void }) {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className={ey}>How it works · the loop</div>
        <h2 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(1.8rem,3.4vw,2.8rem)] max-w-[22ch] mt-3.5 [text-wrap:balance]">
          One dollar. Six moves. <span className="text-gradient-accent">Never idle.</span>
        </h2>
        <p className="text-ink-mid text-[16px] leading-[1.55] max-w-[60ch] mt-4">
          Your capital earns in a lending market, becomes market depth the instant a trade needs it, and pays its yield out as spendable dollars — without ever unwinding your position.
        </p>

        {/* the numbered vertical flow — the centerpiece */}
        <div className="mt-11 max-w-[720px]">
          {LOOP.map((s, i) => {
            const last = i === LOOP.length - 1
            const spend = i === 4
            const ring = spend
              ? 'text-coral2-deep border-[rgba(232,138,103,0.55)]'
              : 'text-peri-deep border-[rgba(108,108,240,0.45)]'
            return (
              <div key={s.t} className="grid grid-cols-[54px_1fr] gap-5 max-[520px]:gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-[54px] h-[54px] rounded-full grid place-items-center bg-white border-[1.5px] ${ring} font-atx-display font-medium text-[19px] tabular-nums shadow-[0_1px_2px_rgba(23,23,31,0.06)]`}>
                    {last ? '↻' : i + 1}
                  </div>
                  {!last && <div className="w-[2px] flex-1 min-h-[22px] my-1.5 bg-[rgba(108,108,240,0.16)]" />}
                </div>
                <div className={last ? 'pt-1.5' : 'pt-1.5 pb-9'}>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-atx-display text-[18px] font-medium text-ink tracking-[-0.01em]">{s.t}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] font-semibold text-ink-soft">{s.tag}</span>
                  </div>
                  <p className="text-[14.5px] text-ink-mid leading-[1.5] mt-1.5 max-w-[52ch]">{s.d}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* tiers — clean, top-accent */}
        <div className="mt-16">
          <div className={ey}>Same engine, priced to your token</div>
          <div className="grid grid-cols-3 gap-4 mt-4 max-[720px]:grid-cols-1">
            {TIERS.map((t) => (
              <div key={t.n} className="soft-card p-6 flex flex-col gap-2 border-t-[3px]" style={{ borderTopColor: t.accent }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-atx-display text-[16px] font-medium text-ink">{t.n}</span>
                  {t.hot && <span className={hotChip + ' whitespace-nowrap'}>where memes fit</span>}
                </div>
                <p className="text-[13.5px] text-ink-mid leading-[1.45]">{t.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Treasury Mesh teaser */}
        <div className="mt-12 rounded-[var(--radius-panel)] border border-hair bg-ground-cool p-8 max-[800px]:p-6 grid [grid-template-columns:1.15fr_0.85fr] gap-8 items-center max-[720px]:grid-cols-1">
          <div>
            <div className={ey}>Where this is going</div>
            <h3 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.4rem,2.4vw,2rem)] mt-3 [text-wrap:balance]">
              A shared liquidity network.
            </h3>
            <p className="text-[15px] text-ink-mid leading-[1.55] mt-3 max-w-[52ch]">
              One team’s idle treasury can deepen another team’s market — earning while it stays spendable, risk isolated per token. Liquidity as a public good, pooled across the ecosystem.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 font-atx-display max-[420px]:gap-2">
            <span className="flex flex-col items-center gap-1 rounded-2xl bg-white border border-hair px-4 py-3 text-[13px] font-medium text-ink">Team A<span className="text-[10px] font-normal text-ink-soft">idle senior</span></span>
            <span className="text-coral2-deep text-[20px] font-semibold">⇄</span>
            <span className="grid place-items-center w-[74px] h-[74px] rounded-full bg-[rgba(108,108,240,0.1)] border-[1.5px] border-[rgba(108,108,240,0.5)] text-[12px] font-semibold text-peri-deep text-center leading-[1.1] shrink-0">shared<br />depth</span>
            <span className="text-coral2-deep text-[20px] font-semibold">⇄</span>
            <span className="flex flex-col items-center gap-1 rounded-2xl bg-white border border-hair px-4 py-3 text-[13px] font-medium text-ink">Team B<span className="text-[10px] font-normal text-ink-soft">idle senior</span></span>
          </div>
        </div>

        {/* one honest closing beat */}
        <div className="flex items-center justify-between gap-4 flex-wrap mt-8">
          <div className="text-[12px] text-ink-mid tracking-[0.01em]">
            <b className="text-peri-deep">↳</b> Engineered and adversarially stress-tested. In testing on Base — external audit before real value.
          </div>
          <button onClick={() => launchApp('/app/vaults')} className="glass-pill glass-pill-sm whitespace-nowrap">See the vaults →</button>
        </div>
      </div>
    </section>
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
