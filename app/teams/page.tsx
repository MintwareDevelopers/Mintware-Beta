import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { cookies } from "next/headers"
import { isV2FromCookie, V2_COOKIE } from "@/lib/v2/gate"
import { V1MarketingStub } from "@/components/web2/V1MarketingStub"
import { LiveTodayStrip } from '@/components/web2/LiveTodayStrip'

// =============================================================================
// /teams — marketing landing for the Matched Liquidity vault (team-facing).
// Design v2 (Privy-esque). Grounded strictly in the deployed contract:
// contracts-v4/src/vaults/MintwareMatchedLiquidityVault.sol
//   · team commits T; community matches quote up to a value cap
//   · threshold within window → activate; 50/50 team(LOCKED)/community(FREE)
//   · MIN_LOCK_DURATION 90d hard cliff (90–730d); NO team early-unlock path
//   · guardian pause can FREEZE but never RELEASE team funds early
//   · during lock, fees accrue PER COMMUNITY LIQUIDITY UNIT — team earns 0%
//     (deposit-pro-rata, NOT reputation-weighted — do not claim AWY here)
//   · MIN_COMMUNITY_DEPOSITORS = 3 (anti self-dealing)
// Trust claim uses the contract's words: "a restriction on withdrawal, not a
// transfer of ownership." Never "community-owned." Undeployed → testnet-honest.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Teams — Prove it, don’t say it | Mintware',
  description:
    'Matched launch liquidity is a roadmap direction: lock team tokens alongside community capital, with a planned 90-day minimum and no early-exit path. The design directs fees to backers during the lock.',
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
  ['Team commits tokens · planned', 'The roadmap design lets a team commit its project token for a selected 90-day to 2-year term.'],
  ['Community match · planned', 'The design lets backers contribute a quote asset (USDC, WETH…) up to a value cap.'],
  ['Threshold activation · planned', 'The future flow would activate a Uniswap V4 position if the minimum is reached within the funding window.'],
  ['Two sides · planned', 'The design splits liquidity 50/50, with a team lock and a redeemable community side.'],
  ['No early exit · planned', 'The roadmap specifies no team early-unlock path; a guardian pause would not release locked liquidity.'],
]

const LOCK_STATS: [string, string][] = [
  ['≥ 90 days', 'Planned cliff — selectable up to 2 years'],
  ['0', 'Planned team early-exit paths'],
  ['50 / 50', 'Proposed team-lock / community-free split'],
  ['≥ 3', 'Planned minimum independent backers'],
]

const TRUST: [string, string][] = [
  ['Locked, not signed over', 'The roadmap design restricts withdrawal before the cliff without transferring ownership.'],
  ['No early-unlock path', 'The matched-vault design specifies no team path to withdraw locked liquidity early.'],
  ['Guardian kill-switch', 'The design allows a guardian pause but no early release of team liquidity.'],
  ['Anti-self-dealing floor', 'The design requires at least three independent community backers before activation.'],
  ['Fee redirection on-chain', 'The roadmap directs community fees on-chain per unit of community liquidity.'],
]

const TREASURY: [string, string][] = [
  ['Spendable while earning', 'The roadmap pairs member balances with a planned treasury buffer for cards and payments; no yield or instant spending is currently available.'],
  ['Your team, by role', 'The planned flow invites members by email and assigns role-based daily spend caps.'],
  ['Pay vendors & run payroll', 'Vendor payments and payroll are planned treasury features, subject to future payment-rail integrations.'],
  ['Proof of reserves, public', 'The roadmap includes a public treasury page for NAV, coverage, and membership information.'],
]

function TeamsLandingPageV2() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="teams" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>For teams · matched liquidity</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            Prove it. <span className="text-gradient-accent">Don’t say it.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Matched launch liquidity is a roadmap direction — designed to lock team tokens alongside community capital for at least 90 days, with a planned fee share for backers. “Trust us” becomes “check the contract.”
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
          <Head n="01" label="The problem" />
          <h2 className={h2}>Every launch asks the same thing: <span className="text-gradient-accent">trust us.</span></h2>
          <p className={lead}>
            Most tokens launch with liquidity concentrated in a few insider wallets, rented mercenary capital that
            leaves within a week, and a team that can pull the floor at any moment. The community is asked to believe it
            won’t happen. Belief isn’t a mechanism — and it’s exactly what gets retail hurt.
          </p>
        </div>
      </section>

      {/* ── 02 · Two models ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Two ways to bring liquidity" />
          <h2 className={h2}>Matched, or a <span className="text-gradient-accent">traditional LP.</span></h2>
          <p className={lead}>
            The roadmap includes a locked, community-matched launch and a traditional LP model, each designed for a different use.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-coral2)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">Matched Liquidity</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-coral2-deep rounded-full border border-[rgba(232,138,103,0.4)] px-2 py-0.5">You’re reading this ↓</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                The roadmap design locks a team token while the community matches it in USDC, with a planned ≥ 90-day cliff and fees directed to backers. For launches where <b className="text-ink">trust is the bottleneck</b>.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-peri)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">Growth Vault</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Traditional LP</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                The planned LP position supports one or both sides, without matching. The design targets an auto-managed range and pro-rata fees. Built for
                <b className="text-ink"> ongoing or treasury liquidity</b>.
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
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">How matched liquidity works</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            You lock. Your community matches. <span className="text-gradient-accent">The contract holds both.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[60ch] mt-4">The roadmap is a dual-sided pair vault — a team token on one side, community stablecoin or ETH on the other. The planned contract would handle the rest.</p>
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
          <Head n="04" label="The lock · the proof" />
          <h2 className={h2}>A restriction on withdrawal, <span className="text-gradient-accent">not a transfer of ownership.</span></h2>
          <p className={lead}>
            Your liquidity stays yours. What changes is that you provably can’t withdraw it before the cliff. The term is
            yours to pick — from 90 days up to two years — and once set, there is deliberately no path to unwind it early.
          </p>
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
          <Head n="05" label="What backers earn" />
          <h2 className={h2}>During the lock, <span className="text-gradient-accent">your fees are theirs.</span></h2>
          <p className={lead}>
            While your side is locked, every swap fee it would have earned — net of the Mintware protocol cut — flows to
            the community instead, accrued on-chain per unit of community liquidity. You give up short-term fees to buy
            long-term trust. That’s the trade, and the contract enforces it exactly: during the lock, the team earns 0%.
          </p>
          <p className="text-[12px] text-ink-soft mt-4">
            <b className="text-peri-deep">↳</b> The matched-launch roadmap shares fees pro-rata to community liquidity; reputation-weighting is a separate future direction.
          </p>
        </div>
      </section>

      {/* ── 06 · Referrals ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Referrals · grow the pool" />
          <h2 className={h2}>Let your backers <span className="text-gradient-accent">bring their backers.</span></h2>
          <p className={lead}>
            Matched liquidity is only as deep as the community you can rally — and your community has a community.
            Referrals turn every backer into a channel for more.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[760px]:grid-cols-1">
            {[
              ['Every backer gets a link', 'A referral link is deterministic from any wallet — no signup. Share it, and the liquidity it brings is attributed to you.'],
              ['Your launch reaches further', 'Every backer who shares their link widens the pool of people who can fill your match — a real network is the hardest thing to fake.'],
              ['Tracked on-chain, paid fairly', 'Referred liquidity is recorded per wallet. Pool fees stay pro-rata to each position — no reputation multiplier.'],
            ].map(([k, d]) => (
              <div key={k} className="soft-card p-6">
                <div className="font-atx-display text-[15px] font-medium leading-tight text-ink">{k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4">
            <b className="text-peri-deep">↳</b> Teams can reward backers through referrals — every wallet brought in pays a referral reward, so widening the pool pays twice. A 24-hour anti-abuse gate keeps referrals real, not farmed.
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
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            Built for MEME / EMERGING launches and gated as such at deploy. The matched-liquidity vault is invariant-tested
            and ships on Base Sepolia testnet first; live mainnet launches land at Phase 2. Independent audit pending.
          </p>
        </div>
      </section>

      {/* ── 08 · Beyond the launch · the treasury ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="08" label="Beyond the launch · your treasury" />
          <h2 className={h2}>The capital doesn’t have to sit idle. <span className="text-gradient-accent">Or lock you out.</span></h2>
          <p className={lead}>
            The treasury roadmap is designed to support cards, payroll, vendors, and a public status page. It also explores community senior capital and a team junior first-loss tranche; this structure is not currently offered.
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
            Matched launch, lock tiers, and senior/junior tranches are roadmap designs, not currently usable features. Testnet work is unaudited; external audit gates any real value.
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
