import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { cookies } from "next/headers"
import { isV2FromCookie, V2_COOKIE } from "@/lib/v2/gate"
import { V1MarketingStub } from "@/components/web2/V1MarketingStub"
import { LiveTodayStrip } from '@/components/web2/LiveTodayStrip'

// =============================================================================
// /teams — landing page for the retired matched-liquidity design.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Teams — Prove it, don’t say it | Mintware',
  description: 'Community-matched launch issuance is retired. Current curated liquidity uses MarketEngine on testnet.',
}

const TWITTER = 'https://x.com/Mintware_Fi'

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
const FLOW: [string, string][] = [
  ['Matched launch', 'Community-matched liquidity issuance is retired.'],
  ['No lock tiers', 'The current MarketEngine does not impose a lock period.'],
  ['Curated pool', 'Pool curation remains available through the current registry.'],
  ['MarketEngine', 'One engine manages liquidity for each curated Uniswap v4 pool.'],
  ['Testnet only', 'Current deployments are unaudited; external audit gates real value.'],
]

const LOCK_STATS: [string, string][] = [
  ['Retired', 'Community-matched launch issuance'],
  ['No lock tiers', 'The current MarketEngine has no lock schedule'],
  ['One pool', 'A MarketEngine is registered for each curated pool'],
  ['Testnet', 'Unaudited; external audit gates real value'],
]

const TRUST: [string, string][] = [
  ['Matched launch retired', 'Community-matched issuance is not part of the current product.'],
  ['Current liquidity path', 'Curated pools use a MarketEngine with one share token valued in the quote asset.'],
  ['Deposit guard', 'Deposits require a fresh mark and spot near that mark.'],
  ['In-kind exits', 'Withdrawals return both pool tokens pro-rata with minimum-output checks.'],
  ['Testnet status', 'Live on Robinhood Chain testnet · unaudited. External audit gates real value.'],
]

const TREASURY: [string, string][] = [
  ['Card refill only', 'Bridge + Stripe card rails are pre-enable. The on-chain gateway refills a registered member buffer wallet from Earn shares.'],
  ['No spend from NAV', 'Card purchases do not settle against the MarketEngine or Earn vault.'],
  ['No CCTP route', 'Cross-chain Arc/CCTP settlement is retired.'],
  ['Treasury issuance retired', 'Senior/junior new issuance is not a current product.'],
]

function TeamsLandingPageV2() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="teams" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>For teams · MarketEngine liquidity</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            Prove it. <span className="text-gradient-accent">Don’t say it.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Community-matched launch issuance is retired. Current curated liquidity uses MarketEngine on testnet; these contracts are unaudited, and external audit gates real value.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <a href="#how" className="glass-pill">How it works ↓</a>
            <Link href="/defi" className="glass-pill">See the LP side →</Link>
          </div>
        </div>
      </section>

      <LiveTodayStrip />

      {/* ── 01 · The problem ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="Current liquidity path" />
          <h2 className={h2}>Current pool liquidity uses <span className="text-gradient-accent">MarketEngine.</span></h2>
          <p className={lead}>
            MarketEngine provides a share-based liquidity path for curated Uniswap v4 pools. Community-matched launch issuance is retired.
          </p>
        </div>
      </section>

      {/* ── 02 · Two models ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Current liquidity path" />
          <h2 className={h2}>One pool, <span className="text-gradient-accent">one engine.</span></h2>
          <p className={lead}>
            The former matched-liquidity model is retired. Current pool liquidity uses one MarketEngine per curated Uniswap v4 pool.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-coral2)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">Matched Liquidity</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-coral2-deep rounded-full border border-[rgba(232,138,103,0.4)] px-2 py-0.5">You’re reading this ↓</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                Community-matched issuance is retired and is not available as a current product.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-peri)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">MarketEngine</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Traditional LP</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                Deposit one or both pool tokens with a minimum-share floor. Shares are quote-valued; withdrawals return both tokens pro-rata.
              </p>
              <Link href="/vaults" className="inline-block mt-4 text-[12px] uppercase tracking-[0.06em] font-semibold text-peri-deep no-underline hover:underline">See the LP side →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 · How it works · dark pop + animated flow ── */}
      <section id="how" className="bg-white border-b border-hair-soft scroll-mt-[62px]">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">03</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">Current pool liquidity</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            One curated pool. <span className="text-gradient-accent">One MarketEngine.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[60ch] mt-4">Deposits require a fresh mark and spot near that mark. Withdrawals remain available when the mark is stale and return both tokens pro-rata.</p>
          <div className="grid grid-cols-5 gap-3 mt-8 max-[900px]:grid-cols-1">
            {FLOW.map(([k, d], i) => (
              <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                <span className="text-[11px] text-pas-peri font-semibold tabular-nums">0{i + 1}</span>
                <div className="font-atx-display text-[15px] font-medium leading-tight text-white">{k}</div>
                <div className="text-[12px] text-white/60 leading-[1.45]">{d}</div>
                {i < FLOW.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
              </div>
            ))}
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 · The lock ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Retired · matched launch lock" />
          <h2 className={h2}>No lock tiers in the <span className="text-gradient-accent">current product.</span></h2>
          <p className={lead}>Community-matched issuance and its lock schedule are retired. Current MarketEngine withdrawals remain pro-rata and in kind.</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {LOCK_STATS.map(([n, d]) => (
              <div key={d} className="rounded-2xl bg-ground-cool border border-hair p-5" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[clamp(24px,3.4vw,34px)] font-medium tracking-[-1px] text-peri-deep leading-none tabular-nums">{n}</div>
                <div className="text-[12px] text-ink-mid leading-[1.45] mt-2.5">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 05 · What backers earn ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="05" label="Retired · matched launch fees" />
          <h2 className={h2}>Pool shares track <span className="text-gradient-accent">quote-asset value.</span></h2>
          <p className={lead}>The current MarketEngine does not route fees through the former community lock and allocation model. Withdrawals return both pool tokens pro-rata.</p>
        </div>
      </section>

      {/* ── 06 · Referrals ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Pool discovery" />
          <h2 className={h2}>Curation helps teams <span className="text-gradient-accent">find a pool.</span></h2>
          <p className={lead}>Discover ranks candidate pools using market data and a risk score; ranking is not certification. Curated pools are registered for MarketEngine.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[760px]:grid-cols-1">
            {[
              ['Market data', 'Discover uses GeckoTerminal market data to surface candidate pools.'],
              ['Risk score', 'The score ranks candidates and does not certify a pool as safe.'],
              ['Curation', 'Selected pools are registered with their MarketEngine.'],
            ].map(([k, d]) => (
              <div key={k} className="soft-card p-6">
                <div className="font-atx-display text-[15px] font-medium leading-tight text-ink">{k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4">
            <b className="text-peri-deep">↳</b> MarketEngine contracts are live on testnet and unaudited. External audit gates real value.
          </p>
        </div>
      </section>

      {/* ── 07 · Trust ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="07" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span className="text-gradient-accent">Neither does your community.</span></h2>
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
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">Live on Robinhood Chain testnet · unaudited. External audit gates real value.</p>
        </div>
      </section>

      {/* ── 08 · Beyond the launch · the treasury ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="08" label="Beyond the launch · your treasury" />
          <h2 className={h2}>Current treasury paths <span className="text-gradient-accent">have clear limits.</span></h2>
          <p className={lead}>
            The former senior/junior treasury issuance and spend-from-NAV design are retired. Card rails are Bridge + Stripe, pre-enable; the on-chain payment gateway only refills a registered member buffer wallet from Earn shares.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            {TREASURY.map(([k, d], i) => (
              <div key={k} className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: `4px solid ${i % 2 === 0 ? 'var(--color-peri)' : 'var(--color-coral2)'}` }}>
                <div className="font-atx-display text-[17px] font-medium text-ink">{k}</div>
                <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/app/org/new" className="glass-pill-primary">Create your treasury →</Link>
            <Link href="/app" className="glass-pill">Open the app →</Link>
          </div>
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            In testing on testnet, not yet audited — figures read live from the recorded vault; nothing here is an offer.
            External audit gates real value.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="coral" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[28ch] [text-wrap:balance]">
              Launching a token? Prove your commitment from day one.
            </div>
            <a href={TWITTER} target="_blank" rel="noopener noreferrer" className="glass-pill-primary">Talk to us →</a>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}


export default async function TeamsLandingPage() {
  const isV2 = isV2FromCookie((await cookies()).get(V2_COOKIE)?.value)
  return isV2 ? <TeamsLandingPageV2 /> : <V1MarketingStub topic="Team treasuries" headline="Treasuries that earn while staying spendable." blurb="A treasury that earns real yield while every dollar stays spendable for payroll, vendors, and cards. Where we are headed." live={false} />
}
