import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { FeeSplitDonut } from '@/components/ui2/FeeSplitDonut'
import { cookies } from "next/headers"
import { isV2FromCookie, V2_COOKIE } from "@/lib/v2/gate"
import { V1MarketingStub } from "@/components/web2/V1MarketingStub"
import { LiveTodayStrip } from '@/components/web2/LiveTodayStrip'

// =============================================================================
// /defi — marketing landing for the DeFi vault surface. Design v2 (Privy-esque).
// Footer-linked. Grounded in .claude/rules/vaults.md + the homepage story:
// Current V1 uses MarketEngine. The former ULV/JIT/MEV, matched-launch, and
// spend-in-place designs below have been retired; this surface keeps its V2 layout.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — One balance, three income streams | Mintware',
  description:
    'MarketEngine V1 issues quote-valued shares in curated Uniswap v4 pools, with resting liquidity bands, token adapters, and pro-rata in-kind exits. Testnet only · unaudited.',
}

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 [text-wrap:balance]'
const lead = 'text-[16px] leading-[1.55] text-ink-mid max-w-[60ch] mt-4'

function Head({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[12px] font-semibold text-peri-deep tabular-nums">{n}</span>
      <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-ink-soft">{label}</span>
    </div>
  )
}

// ── data ─────────────────────────────────────────────────────────────────────
// Current MarketEngine characteristics.
const STREAMS: [string, string][] = [
  ['Quote-valued shares', 'Each engine issues one share token representing a quote-asset-valued claim on a single curated pool portfolio.'],
  ['Resting liquidity band', 'Pool capital sits in a configured Uniswap v4 band alongside per-token ERC-4626 adapters.'],
  ['In-kind exits', 'Withdrawals return both pool tokens pro-rata, with caller-supplied minimum outputs.'],
]

const HOOK = [
  ['Fresh mark', 'Deposits require an available fresh mark for the non-quote asset.'],
  ['Spot check', 'Pool spot must remain within the configured deviation from the mark.'],
  ['Minimum shares', 'Each deposit supplies a nonzero minimum-shares floor.'],
  ['Guarded recenter', 'Lifecycle operations can recenter the range within configured movement and cooldown limits.'],
  ['In-kind exit', 'Withdrawals are pro-rata in both tokens and remain available when the mark is stale.'],
]

// Current MarketEngine facts.
const MATCHED: [string, string, string][] = [
  ['01', 'Curate one pool', 'Each MarketEngine is bound to one selected Uniswap v4 pool.'],
  ['02', 'Use pool tokens', 'Deposits can contain either or both pool tokens.'],
  ['03', 'Adapters hold assets', 'Per-token adapters hold allocated assets; Robinhood testnet adapters do not earn yield.'],
  ['04', 'Withdraw both tokens', 'Exits are pro-rata and in-kind, with caller-supplied minimum outputs.'],
]

const SPLIT: [string, string, string][] = [
  ['One', 'share token', 'Each engine issues a single quote-valued share.'],
  ['Both', 'pool tokens', 'Deposits can include either or both pool assets.'],
  ['Pro-rata', 'in-kind exit', 'Withdrawals return both pool assets according to the share fraction.'],
]

const SPEND = [
  'Propose a buffer wallet',
  'Wait 48 hours, then accept it',
  'An authorized relayer redeems Earn shares',
  'Assets go to the member’s registered wallet',
  'Per-user and global UTC-day caps apply',
]

const TRUST = [
  ['ERC-20 share', 'The engine issues one quote-valued share token for its pool portfolio.'],
  ['Deposit guard', 'A fresh mark and spot-deviation check are required before deposits.'],
  ['Minimum outputs', 'Deposits have a minimum-shares floor; withdrawals have minimum token outputs.'],
  ['Mark-independent exit', 'Withdrawals remain available when the external mark is stale.'],
  ['Idle adapter', 'The Robinhood testnet adapters hold assets ready and do not earn yield.'],
  ['Testnet status', 'Current contracts are unaudited; external audit gates real value.'],
]

function DefiLandingPageV2() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="defi" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>The vault engine · never idle</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            One deposit. <span className="text-gradient-accent">Three income streams.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            The current MarketEngine issues quote-valued shares for curated Uniswap v4 pools. Capital sits in a resting band and token adapters; withdrawals return both pool tokens pro-rata.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/vaults" className="glass-pill-primary">Open the vaults →</Link>
            <Link href="/the-math" className="glass-pill">See the math →</Link>
          </div>
        </div>
      </section>

      <LiveTodayStrip />

      {/* ── 01 · The wedge ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The wedge · never idle" />
          <h2 className={h2}>One engine per curated pool. <span className="text-gradient-accent">One quote-valued share.</span></h2>
          <p className={lead}>MarketEngine keeps capital in a resting Uniswap v4 band and per-token adapters. Robinhood testnet adapters hold assets ready; they do not earn yield.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[560px]:grid-cols-1">
            {STREAMS.map(([name, desc], i) => {
              const hot = i === 2
              return (
                <div key={name} className={hot ? 'rounded-2xl p-6 text-white' : 'soft-card p-6'} style={hot ? { background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri-deep))' } : undefined}>
                  <div className={`text-[11px] uppercase tracking-[0.12em] font-semibold ${hot ? 'text-white/80' : 'text-peri-deep'}`}>{`Stream ${i + 1}`}</div>
                  <div className={`font-atx-display text-[clamp(19px,2.4vw,24px)] font-medium tracking-[-0.01em] mt-2 leading-[1.15] ${hot ? 'text-white' : 'text-ink'}`}>{name}</div>
                  <div className={`text-[12.5px] leading-[1.5] mt-2.5 ${hot ? 'text-white/75' : 'text-ink-mid'}`}>{desc}</div>
                </div>
              )
            })}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Want the numbers on your own deposit? The live model is on the <Link href="/vaults" className="text-peri-deep underline">vaults page</Link>.</p>
        </div>
      </section>

      {/* ── 02 · The hook engine ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Deposit checks · guarded lifecycle" />
          <h2 className={h2}>A quote-valued share. <span className="text-gradient-accent">A guarded V4 lifecycle.</span></h2>
          <p className={lead}>Deposits require a fresh mark, spot near that mark, and a minimum-shares floor. Guarded lifecycle actions can recenter the range.</p>
          <FlowDiagram className="mt-8" steps={HOOK.map(([k, d]) => ({ label: k, sub: d }))} />
        </div>
      </section>

      {/* ── 03 · Dual-sided / matched liquidity ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="One pool · two tokens" />
          <h2 className={h2}>A single pool portfolio. <span className="text-gradient-accent">Both tokens on exit.</span></h2>
          <p className={lead}>Deposits can contain either or both pool tokens. Withdrawals are pro-rata in-kind and include caller-supplied minimum outputs.</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {MATCHED.map(([step, name, desc]) => (
              <div key={step} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-3" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[22px] font-medium leading-none text-peri-deep tabular-nums">{step}</div>
                <div className="font-atx-display text-[15px] font-medium text-ink leading-[1.2]">{name}</div>
                <div className="text-[11px] text-ink-mid leading-[1.5] mt-auto">{desc}</div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Pool balances are represented by one quote-valued share token.</p>
        </div>
      </section>

      {/* ── 04 · The fee split ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Portfolio accounting" />
          <h2 className={h2}>One share. <span className="text-gradient-accent">A pro-rata portfolio claim.</span></h2>
          <p className={lead}>The share represents a quote-valued claim on the engine’s pool assets, adapter balances, and resting liquidity.</p>
          <div className="grid grid-cols-[auto_1fr] gap-8 items-center mt-8 max-[640px]:grid-cols-1 max-[640px]:gap-5">
            <div className="soft-card p-7 max-[640px]:justify-self-start">
              <FeeSplitDonut />
            </div>
            <div className="flex flex-col gap-3">
              {SPLIT.map(([pct, who, d]) => (
                <div key={who} className="flex gap-3">
                  <span className="font-atx-display text-[18px] font-medium text-coral2-deep tabular-nums w-[52px] shrink-0">{pct}</span>
                  <div>
                    <div className="font-atx-display text-[14px] font-medium text-ink">{who}</div>
                    <div className="text-[12px] text-ink-mid leading-[1.45]">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 05 · Earning here, spendable there · dark pop ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">05</span>
          <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">Card refill · pre-enable</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            Refill from Earn. <span className="text-gradient-accent">Not spend-in-place.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">The relayer can redeem a member’s Earn shares to their registered buffer wallet after a 48-hour destination delay. Purchases do not settle from the vault.</p>
          <div className="grid grid-cols-5 gap-3 mt-8 max-[900px]:grid-cols-1">
            {SPEND.map((s, i) => (
              <div key={s} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                <span className="w-[8px] h-[8px] rounded-full bg-pas-peri inline-block" />
                <div className="font-atx-display text-[13.5px] font-medium leading-tight text-white">{s}</div>
                {i < SPEND.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
              </div>
            ))}
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 06 · Trust ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span className="text-gradient-accent">Trust the contract.</span></h2>
          <div className="soft-card mt-8 overflow-hidden">
            {TRUST.map(([k, d], i) => (
              <div key={k} className={`flex items-start gap-4 px-6 py-4 ${i < TRUST.length - 1 ? 'border-b border-hair-soft' : ''}`}>
                <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
                  <div className="font-atx-display text-[15px] font-medium w-[190px] shrink-0 max-[640px]:w-auto text-ink">{k}</div>
                  <div className="text-[13px] text-ink-mid leading-[1.5]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            MarketEngine is live on Robinhood Chain testnet; Base Sepolia also has an engine deployment. Testnet only · unaudited · external audit gates real value.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[26ch] [text-wrap:balance]">
              Model your own deposit on the vaults page.
            </div>
            <Link href="/vaults" className="glass-pill">Open the vaults →</Link>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}


export default async function DefiLandingPage() {
  const isV2 = isV2FromCookie((await cookies()).get(V2_COOKIE)?.value)
  return isV2 ? <DefiLandingPageV2 /> : <V1MarketingStub topic="DeFi" headline="Earn on the pools. Never locked." blurb="MarketEngine shares represent quote-asset value in a curated Robinhood Chain pool. Deposits require a fresh mark; exits return both pool tokens pro-rata." live={true} />
}
