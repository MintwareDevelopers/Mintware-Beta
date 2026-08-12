import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/web2/MarketingNav'
import { PageHero } from '@/components/web2/PageHero'

// =============================================================================
// /attribution — marketing landing for the Attribution reputation layer.
// Footer-linked only. Grounded in docs/overview/attribution.md: six signals,
// max 925, "not based on wealth", 100+ chains, EAS verifiability, up-to-1.95x
// multiplier. No invented stats — reuses the homepage stat block verbatim.
// =============================================================================

export const metadata: Metadata = {
  title: 'Attribution — On-chain reputation, scored | Mintware',
  description:
    'Attribution reads your complete on-chain history across 100+ chains and produces one composite reputation score from six signals. Not based on wealth — based on contribution. Verifiable on Base via EAS.',
}

const BLUE = 'var(--color-atx-blue)'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-bold tracking-[-0.03em] leading-[1.03] text-[clamp(26px,3.6vw,44px)] mt-3.5'
const lead = 'text-[16px] leading-[1.55] text-atx-ink/70 max-w-[60ch] mt-4'
const btnAcc = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-blue bg-atx-blue text-white no-underline inline-block cursor-pointer'
const btnGhost = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-ink bg-atx-bone text-atx-ink no-underline inline-block cursor-pointer'

function Head({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3.5">
      <span className="font-atx-mono text-[12px] text-atx-blue">{n}</span>
      <span className={ey}>{label}</span>
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
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      <MarketingNav active="attribution" />

      {/* ── HERO ── */}
      <PageHero
        size="compact"
        eyebrow="On-chain reputation · 100+ chains"
        title={<>Your contribution should mean <span className="text-atx-blue">something.</span></>}
        sub="Attribution reads your complete on-chain history — every position, vote, and referral across 100+ chains — and produces one composite reputation score. Not based on wealth. Based on what you’ve actually done."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/explorer" className={btnAcc}>Explore scores →</Link>
          <Link href="/app/profile" className={btnGhost}>See your score →</Link>
        </div>
      </PageHero>

      {/* stat band */}
      <section className="border-b border-atx-ink grid grid-cols-4 max-[720px]:grid-cols-2">
        {STATS.map(([n, k], i) => (
          <div key={k} className={`px-6 py-6 ${i < 3 ? 'border-r border-atx-ink' : ''} max-[720px]:[&:nth-child(-n+2)]:border-b max-[720px]:border-atx-ink max-[720px]:[&:nth-child(2)]:border-r-0`}>
            <div className="font-atx-mono text-[28px] font-bold tracking-[-0.03em]">{n}</div>
            <div className="font-atx-mono text-[9px] uppercase tracking-[0.14em] text-atx-ink/55 mt-1.5">{k}</div>
          </div>
        ))}
      </section>

      {/* ── 01 · The six signals ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="01" label="What the score is made of" />
          <h2 className={h2}>Six signals. <span style={{ color: BLUE }}>One score, out of 925.</span></h2>
          <p className={lead}>Everything you already do on-chain feeds one of six signals. Sharing is weighted heaviest — a real referral network is the hardest thing to fake.</p>
          <div className="border border-atx-ink mt-8">
            {SIGNALS.map(([name, max, desc, color], i) => (
              <div key={name} className={`flex items-center gap-5 px-6 py-4 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2 ${i < SIGNALS.length - 1 ? 'border-b border-atx-ink/15' : ''}`}>
                <div className="w-[130px] shrink-0">
                  <div className="text-[16px] font-bold">{name}</div>
                  <div className="font-atx-mono text-[10px] text-atx-ink/45 uppercase tracking-[0.08em]">max {max}</div>
                </div>
                <div className="flex-1 min-w-0 max-[640px]:w-full">
                  <div className="text-[13px] text-atx-ink/60 leading-[1.4] mb-2">{desc}</div>
                  <div className="h-[10px] border border-atx-ink relative overflow-hidden bg-atx-bone">
                    <div className="h-full absolute inset-y-0 left-0" style={{ width: `${(max / 400) * 100}%`, background: color as string }} />
                  </div>
                </div>
                <div className="font-atx-mono text-[13px] text-atx-ink/40 w-[64px] text-right shrink-0 max-[640px]:hidden">{Math.round((max / MAX) * 100)}% cap</div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[11px] text-atx-mesquite mt-4"><b className="text-atx-blue">↳</b> Bars scaled to Sharing’s 400-pt ceiling. Total possible score: 925.</p>
        </div>
      </section>

      {/* ── 02 · Not wealth ── */}
      <section className="border-b border-atx-ink bg-atx-blue/[0.05]">
        <div className={`${wrap} py-[52px]`}>
          <Head n="02" label="Consistency over capital" />
          <h2 className={h2}>It’s not a leaderboard of <span style={{ color: BLUE }}>who’s richest.</span></h2>
          <p className={lead}>
            A wallet with decades of consistent, diverse on-chain activity scores higher than a whale who deployed capital
            yesterday. Short-term gaming and manufactured activity are detected and don’t produce proportional score gains —
            the specific weights are proprietary, and designed to resist exactly that.
          </p>
          <div className="grid grid-cols-2 border border-atx-ink mt-8 bg-atx-bone max-[560px]:grid-cols-1">
            <div className="p-6 border-r border-atx-ink max-[560px]:border-r-0 max-[560px]:border-b">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-ink/45 mb-2">✕ Doesn’t move the score</div>
              <div className="text-[14px] text-atx-ink/70 leading-[1.5]">Wealth deployed yesterday · wash-traded volume · a fresh wallet with a big balance · manufactured activity.</div>
            </div>
            <div className="p-6">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-blue mb-2">✴ Builds the score</div>
              <div className="text-[14px] leading-[1.5] font-medium">Years of history · diverse protocol use · liquidity held with conviction · a real referral network.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 · Tiers & character ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="03" label="Tiers & character" />
          <h2 className={h2}>Bronze, Silver, Gold — <span style={{ color: BLUE }}>relative to everyone.</span></h2>
          <p className={lead}>Tiers are read against the distribution of all scored wallets, so they shift as the community grows. Alongside the number, a behavioural <i>character</i> describes how you move — a label, not a judgement.</p>
          <div className="grid grid-cols-3 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            {CHARACTERS.map(([name, desc], i) => (
              <div key={name} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <Star className="w-4 h-4 text-atx-blue" />
                  <span className="text-[16px] font-bold">{name}</span>
                </div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5]">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · Verifiable on-chain ── */}
      <section className="border-b border-atx-ink bg-atx-ink text-atx-bone">
        <div className={`${wrap} py-[52px]`}>
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-acid">04</span>
            <span className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-bone/55">Verifiable · EAS on Base</span>
          </div>
          <h2 className={`${h2} text-atx-bone`}>Your score isn’t our word for it. <span className="text-atx-acid">It’s on-chain.</span></h2>
          <p className="text-[16px] leading-[1.55] text-atx-bone/70 max-w-[60ch] mt-4">
            Any score can be published as an Ethereum Attestation Service record on Base — so a third party can verify it
            without trusting Mintware at all.
          </p>
          <div className="grid grid-cols-3 border border-atx-bone/25 mt-8 max-[720px]:grid-cols-1">
            {[
              ['Verifiable', 'Anyone can check the attestation on Base without trusting us.'],
              ['Portable', 'The attestation is yours — it travels with your wallet, not our database.'],
              ['Timestamped', 'A permanent, dated record of your reputation at a point in time.'],
            ].map(([k, d], i) => (
              <div key={k} className={`p-6 ${i < 2 ? 'border-r border-atx-bone/25 max-[720px]:border-r-0 max-[720px]:border-b' : ''}`}>
                <div className="text-[16px] font-bold text-atx-acid">{k}</div>
                <div className="text-[13px] text-atx-bone/60 leading-[1.5] mt-2">{d}</div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[11px] text-atx-bone/45 mt-5">Four live schemas on Base: AttributionScore · SwapActivity · ReferralLink · CampaignReward.</p>
        </div>
      </section>

      {/* ── 05 · Where it works ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="05" label="Where your score works" />
          <h2 className={h2}>One reputation. <span style={{ color: BLUE }}>Every surface.</span></h2>
          <p className={lead}>The score isn’t a vanity badge — it’s the multiplier that follows you across everything Mintware does.</p>
          <div className="grid grid-cols-2 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            {USES.map(([k, d, href], i) => (
              <Link key={k} href={href} className={`p-6 no-underline text-inherit hover:bg-atx-panel transition-colors ${i % 2 === 0 ? 'border-r border-atx-ink max-[720px]:border-r-0' : ''} ${i < 2 ? 'border-b border-atx-ink' : ''} max-[720px]:border-r-0 max-[720px]:[&:not(:last-child)]:border-b max-[720px]:border-atx-ink`}>
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-bold">{k}</span>
                  <span className="font-atx-mono text-[15px] text-atx-blue">→</span>
                </div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5] mt-2">{d}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 · For developers ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className={`${wrap} py-[52px]`}>
          <Head n="06" label="For developers" />
          <h2 className={h2}>One call. <span style={{ color: BLUE }}>Any wallet, any chain.</span></h2>
          <p className={lead}>Read a full reputation profile — score, tier, percentile, per-signal breakdown, and personalised opportunities to climb — from a single endpoint.</p>
          <div className="border border-atx-ink bg-atx-ink text-atx-bone font-atx-mono text-[13px] px-5 py-4 mt-7 overflow-x-auto">
            <span className="text-atx-bone/45">GET</span> <span className="text-atx-acid">https://attribution-scorer…/score</span><span className="text-atx-bone/70">?address=0x…</span>
            <span className="block text-atx-bone/45 mt-1">→ {'{'} score, tier, percentile, signals[], character, uvOpportunities[] {'}'}</span>
          </div>
          <div className="grid grid-cols-3 border border-atx-ink bg-atx-bone mt-4 max-[720px]:grid-cols-1">
            {[
              ['Composite score', 'The single number, plus the six-signal breakdown behind it.'],
              ['Tier & percentile', 'Bronze / Silver / Gold, ranked against every scored wallet.'],
              ['uvOpportunities', 'Personalised protocol suggestions with the score range each could add.'],
            ].map(([k, d], i) => (
              <div key={k} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="font-atx-mono text-[13px] font-bold text-atx-blue">{k}</div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5] mt-2">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[38px] flex items-center justify-between flex-wrap gap-4`}>
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[24ch]">
            Your wallet already has a history. See what it’s built.
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/explorer" className={btnAcc}>Explore scores →</Link>
            <Link href="/agents" className={btnGhost}>Attribution for agents →</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
