import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'

// =============================================================================
// /about — the mission page. Home of "Liquidity should be a public good"
// (locked to About/deck per docs/product/framing-and-messaging.md §1a — the
// *why*, never a product hero). Thesis-only: no invented bios/history/claims.
// Honest product status (Attribution live; vaults in testing). Design v2.
// =============================================================================

export const metadata: Metadata = {
  title: 'About — Liquidity should be a public good | Mintware',
  description:
    'Our thesis: liquidity should be neutral, shared infrastructure that works for the people who supply it — not something one team gatekeeps, and not capital left idle. Mintware routes value by contribution, not wallet size.',
}

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 [text-wrap:balance]'
const lead = 'text-[16px] leading-[1.55] text-ink-mid max-w-[62ch] mt-4'

function Head({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[12px] font-semibold text-peri-deep tabular-nums">{n}</span>
      <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-ink-soft">{label}</span>
    </div>
  )
}

// ── data ─────────────────────────────────────────────────────────────────────
const PILLARS: [string, string, string, string][] = [
  ['Earn', 'The vault engine', 'One balance earns three ways at once — Aave lending, Uniswap V4 market-making, and recaptured MEV. Dual-sided pairs, built security-first. In testing ahead of launch.', '/vaults'],
  ['Spend', 'The Liquid Sovereign Account', 'Your balance stays spendable as USDC — on a card or over x402 — while it keeps earning. Never idle, never locked, always yours.', '/yield-payment-network'],
  ['Match', 'Liquidity for teams', 'Teams lock their token, the community matches in USDC — real depth and tighter spreads, with every fee during the lock going to the community.', '/teams'],
]

export default function AboutPage() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* ── HERO · the mission ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>Our thesis</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[15ch] [text-wrap:balance]">
            Liquidity should be a <span className="text-gradient-accent">public good.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Neutral, shared infrastructure that works for the people who supply the capital — not something one team gatekeeps, and not capital left sitting idle. That belief is why Mintware exists. Everything we build is a way of making it real.
          </p>
        </div>
      </section>

      {/* ── 01 · Why we exist ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="Why we exist" />
          <h2 className={h2}>Today, liquidity belongs to <span className="text-gradient-accent">whoever got there first.</span></h2>
          <p className={lead}>
            Most tokens launch with liquidity concentrated in a handful of insider wallets. The depth that does show up is
            rented — mercenary capital that farms an emission and leaves the moment it tapers. Retail is left holding a
            market that a few parties can pull out from under them at any time. That isn’t a public good. It’s a private
            one, dressed up in the language of decentralization.
          </p>
        </div>
      </section>

      {/* ── 02 · What we mean ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="What “public good” means to us" />
          <h2 className={h2}>A market owned by the people <span className="text-gradient-accent">who make it.</span></h2>
          <p className={lead}>
            When you provide liquidity, that position is yours — you own your share of the market you help create. A pool
            held by thousands of contributors is a fundamentally different thing than one team’s treasury lever. Our job is
            to make that contribution <b className="text-ink">visible</b> and <b className="text-ink">paid</b>: to price the quality of what a wallet actually did,
            and route value to it — so being early, staying long, and bringing good people in is worth something real.
          </p>
        </div>
      </section>

      {/* ── 03 · How we build it ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="How we build it" />
          <h2 className={h2}>Measure it. Reward it. <span className="text-gradient-accent">Hold it.</span></h2>
          <p className={lead}>Three parts, one idea — contribution, priced and paid. We say plainly what’s live and what’s still in testing.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[720px]:grid-cols-1">
            {PILLARS.map(([verb, name, d, href]) => (
              <Link key={name} href={href} className="soft-card p-6 no-underline text-inherit hover:border-[rgba(108,108,240,0.35)] transition-colors">
                <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{verb}</span>
                <div className="font-atx-display text-[19px] font-medium mt-3 text-ink">{name}</div>
                <div className="text-[13px] text-ink-mid leading-[1.5] mt-2">{d}</div>
                <div className="text-[13px] font-semibold text-peri-deep mt-3">Learn more →</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · The principle · dark pop ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(58% 120% at 12% 0%, rgba(108,108,240,0.38), transparent 60%), radial-gradient(52% 130% at 100% 100%, rgba(244,161,131,0.16), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[80px] max-[800px]:py-[56px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">04</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">The principle</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.04em] leading-[1.03] text-[clamp(1.9rem,4.4vw,3.2rem)] mt-4 max-w-[20ch] text-white [text-wrap:balance]">
            Contribution, not wallet size, <span className="text-gradient-accent">decides what you earn.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[60ch] mt-5">
            It’s a single rule, applied everywhere: the wallet that showed up for years should out-earn the one that showed
            up yesterday with more money. Reputation is portable, earned, and non-custodial — you hold your keys and your
            assets throughout. We’re building the rail that pays people for the markets they actually help build.
          </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[26ch] [text-wrap:balance]">
              Liquidity that never sits still. See what it can do.
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/vaults" className="glass-pill-primary">Explore the vaults →</Link>
              <Link href="/defi" className="glass-pill">How the vaults work →</Link>
            </div>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
