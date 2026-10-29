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
    'MarketEngine liquidity and Earn-share card refill on Robinhood Chain testnet. Unaudited; external audit gates real value.',
}

const COPY = {
  hero: {
    eyebrow: 'Mintware for Companies',
    title: 'Your treasury should be',
    titleAccent: 'earning and spendable —',
    titleRest: 'at the same time.',
    sub: 'Current curated liquidity uses MarketEngine: one quote-valued share token for each selected Uniswap v4 pool. Card rails are Bridge + Stripe, pre-enable; the payment gateway only refills a member-registered buffer from Earn shares.',
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
    body: 'The former spend-from-NAV treasury design is retired. Current liquidity and card refill are separate paths with distinct contracts.',
    cards: [
      {
        index: '01',
        title: 'Put idle treasury to work — without giving up liquidity',
        body: 'MarketEngine capital sits in a resting v4 band plus per-token ERC-4626 adapters. Robinhood testnet adapters are idle custody and do not earn yield.',
      },
      {
        index: '02',
        title: 'Refill a registered buffer',
        body: 'The payment relayer redeems Earn shares to the member’s registered buffer wallet. Purchases do not settle from vault NAV.',
      },
      {
        index: '03',
        title: 'Role-capped team cards + vendor payouts',
        body: 'Bridge + Stripe card rails are pre-enable. The on-chain gateway supports refills only; it does not authorize purchases or settle merchants.',
      },
      {
        index: '04',
        title: 'Native USDC settlement, your keys',
        body: 'Arc/CCTP settlement is retired. Current card rails are Bridge + Stripe, pre-enable. Contracts are testnet-only and unaudited.',
      },
    ],
  },

  // Worked-math block — honest opportunity-cost model, illustrative yields.
  math: {
    eyebrow: 'The math',
    title: 'What idle runway actually costs.',
    body: 'MarketEngine shares represent quote-asset value in one curated pool. The Robinhood testnet adapters do not earn yield.',
    rows: [
      { label: 'Runway held idle in a wallet', sub: 'spendable, ~0% yield', value: '$0 / yr', tone: 'flat' },
      { label: 'Robinhood testnet adapters', sub: 'idle custody · no adapter yield', value: 'Testnet', tone: 'earn' },
      { label: 'Current share value', sub: 'denominated in the quote asset', value: 'MarketEngine', tone: 'accent' },
    ],
    footnote:
      'This page does not provide a yield projection. External audit gates real value.',
  },

  terminal: {
    eyebrow: 'The treasury terminal',
    title: 'A finance stack, not a wallet.',
    body: 'The current on-chain payment gateway only supports Earn-share refills to registered member buffers.',
    features: [
      { k: 'Bridge + Stripe', v: 'Card rails are pre-enable.' },
      { k: 'Refill only', v: 'The relayer redeems Earn shares to the member’s registered buffer wallet.' },
      { k: 'No spend from NAV', v: 'Purchases do not settle against the vault.' },
      { k: 'Testnet status', v: 'Live on Robinhood Chain testnet · unaudited.' },
    ],
  },

  // The single deliberate dark-pop moment (house style) — the mechanics, honestly.
  mechanics: {
    eyebrow: 'The mechanics, honestly',
    title: 'How the current engine works.',
    intro: 'MarketEngine offers quote-valued shares and pro-rata in-kind exits for a curated pool.',
    items: [
      { k: 'Deposit guard', v: 'Deposits need a fresh mark and pool spot near that mark.' },
      { k: 'Resting band', v: 'Capital sits in the Uniswap v4 band plus per-token adapters.' },
      { k: 'Pro-rata exit', v: 'Withdrawals return both pool tokens in kind with minimum outputs.' },
      { k: 'Retired flows', v: 'Treasury tranches, spend-from-NAV, and Arc/CCTP are not current.' },
    ],
  },

  honesty:
    'Current MarketEngine contracts are live on Robinhood Chain testnet · unaudited. External audit gates real value. Former spend-from-NAV cards, Arc/CCTP settlement, and Treasury senior/junior issuance are retired.',

  trust: {
    eyebrow: 'Why trust it',
    title: 'Proven in the open, before a dollar is real.',
    body: 'We would rather show the plumbing working than ask you to take our word for it.',
    points: [
      { k: 'Non-custodial', v: 'Your keys, your funds. Mintware and its contracts never take custody.' },
      { k: 'Current liquidity', v: 'One MarketEngine per curated pool; testnet only and unaudited.' },
      { k: 'Card refill', v: 'Bridge + Stripe are pre-enable; the on-chain gateway supports Earn-share refills only.' },
      { k: 'Retired designs', v: 'Arc/CCTP settlement, spend-from-NAV, and matched issuance are not current.' },
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
    'Market and treasury figures are historical context and do not describe current product mechanics.',
} as const

export default function CompaniesSolutionPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="teams" />
      <div className="border-b border-hair-soft bg-ground-cool px-6 py-2 text-center text-[11px] text-ink-soft">Current liquidity: Robinhood Chain testnet · unaudited · external audit gates real value. Former spend-from-NAV and matched-launch mechanics are retired.</div>

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
