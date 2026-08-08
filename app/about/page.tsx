import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/web2/MarketingNav'
import { PageHero } from '@/components/web2/PageHero'

// =============================================================================
// /about — the mission page. Home of the mission line "Liquidity should be a
// public good" (locked to About/deck per docs/product/framing-and-messaging.md
// §1a — the *why*, never a product hero). Thesis-only: no invented bios, no
// company history, no new claims. Honest product status (Attribution live;
// vaults in testing). Ladders to /attribution + /defi.
// =============================================================================

export const metadata: Metadata = {
  title: 'About — Liquidity should be a public good | Mintware',
  description:
    'Our thesis: liquidity should be neutral, shared infrastructure that works for the people who supply it — not something one team gatekeeps, and not capital left idle. Mintware routes value by contribution, not wallet size.',
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
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4'
const h2 = 'font-bold tracking-[-0.03em] leading-[1.03] text-[clamp(26px,3.6vw,44px)] mt-3.5'
const lead = 'text-[16px] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-4'
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
const PILLARS: [string, string, string, string][] = [
  ['Measure', 'Attribution', 'On-chain reputation across 100+ chains — six signals, one score, EAS-attested on Base. Live today.', '/attribution'],
  ['Reward', 'The engine', 'Campaigns and rewards weighted by reputation, commitment, and referral quality — never by raw dollars.', '/rewards'],
  ['Hold', 'The vaults', 'Reputation-weighted Uniswap V4 liquidity — dual-sided pairs, built security-first. In testing ahead of launch.', '/defi'],
]

export default function AboutPage() {
  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      <MarketingNav />

      {/* ── HERO · the mission ── */}
      <PageHero
        size="compact"
        eyebrow="Our thesis"
        title={<>Liquidity should be a <span className="text-atx-blue">public good.</span></>}
        sub="Neutral, shared infrastructure that works for the people who supply the capital — not something one team gatekeeps, and not capital left sitting idle. That belief is why Mintware exists. Everything we build is a way of making it real."
      />

      {/* ── 01 · Why we exist (the villain) ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="01" label="Why we exist" />
          <h2 className={h2}>Today, liquidity belongs to <span style={{ color: BLUE }}>whoever got there first.</span></h2>
          <p className={lead}>
            Most tokens launch with liquidity concentrated in a handful of insider wallets. The depth that does show up is
            rented — mercenary capital that farms an emission and leaves the moment it tapers. Retail is left holding a
            market that a few parties can pull out from under them at any time. That isn’t a public good. It’s a private
            one, dressed up in the language of decentralization.
          </p>
        </div>
      </section>

      {/* ── 02 · What we mean ── */}
      <section className="border-b border-atx-ink bg-atx-blue/[0.05]">
        <div className={`${wrap} py-[52px]`}>
          <Head n="02" label="What “public good” means to us" />
          <h2 className={h2}>A market owned by the people <span style={{ color: BLUE }}>who make it.</span></h2>
          <p className={lead}>
            When you provide liquidity, that position is yours — you own your share of the market you help create. A pool
            held by thousands of contributors is a fundamentally different thing than one team’s treasury lever. Our job is
            to make that contribution <b>visible</b> and <b>paid</b>: to price the quality of what a wallet actually did,
            and route value to it — so being early, staying long, and bringing good people in is worth something real.
          </p>
        </div>
      </section>

      {/* ── 03 · How we build it ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="03" label="How we build it" />
          <h2 className={h2}>Measure it. Reward it. <span style={{ color: BLUE }}>Hold it.</span></h2>
          <p className={lead}>Three parts, one idea — contribution, priced and paid. We say plainly what’s live and what’s still in testing.</p>
          <div className="grid grid-cols-3 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            {PILLARS.map(([verb, name, d, href], i) => (
              <Link key={name} href={href} className={`p-6 no-underline text-inherit hover:bg-atx-panel transition-colors ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-atx-coral shrink-0" />
                  <span className={ey}>{verb}</span>
                </div>
                <div className="text-[19px] font-bold mt-3">{name}</div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5] mt-2">{d}</div>
                <div className="font-atx-mono text-[13px] text-atx-blue mt-3">Learn more →</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · The principle ── */}
      <section className="border-b border-atx-ink bg-atx-ink text-atx-bone">
        <div className={`${wrap} py-[56px]`}>
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-acid">04</span>
            <span className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-bone/55">The principle</span>
          </div>
          <h2 className="font-bold tracking-[-0.03em] leading-[1.05] text-[clamp(28px,4.2vw,52px)] mt-4 max-w-[20ch]">
            Contribution, not wallet size, <span className="text-atx-acid">decides what you earn.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-atx-bone/70 max-w-[60ch] mt-5">
            It’s a single rule, applied everywhere: the wallet that showed up for years should out-earn the one that showed
            up yesterday with more money. Reputation is portable, earned, and non-custodial — you hold your keys and your
            assets throughout. We’re building the rail that pays people for the markets they actually help build.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[38px] flex items-center justify-between flex-wrap gap-4`}>
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[26ch]">
            Your wallet already has a history. See what it’s built.
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/attribution" className={btnAcc}>Explore Attribution →</Link>
            <Link href="/defi" className={btnGhost}>How the vaults work →</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
