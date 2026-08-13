import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'

// =============================================================================
// /attribution — marketing landing for the Attribution reputation layer.
// Design v2 (Privy-esque). Footer-linked. Grounded in docs/overview/attribution.md:
// six signals, max 925, "not based on wealth", 100+ chains, EAS verifiability,
// up-to-1.95x multiplier. No invented stats.
// =============================================================================

export const metadata: Metadata = {
  title: 'Attribution — On-chain reputation, scored | Mintware',
  description:
    'Attribution reads your complete on-chain history across 100+ chains and produces one composite reputation score from six signals. Not based on wealth — based on contribution. Verifiable on Base via EAS.',
}

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 [text-wrap:balance]'
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
const STATS = [
  ['100+', 'Chains indexed'],
  ['925', 'Max score'],
  ['6', 'Weighted signals'],
  ['Free', 'Always'],
]

// max 925 total — Sharing weighted heaviest because a real referral network is hard to fake
const SIGNALS: [string, number, string, string][] = [
  ['Volume', 100, 'Scale and consistency of transaction activity', '#3A52CC'],
  ['Trading', 75, 'Frequency, diversity, protocol breadth, timing', '#6B8FFF'],
  ['Holding', 100, 'Long-term conviction versus churn', '#2A9E8A'],
  ['Liquidity', 150, 'LP depth, duration, and quality', '#C27A00'],
  ['Governance', 100, 'Proposals, votes, delegation', '#7B6FCC'],
  ['Sharing', 400, 'Referral network depth + downstream activity', '#C2537A'],
]
const MAX = 925

const USES = [
  ['DeFi vaults', 'Your fee share is weighted by your Attribution tier — up to 1.5× on the same deposit as the wallet next to you.', '/defi'],
  ['Launch liquidity', 'Team-locked, community-matched launch pools — a team that provably can’t pull its liquidity, and LPs who earn its forgone fees.', '/teams'],
  ['Agents', 'AI agents earn an on-chain reputation that compounds — machine-readable, EAS-attested.', '/agents'],
]

const CHARACTERS = [
  ['Ghost', 'Active in calm markets, dormant in chaos.'],
  ['Builder', 'Consistent protocol engagement regardless of conditions.'],
  ['Liquidity Provider', 'Concentrated LP activity and real depth.'],
]

export default function AttributionLandingPage() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="attribution" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>On-chain reputation · 100+ chains</div>
          <h1 className="font-atx-display font-medium text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[18ch] [text-wrap:balance]">
            See what your wallet is worth. <span className="text-peri">Then put it to work.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[60ch]">
            Attribution reads your complete on-chain history — every position, vote, and referral across 100+ chains — and produces one composite reputation score. Not based on wealth. Based on what you’ve actually done.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/explorer" className="glass-pill">Explore scores →</Link>
            <Link href="/app/profile" className="glass-pill">See your score →</Link>
          </div>
        </div>
      </section>

      {/* stat band */}
      <section className="bg-white border-b border-hair-soft grid grid-cols-4 max-[720px]:grid-cols-2 mx-auto max-w-[1100px]">
        {STATS.map(([n, k], i) => (
          <div key={k} className={`px-6 py-7 ${i < 3 ? 'border-r border-hair-soft' : ''} max-[720px]:[&:nth-child(-n+2)]:border-b max-[720px]:border-hair-soft max-[720px]:[&:nth-child(2)]:border-r-0`}>
            <div className="font-atx-display text-[28px] font-medium tracking-[-0.03em] text-ink">{n}</div>
            <div className="text-[9px] uppercase tracking-[0.14em] font-semibold text-ink-soft mt-1.5">{k}</div>
          </div>
        ))}
      </section>

      {/* ── 01 · The six signals ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="What the score is made of" />
          <h2 className={h2}>Six signals. <span className="text-peri">One score, out of 925.</span></h2>
          <p className={lead}>Everything you already do on-chain feeds one of six signals. Sharing is weighted heaviest — a real referral network is the hardest thing to fake.</p>
          <div className="soft-card mt-8 overflow-hidden">
            {SIGNALS.map(([name, max, desc, color], i) => (
              <div key={name} className={`flex items-center gap-5 px-6 py-4 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2 ${i < SIGNALS.length - 1 ? 'border-b border-hair-soft' : ''}`}>
                <div className="w-[130px] shrink-0">
                  <div className="font-atx-display text-[16px] font-medium text-ink">{name}</div>
                  <div className="text-[10px] text-ink-soft uppercase tracking-[0.08em]">max {max}</div>
                </div>
                <div className="flex-1 min-w-0 max-[640px]:w-full">
                  <div className="text-[13px] text-ink-mid leading-[1.4] mb-2">{desc}</div>
                  <div className="h-[10px] rounded-full relative overflow-hidden bg-ground-cool">
                    <div className="h-full absolute inset-y-0 left-0 rounded-full" style={{ width: `${(max / 400) * 100}%`, background: color as string }} />
                  </div>
                </div>
                <div className="text-[13px] text-ink-soft w-[64px] text-right shrink-0 tabular-nums max-[640px]:hidden">{Math.round((max / MAX) * 100)}% cap</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Bars scaled to Sharing’s 400-pt ceiling. Total possible score: 925.</p>
        </div>
      </section>

      {/* ── 02 · Not wealth ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Consistency over capital" />
          <h2 className={h2}>It’s not a leaderboard of <span className="text-peri">who’s richest.</span></h2>
          <p className={lead}>
            A wallet with decades of consistent, diverse on-chain activity scores higher than a whale who deployed capital
            yesterday. Short-term gaming and manufactured activity are detected and don’t produce proportional score gains —
            the specific weights are proprietary, and designed to resist exactly that.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[560px]:grid-cols-1">
            <div className="rounded-2xl bg-white border border-hair p-6">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-2">✕ Doesn’t move the score</div>
              <div className="text-[14px] text-ink-mid leading-[1.5]">Wealth deployed yesterday · wash-traded volume · a fresh wallet with a big balance · manufactured activity.</div>
            </div>
            <div className="rounded-2xl bg-white border border-hair p-6">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-2">✴ Builds the score</div>
              <div className="text-[14px] leading-[1.5] font-medium text-ink">Years of history · diverse protocol use · liquidity held with conviction · a real referral network.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 · Tiers & character ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="Tiers & character" />
          <h2 className={h2}>Bronze, Silver, Gold — <span className="text-peri">relative to everyone.</span></h2>
          <p className={lead}>Tiers are read against the distribution of all scored wallets, so they shift as the community grows. Alongside the number, a behavioural <i>character</i> describes how you move — a label, not a judgement.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[720px]:grid-cols-1">
            {CHARACTERS.map(([name, desc]) => (
              <div key={name} className="soft-card p-6">
                <div className="font-atx-display text-[16px] font-medium text-ink">{name}</div>
                <div className="text-[13px] text-ink-mid leading-[1.5] mt-2">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · Verifiable on-chain · dark pop ── */}
      <section className="relative overflow-hidden bg-ink text-white border-b border-hair-soft">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
        <div className="grain absolute inset-0 opacity-40" aria-hidden />
        <div className={`${wrap} relative py-[72px] max-[800px]:py-[52px]`}>
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">04</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">Verifiable · EAS on Base</span>
          </div>
          <h2 className="font-atx-display font-medium tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            Your score isn’t our word for it. <span className="text-pas-peri">It’s on-chain.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[60ch] mt-4">
            Any score can be published as an Ethereum Attestation Service record on Base — so a third party can verify it
            without trusting Mintware at all.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[720px]:grid-cols-1">
            {[
              ['Verifiable', 'Anyone can check the attestation on Base without trusting us.'],
              ['Portable', 'The attestation is yours — it travels with your wallet, not our database.'],
              ['Timestamped', 'A permanent, dated record of your reputation at a point in time.'],
            ].map(([k, d]) => (
              <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-6">
                <div className="font-atx-display text-[16px] font-medium text-pas-peri">{k}</div>
                <div className="text-[13px] text-white/60 leading-[1.5] mt-2">{d}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-white/45 mt-5">Three live schemas on Base: AttributionScore · SwapActivity · ReferralLink.</p>
        </div>
      </section>

      {/* ── 05 · Where it works ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="05" label="Where your score works" />
          <h2 className={h2}>One reputation. <span className="text-peri">Every surface.</span></h2>
          <p className={lead}>The score isn’t a vanity badge — it’s the multiplier that follows you across everything Mintware does.</p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[720px]:grid-cols-1">
            {USES.map(([k, d, href]) => (
              <Link key={k} href={href} className="soft-card p-6 no-underline text-inherit hover:border-[rgba(108,108,240,0.35)] transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-atx-display text-[17px] font-medium text-ink">{k}</span>
                  <span className="text-[15px] text-peri-deep">→</span>
                </div>
                <div className="text-[13px] text-ink-mid leading-[1.5] mt-2">{d}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 · For developers ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="For developers" />
          <h2 className={h2}>One call. <span className="text-peri">Any wallet, any chain.</span></h2>
          <p className={lead}>Read a full reputation profile — score, tier, percentile, per-signal breakdown, and personalised opportunities to climb — from a single endpoint.</p>
          <div className="rounded-2xl bg-ink text-white font-mono text-[13px] px-5 py-4 mt-7 overflow-x-auto">
            <span className="text-white/45">GET</span> <span className="text-pas-peri">https://attribution-scorer…/score</span><span className="text-white/70">?address=0x…</span>
            <span className="block text-white/45 mt-1">→ {'{'} score, tier, percentile, signals[], character, uvOpportunities[] {'}'}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 max-[720px]:grid-cols-1">
            {[
              ['Composite score', 'The single number, plus the six-signal breakdown behind it.'],
              ['Tier & percentile', 'Bronze / Silver / Gold, ranked against every scored wallet.'],
              ['uvOpportunities', 'Personalised protocol suggestions with the score range each could add.'],
            ].map(([k, d]) => (
              <div key={k} className="rounded-2xl bg-white border border-hair p-6">
                <div className="font-atx-display text-[13px] font-medium text-peri-deep">{k}</div>
                <div className="text-[13px] text-ink-mid leading-[1.5] mt-2">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[24ch] [text-wrap:balance]">
              Your wallet already has a history. See what it’s built.
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/explorer" className="glass-pill">Explore scores →</Link>
              <Link href="/agents" className="glass-pill">Attribution for agents →</Link>
            </div>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
