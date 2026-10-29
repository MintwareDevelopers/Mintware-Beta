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
// the planned Unified Liquidity Vault (designed for three income streams — best-rate lending,
// swap fees, recaptured MEV), a five-stage V4 hook engine, dual-sided / matched
// liquidity, a pro-rata 60/30/10 split, and a balance that stays spendable while
// it earns. Rewards are PRO-RATA by your share — never reputation- or
// lock-multiplier-weighted. Narrative only — calculators live on /vaults.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — One balance, three income streams | Mintware',
  description:
    'A roadmap for Uniswap v4 vaults that combine lending, swap fees, and MEV recapture, with planned spendability and auto-management.',
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
// The three income streams — one balance earns all of them at once.
const STREAMS: [string, string][] = [
  ['Best-rate lending', 'The design routes idle capital to lending venues as rates move.'],
  ['Swap fees', 'The planned engine targets just-in-time Uniswap v4 liquidity around swaps.'],
  ['Recaptured MEV', 'The design aims to return some value otherwise captured by bots to the pool.'],
]

const HOOK = [
  ['Idle → lending · planned', 'The design routes un-ranged capital to a lending venue.'],
  ['JIT on swap · planned', 'A future V4 hook is designed to size liquidity around a trade.'],
  ['MEV recapture · planned', 'The design explores oracle guards and dynamic fees to reduce sandwich value.'],
  ['Fees + MEV split · planned', 'The roadmap directs future fees and recaptured MEV pro-rata on-chain.'],
  ['Auto-compound · planned', 'The design aims to accrue earnings to a position without manual claiming.'],
]

// How a matched vault forms — team + community make the market together.
const MATCHED: [string, string, string][] = [
  ['01', 'Team token · roadmap', 'The matched-launch design includes a team token lock of at least 90 days.'],
  ['02', 'Community match · roadmap', 'The proposed model pairs it with community USDC.'],
  ['03', 'Senior / junior · roadmap', 'The future design explores community senior and team junior capital.'],
  ['04', 'Planned depth', 'The aim is tighter spreads and better fills when a launch goes live.'],
]

const SPLIT: [string, string, string][] = [
  ['60%', 'planned for LPs', 'The proposed split allocates a share pro-rata by position.'],
  ['30%', 'planned for treasury', 'The proposed model allocates a share to protocol operations.'],
  ['10%', 'planned for buybacks', 'The proposed model allocates a share to ecosystem buybacks.'],
]

const SPEND = [
  'The planned vault combines three income streams',
  'Designed to stay spendable as USDC',
  'Future card or wire spending',
  'A planned payment would hold against the earning balance',
  'Settlement is a future integration',
]

const TRUST = [
  ['Non-custodial · planned', 'The design keeps positions in user-controlled wallets or contracts.'],
  ['Guardian pause · planned', 'A future guardian control is designed to pause vault actions if needed.'],
  ['MEV-resistant hook · planned', 'The design explores oracle guards and dynamic fees to reduce sandwich risk.'],
  ['Fee split · planned', 'The proposed 60/30/10 split would be recorded on-chain.'],
  ['Withdrawal queue · planned', 'A future design includes an on-chain notice period for withdrawals.'],
  ['Invariant-tested', 'Testnet code has been tested; independent audit is required before real value.'],
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
            One balance. <span className="text-gradient-accent">Three planned income streams.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            A future Uniswap v4 vault is designed to combine lending, swap fees, and MEV recapture. Spendability and auto-management are roadmap goals, not current features.
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
          <h2 className={h2}>Everyone else leaves capital half-used. <span className="text-gradient-accent">The design combines three income streams.</span></h2>
          <p className={lead}>The Unified Liquidity Vault roadmap combines best-rate lending, swap fees, and recaptured MEV on the same capital.</p>
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
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> See illustrative examples on the <Link href="/vaults" className="text-peri-deep underline">vaults page</Link>.</p>
        </div>
      </section>

      {/* ── 02 · The hook engine ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="One balance · planned vault design" />
          <h2 className={h2}>One balance. <span className="text-gradient-accent">A planned five-stage V4 hook engine.</span></h2>
          <p className={lead}>The future hook stack is designed to route liquidity around swaps and account for fees automatically.</p>
          <FlowDiagram className="mt-8" steps={HOOK.map(([k, d]) => ({ label: k, sub: d }))} />
        </div>
      </section>

      {/* ── 03 · Dual-sided / matched liquidity ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="Dual-sided · matched liquidity" />
          <h2 className={h2}>Liquidity isn’t a solo act. <span className="text-gradient-accent">Teams and their community make the market together.</span></h2>
          <p className={lead}>The matched-launch roadmap pairs a team token with community USDC, with planned lock terms and senior/junior tranches. Two economic sides, one future pool.</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {MATCHED.map(([step, name, desc]) => (
              <div key={step} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-3" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[22px] font-medium leading-none text-peri-deep tabular-nums">{step}</div>
                <div className="font-atx-display text-[15px] font-medium text-ink leading-[1.2]">{name}</div>
                <div className="text-[11px] text-ink-mid leading-[1.5] mt-auto">{desc}</div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Every backer earns their <b className="text-ink">pro-rata</b> share of all three income streams — by the size of their stake, and nothing else.</p>
        </div>
      </section>

      {/* ── 04 · The fee split ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Where the fees go" />
          <h2 className={h2}>Every swap fee, <span className="text-gradient-accent">split on-chain.</span></h2>
          <p className={lead}>No black box. The split is enforced by the vault contract, and any change to it emits a public event. Each project can set its own template — this is the default.</p>
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
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">The Liquid Sovereign Account · spend the yield</span>
          </div>
  <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            Earning here. <span className="text-gradient-accent">Spendable there.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">The planned account is designed to keep a balance spendable as USDC while it earns. Future card or wire payments would hold against the earning position.</p>
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
            Matched launches, lock tiers, and senior/junior tranches are roadmap designs. MarketEngine is live on Robinhood Chain testnet; its adapters hold test assets without yield. Figures are illustrative.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[26ch] [text-wrap:balance]">
              Model an illustrative balance on the vaults page.
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
  return isV2 ? <DefiLandingPageV2 /> : <V1MarketingStub topic="DeFi" headline="MarketEngine on testnet." blurb="MarketEngine is live on Robinhood Chain testnet with a tUSDG/tPONS pool. Adapters hold test assets without yield; no real-value returns are available." live={false} />
}
