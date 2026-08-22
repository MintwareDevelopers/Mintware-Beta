import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'

// =============================================================================
// /solutions/companies — PUBLIC marketing surface making Mintware's case for
// crypto-native companies, startups, and businesses running on-chain treasuries
// + team spend. Vision page (see solutions-pages-spec): confident, present-tense,
// minimal hedging. ONE concentrated honesty note (COPY.honesty) carries the
// legal weight; a small Sources line credits the cited data.
//
// House style: V2Nav + periwinkle-pastel v2 tokens, light-only, sibling to
// /yield-payment-network. Copy lives in the COPY const below.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Companies — Mintware',
  description:
    'A corporate treasury that earns while it stays spendable. Non-custodial USDC that puts idle cash to work in DeFi, with role-capped team cards and vendor payouts on the same balance — native USDC settlement, no lockups. In testing on testnet.',
}

const COPY = {
  hero: {
    eyebrow: 'Mintware for Companies',
    title: 'Your treasury should be',
    titleAccent: 'earning and spendable —',
    titleRest: 'at the same time.',
    sub: 'Crypto-native companies hold their runway in stablecoins, then leave it idle in a wallet earning nothing — because the moment it earns, it stops being spendable. Mintware ends that trade-off: one non-custodial USDC balance that keeps working in DeFi while your team spends it on cards and pays vendors, at par, in real time.',
    ctaPrimary: { label: 'See the treasury terminal', href: '/teams' },
    ctaSecondary: { label: 'Read the proof', href: '/proof' },
  },

  // Two macro trends + one vertical-specific line — the market backdrop.
  trends: {
    eyebrow: 'The backdrop',
    title: 'On-chain corporate finance stopped being a pilot.',
    body: 'Two curves are bending at once: company treasuries are moving into stablecoins, and real-world spend is moving onto stablecoin rails. Mintware sits exactly where they cross.',
    stats: [
      { value: '$316B', label: 'Total stablecoin supply by Apr 2026 — up 54% from the start of 2025.', src: 'CoinDesk / Grant Graham' },
      { value: '~$226B', label: 'B2B stablecoin payments in 2025, up 733% year-on-year — now ~60% of real stablecoin volume.', src: 'Artemis / Bancoli' },
      { value: '~$18B', label: 'Annualized crypto card spend by early 2026 — ~15× the 2023 run-rate, +525% in 2025 alone.', src: 'CoinDesk' },
      { value: '>90%', label: 'Share of on-chain crypto card volume settled over Visa rails.', src: 'insights4vc' },
    ],
  },

  problem: {
    eyebrow: 'The problem',
    title: 'Runway in a wallet is runway rotting.',
    body: 'Finance teams face the same broken menu everyone else does — pick liquidity or pick yield, never both. So the safe choice is to hold operating cash idle and eat the opportunity cost. And when spend does happen, it is a mess of manual off-ramps, separate cards, and vendor wires disconnected from where the money actually lives.',
    points: [
      { k: 'Idle by default', v: 'Companies keep trillions in near-zero-interest accounts because moving cash into yield means locking it or unwinding it before every payment.' },
      { k: 'Spend is bolted on', v: 'Team cards, vendor payouts, and treasury sit in three different systems — none of them earning, none of them aware of the others.' },
      { k: 'Custody is a liability', v: 'Handing runway to a centralized yield product means counterparty risk, uninsured balances, and no keys of your own.' },
    ],
  },

  solution: {
    eyebrow: 'How Mintware solves it',
    title: 'One balance. Always working. Always spendable.',
    body: 'Mintware is the Yield Payment Network — a treasury balance that stays spendable at par, like cash, while the capital keeps earning in DeFi. Every company function draws on that same productive balance.',
    cards: [
      {
        index: '01',
        title: 'Put idle treasury to work — without giving up liquidity',
        body: 'USDC in the vault earns protocol-native yield from the pools it backs: idle capital is rehypothecated into lending, and just-in-time V4 liquidity recaptures fees and MEV that would otherwise leak to arbitrageurs. Your operating cash stops sitting still.',
      },
      {
        index: '02',
        title: 'Spend straight from the earning balance',
        body: 'A card swipe or a vendor payout is a hold against the position, then a settle — the balance never has to un-park to be spent. No off-ramp, no unwind, no cashing out first. Never idle, never locked.',
      },
      {
        index: '03',
        title: 'Role-capped team cards + vendor payouts',
        body: 'The team treasury terminal issues cards with per-role daily caps, runs vendor payouts, and enforces policy and approvals — all on the same non-custodial balance. Belt-and-suspenders: a role cap plus an independent authorization check on every spend.',
      },
      {
        index: '04',
        title: 'Native USDC settlement, your keys',
        body: 'Settlement is USDC-native over Circle / Arc rails with CCTP bridging; card spend runs through a regulated card partner. Mintware never touches fiat and never takes custody — funds live in your wallet or in autonomous, audited contracts.',
      },
    ],
  },

  // Worked-math block — honest opportunity-cost model, illustrative yields.
  math: {
    eyebrow: 'The math',
    title: 'What idle runway actually costs.',
    body: 'A simple, defensible model. A startup that parks $2M of runway idle for a year gives up the yield it could have earned with no loss of liquidity — because on Mintware the same $2M stays fully spendable while it works.',
    rows: [
      { label: 'Runway held idle in a wallet', sub: 'spendable, ~0% yield', value: '$0 / yr', tone: 'flat' },
      { label: 'Same $2M, productive + spendable', sub: 'illustrative ~5% blended, still 100% spendable', value: '≈ $100,000 / yr', tone: 'earn' },
      { label: 'Opportunity cost of doing nothing', sub: 'at no loss of liquidity', value: '≈ $100,000 / yr', tone: 'accent' },
    ],
    footnote:
      'Illustrative only. Reputable USDC lending venues have ranged roughly 3.5–9% through 2026 (Aave USDC ~3–5% on Ethereum, higher on Base/Arbitrum); LP + rehypothecation strategies target the upper end. A blended ~5% is a modelling assumption, not a promised or fixed rate — actual yield is variable and set by the market.',
  },

  terminal: {
    eyebrow: 'The treasury terminal',
    title: 'A finance stack, not a wallet.',
    body: 'Multi-tenant org treasuries give the whole company one productive balance with real controls on top of it.',
    features: [
      { k: 'Role-capped cards', v: 'Issue cards mapped to roles, each with its own daily cap. Contributor spend is bounded by policy, not trust.' },
      { k: 'Vendor payouts', v: 'Pay suppliers in USDC from the same balance the treasury earns on — no separate float to fund.' },
      { k: 'Policy & approvals', v: 'Approval flows and spend policy are enforced in the terminal before value ever moves.' },
      { k: 'Every spend, double-checked', v: 'A role cap (the belt) plus an independent authorization check off live balance (the suspenders) gate each card swipe.' },
    ],
  },

  // The single deliberate dark-pop moment (house style) — the mechanics, honestly.
  mechanics: {
    eyebrow: 'The mechanics, honestly',
    title: 'How the dollar stays a dollar.',
    intro: 'The reason a spendable balance can also be a working one is the structure underneath it.',
    items: [
      { k: 'Structured tranches', v: 'Company capital can sit senior and price-free — behaving like a dollar — while a first-loss junior tranche absorbs market moves. The volatility lands on the tranche built to take it.' },
      { k: 'Solvency-aware redemption', v: 'Par while the first-loss cushion covers it; a fair, transparent pro-rata outcome in the tail. No race for the exit, no first-redeemer advantage.' },
      { k: 'Non-custodial by design', v: 'Self-custody via Privy + external wallets. Mintware never holds your keys; value lives in your wallet or in autonomous contracts.' },
      { k: 'Native USDC rails', v: 'USDC-native settlement + CCTP bridging on Circle / Arc; a regulated partner carries the card and fiat legs. Mintware never touches fiat.' },
    ],
  },

  honesty:
    'Honest status: Mintware is in testing on testnet (Base Sepolia + Circle’s Arc testnet), pre-launch and unaudited — the whole loop has been proven end-to-end on-chain with real transaction hashes, but on empty vaults with valueless test USDC. This page describes the vision and where we are building to, not a live production service. Nothing here is a deposit, a savings or insured account, a guaranteed or fixed yield, or an offer, investment, legal, or tax advice; illustrative figures are models, not promises. External audit and a production card/settlement partner gate real value.',

  trust: {
    eyebrow: 'Why trust it',
    title: 'Proven in the open, before a dollar is real.',
    body: 'We would rather show the plumbing working than ask you to take our word for it.',
    points: [
      { k: 'Non-custodial', v: 'Your keys, your funds. Mintware and its contracts never take custody.' },
      { k: 'Testnet-proven end to end', v: 'Deposit → earn → authorize → spend, plus a native USDC bridge — every leg executed on-chain with real, explorable hashes.' },
      { k: 'Self-reviewed & hardened', v: 'An audit-readiness pass with 0 Criticals and all Highs remediated, on top of formal, machine-checked verification of the money-path invariants.' },
      { k: 'Built on Circle / Arc rails', v: 'USDC-native settlement and CCTP bridging on Circle’s infrastructure — not a bespoke bridge of our own.' },
    ],
    cta: { label: 'See the on-chain proof', href: '/proof' },
  },

  cta: {
    eyebrow: 'Where to start',
    title: 'Bring your treasury on-chain — and put it to work.',
    body: 'Explore the treasury terminal, read the end-to-end proof, or get the full model behind the numbers. No wallet, no sign-in required to look.',
    primary: { label: 'Explore the treasury terminal', href: '/teams' },
    secondary: { label: 'Read the vision (YPN)', href: '/yield-payment-network' },
    tertiary: { label: 'The math', href: '/the-math' },
  },

  sources:
    'Sources: CoinDesk Research & “Crypto card spending hits $18B” (Jan 2026); Grant Graham, “Stablecoins in Corporate Treasury” (2026); Artemis Analytics & Bancoli B2B stablecoin data (2025–26); insights4vc, “The State of Stablecoin Cards” (2026); eco.com USDC-yield comparison (2026); Vesto / Slash startup-treasury guidance. Figures are dated and approximate; yield ranges are illustrative.',
} as const

export default function CompaniesSolutionPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="teams" />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 pt-[72px] pb-[64px] max-[800px]:pt-[52px] max-[800px]:pb-[44px]">
          <div className="text-[12px] uppercase tracking-[0.14em] font-semibold text-peri-deep font-atx-display">
            {COPY.hero.eyebrow}
          </div>
          <h1 className="font-atx-display font-bold text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(2.2rem,5.6vw,3.6rem)] mt-4 max-w-[18ch] [text-wrap:balance]">
            {COPY.hero.title} <span className="text-gradient-accent">{COPY.hero.titleAccent}</span> {COPY.hero.titleRest}
          </h1>
          <p className="text-ink-mid text-[clamp(15px,1.9vw,19px)] leading-[1.55] mt-6 max-w-[64ch]">
            {COPY.hero.sub}
          </p>
          <div className="mt-8 flex items-center gap-3.5 flex-wrap">
            <Link href={COPY.hero.ctaPrimary.href} className="glass-pill glass-pill-primary no-underline">
              {COPY.hero.ctaPrimary.label} →
            </Link>
            <Link href={COPY.hero.ctaSecondary.href} className="glass-pill no-underline">
              {COPY.hero.ctaSecondary.label}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Trends / market backdrop ─────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.trends.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.8rem)] mt-3 max-w-[20ch] [text-wrap:balance]">
            {COPY.trends.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[66ch]">{COPY.trends.body}</p>
          <div className="grid grid-cols-4 max-[820px]:grid-cols-2 max-[460px]:grid-cols-1 gap-3.5 mt-8">
            {COPY.trends.stats.map((s) => (
              <div key={s.value} className="rounded-[16px] border border-hair bg-white shadow-card p-5">
                <div className="font-atx-display font-bold text-[clamp(1.7rem,3vw,2.1rem)] tracking-[-0.02em] tabular-nums text-ink">
                  {s.value}
                </div>
                <div className="text-[12.5px] text-ink-mid mt-2 leading-[1.45]">{s.label}</div>
                <div className="text-[10.5px] text-ink-soft mt-2 font-mono uppercase tracking-[0.04em]">{s.src}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The problem ──────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.problem.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.8rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {COPY.problem.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{COPY.problem.body}</p>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {COPY.problem.points.map((p) => (
              <div key={p.k} className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{p.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{p.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How Mintware solves it ───────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.solution.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {COPY.solution.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{COPY.solution.body}</p>
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-8">
            {COPY.solution.cards.map((c) => (
              <div key={c.index} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-mono text-[11px] text-peri-deep tabular-nums">{c.index}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mt-2 mb-2 [text-wrap:balance]">{c.title}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The math ─────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.math.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.8rem)] mt-3 max-w-[16ch] [text-wrap:balance]">
            {COPY.math.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[66ch]">{COPY.math.body}</p>
          <div className="mt-8 rounded-[var(--radius-card)] border border-hair shadow-card overflow-hidden bg-white">
            {COPY.math.rows.map((r, i) => (
              <div
                key={r.label}
                className={`grid grid-cols-[1fr_auto] gap-4 items-center px-6 py-5 ${i < COPY.math.rows.length - 1 ? 'border-b border-hair-soft' : ''} ${r.tone === 'accent' ? 'bg-ground-cool' : ''}`}
              >
                <div className="min-w-0">
                  <div className={`font-atx-display font-semibold text-[15px] tracking-[-0.01em] ${r.tone === 'accent' ? 'text-peri-deep' : 'text-ink'}`}>{r.label}</div>
                  <div className="text-[12.5px] text-ink-soft mt-0.5">{r.sub}</div>
                </div>
                <div
                  className={`font-atx-display font-bold text-[clamp(1.1rem,2.4vw,1.5rem)] tabular-nums text-right ${
                    r.tone === 'flat' ? 'text-ink-soft' : r.tone === 'earn' ? 'text-mw-green' : 'text-peri-deep'
                  }`}
                >
                  {r.value}
                </div>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-ink-soft mt-5 max-w-[76ch] leading-[1.55]">{COPY.math.footnote}</p>
        </div>
      </section>

      {/* ── The treasury terminal ────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.terminal.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.8rem)] mt-3 max-w-[16ch] [text-wrap:balance]">
            {COPY.terminal.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[66ch]">{COPY.terminal.body}</p>
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-8">
            {COPY.terminal.features.map((f) => (
              <div key={f.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{f.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{f.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The mechanics, honestly (the single dark-pop moment) ─────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[40px]">
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(60% 120% at 85% 0%, rgba(108,108,240,0.55), transparent 55%), radial-gradient(50% 110% at 8% 100%, rgba(244,161,131,0.35), transparent 55%)' }}
            />
            <div className="relative px-10 py-11 max-[700px]:px-6 max-[700px]:py-8">
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-pas-peri">{COPY.mechanics.eyebrow}</div>
              <h2 className="font-atx-display font-semibold text-white tracking-[-0.03em] leading-[1.06] text-[clamp(1.7rem,3.6vw,2.4rem)] mt-3 [text-wrap:balance]">
                {COPY.mechanics.title}
              </h2>
              <p className="text-[15px] leading-[1.6] mt-3.5 max-w-[58ch]" style={{ color: '#C7C7DC' }}>{COPY.mechanics.intro}</p>
              <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-8 gap-y-5 mt-7">
                {COPY.mechanics.items.map((it) => (
                  <div key={it.k} className="border-t border-white/15 pt-4">
                    <div className="font-atx-display font-semibold text-[15.5px] text-white">{it.k}</div>
                    <div className="text-[13px] leading-[1.5] mt-1" style={{ color: '#B9B9D0' }}>{it.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Honesty note (the one concentrated disclosure) ───────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 pb-[40px]">
          <div
            className="rounded-[16px] border border-hair p-5 text-[13px] text-ink-mid leading-[1.6]"
            style={{ background: 'linear-gradient(120deg, rgba(196,122,0,0.09), var(--color-ground-deep, #EEEEF7))' }}
          >
            <b className="text-ink">Testnet · unaudited · not an offer.</b> {COPY.honesty}
          </div>
        </div>
      </section>

      {/* ── Why trust it ─────────────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.trust.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.8rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {COPY.trust.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[64ch]">{COPY.trust.body}</p>
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-8">
            {COPY.trust.points.map((p) => (
              <div key={p.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{p.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{p.v}</p>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <Link href={COPY.trust.cta.href} className="glass-pill no-underline">{COPY.trust.cta.label} →</Link>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{COPY.cta.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(2rem,4.4vw,3.1rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {COPY.cta.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.8vw,18px)] leading-[1.55] mt-5 max-w-[62ch]">{COPY.cta.body}</p>
          <div className="mt-8 flex items-center gap-3.5 flex-wrap">
            <Link href={COPY.cta.primary.href} className="glass-pill glass-pill-primary no-underline">{COPY.cta.primary.label} →</Link>
            <Link href={COPY.cta.secondary.href} className="glass-pill no-underline">{COPY.cta.secondary.label}</Link>
            <Link href={COPY.cta.tertiary.href} className="glass-pill no-underline">{COPY.cta.tertiary.label}</Link>
          </div>

          <Fragment>
            <p className="text-[11px] text-ink-soft mt-12 max-w-[80ch] leading-[1.55]">{COPY.sources}</p>
          </Fragment>
        </div>
      </section>
    </div>
  )
}
