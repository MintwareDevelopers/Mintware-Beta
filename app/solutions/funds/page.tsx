import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'

// =============================================================================
// /solutions/funds — PUBLIC marketing surface making Mintware's case for crypto
// FUNDS (VCs, asset managers, on-chain treasuries deploying capital).
//
// Vision page (per solutions-pages-spec): confident, present-tense, minimal
// hedging — the required honesty is CONCENTRATED into one note (HONESTY const +
// the footer line). Everything is testnet + unaudited; nothing here is an offer,
// investment advice, or a claim that Mintware manages a fund's money. It is
// infrastructure a fund operates, non-custodially.
//
// Hard lines held: NO "deposit / savings / guaranteed / fixed APY / FDIC /
// insured" as if true (only in the negative); NO specific yield % as a promise —
// all ranges are labelled illustrative + testnet. Design matches the YPN landing
// (V2Nav, periwinkle pastel, soft-card, text-gradient-accent, light-only).
// =============================================================================

export const metadata: Metadata = {
  title: 'For Funds — Dry powder that isn’t dead weight | Mintware',
  description:
    'Infrastructure for crypto funds, VCs, and asset managers: uncalled capital that stays fully callable while it earns, agent strategies funded per-call over x402, and reputation-weighted allocation — non-custodial, native-USDC settlement. In testing on testnet, unaudited; not an offer or investment advice.',
}

// ─── Copy + data (all figures dated + sourced; see SOURCES) ──────────────────
const C = {
  hero: {
    eyebrow: 'Mintware for Funds',
    status: 'Vision · in testing on testnet',
    title: 'Dry powder that isn’t',
    titleAccent: 'dead weight.',
    lede: 'Funds sit on capital between calls — reserves, uncalled commitments, stablecoin dry powder — and most of it earns nothing while it waits. Mintware is the infrastructure to keep that balance fully callable and productive at the same time: earning protocol-native yield, spendable per-call by your agents, and allocated by on-chain reputation. Non-custodial, native-USDC, operated by you.',
    stats: [
      { v: '~$315B', s: 'stablecoins', label: 'Total stablecoin supply mid-2026 — up from ~$124B at end-2023.' },
      { v: '~$4.6B', s: 'earning', label: 'Of that supply, the portion classified as yield-bearing. The rest is idle.' },
      { v: '$600B', s: 'dry powder', label: 'Global VC dry powder — crypto funds hold tens of billions uncalled.' },
    ],
  },

  problem: {
    eyebrow: 'The problem',
    title: 'Idle capital is the industry’s quietest tax.',
    body: 'A fund’s job is to deploy — but between deployments, capital waits. Operational reserves, management-fee runway, uncalled commitments held liquid for the next round: it all has to stay callable on short notice, so it stays in cash. On-chain, “cash” means stablecoins that mostly do nothing. Of roughly $315B in stablecoins outstanding, only about $4.6B is yield-bearing — the overwhelming majority is parked and unproductive. The trade-off funds accept today is the same broken one everyone accepts: you can have liquidity or yield, not both.',
    cards: [
      { k: 'The liquidity floor', v: 'Reserves and near-term dry powder must be callable the day an LP draw, a follow-on, or a redemption lands — so they default to 0% cash rather than anything with an exit window.' },
      { k: 'The velocity gap', v: 'Stablecoins were meant to be working capital; instead most sit static in wallets and treasuries. TradFi sweeps idle balances into money-market funds automatically — crypto has not replicated that at scale.' },
      { k: 'The operational drag', v: 'Manual DeFi positions mean unwinding, DEX swaps, gas, and tax events every time you need the cash back. So the yield never gets turned on — the friction outweighs a few points of return.' },
    ],
    note: 'Sources: total stablecoin supply ~$315–321B and yield-bearing ~$4.6B (Crypto-Economy / CoinDesk, Jun 2026); VC dry powder ~$600.9B (Eqvista, 2026). Figures approximate and dated.',
  },

  trends: {
    eyebrow: 'Why now',
    title: 'Three trends converge on exactly the gap we fill.',
    intro: 'Idle capital that could be earning, spend and settlement moving on-chain, and funds themselves going on-chain — the lines cross at a balance that earns while it stays deployable.',
    items: [
      {
        k: 'Idle on-chain capital is exploding',
        v: 'Stablecoin supply grew ~150% in under three years (to ~$315B mid-2026), driven by treasury and settlement use — yet only ~$4.6B of it earns. That is the largest pool of unproductive dollars in the industry, and it is growing.',
        src: 'Crypto-Economy / KuCoin, 2026',
      },
      {
        k: 'Spend and settlement are moving on-chain',
        v: 'Stablecoin transactions grew ~72% YoY in 2025, rivaling major card networks. Machine-payment rails are live: the x402 protocol logged ~165M transactions and ~69,000 active agents by late April 2026, with Visa, Mastercard, and Ripple backing the standard.',
        src: 'KuCoin 2026 · Chainalysis / CoinDesk 2026',
      },
      {
        k: 'Funds themselves are going on-chain',
        v: 'Tokenized money-market AUM went from ~$500M at the start of 2024 to over $5B by mid-2026; BlackRock’s BUIDL alone crossed ~$2.9B across 8+ networks. Tokenized RWAs (ex-stablecoins) reached ~$31.4B. The treasury layer funds operate on is already on-chain.',
        src: 'CoinDesk / Bitcoin.com, May–Aug 2026',
      },
    ],
  },

  solve: {
    eyebrow: 'How Mintware fits',
    title: 'One productive, callable balance — three ways funds use it.',
    body: 'Mintware is non-custodial infrastructure a fund operates itself. It maps directly onto how a fund actually holds and moves capital.',
    cards: [
      {
        i: '01',
        title: 'Dry powder that stays callable — YPN',
        how: 'The Yield Payment Network holds USDC that stays spendable at par, like cash, while the capital works — earning protocol-native yield from the pools it backs. A spend is a hold against the earning position, then a settle. Capital never has to un-park to be used.',
        why: 'Reserves and uncalled commitments keep earning right up to the moment you deploy them. No withdrawal window, no unwinding a position to answer a capital call.',
      },
      {
        i: '02',
        title: 'Agent strategies, funded per call — x402',
        how: 'An agent treasury where idle USDC earns while staying spendable in place, paid per call over x402 (the HTTP-native machine-payment standard). Mintware is both the funding rail and the facilitator: verify sizes a hold off live NAV, settle burns shares to the payee.',
        why: 'Fund an autonomous or quant strategy by the call — data feeds, inference, execution — from a balance that never stops earning between calls. Metered spend, not a parked ops float.',
      },
      {
        i: '03',
        title: 'Allocation by on-chain reputation — Attribution',
        how: 'Attribution scores on-chain behaviour into a portable reputation signal. In 2026, on-chain scores increasingly govern loan-to-value, access, and counterparty risk — the same primitive can weight membership, allocation, and access to a fund’s pools.',
        why: 'Route capital and access by verifiable on-chain track record instead of trust-me. Lower counterparty risk, higher capital utilization, allocation you can defend on-chain.',
      },
      {
        i: '04',
        title: 'Non-custodial, native-USDC settlement',
        how: 'Keys stay with the fund (self-custody + external wallets); capital lives in the fund’s wallet or in autonomous, audited contracts — never with Mintware. Settlement is USDC-native over Circle rails with CCTP bridging; Mintware never touches fiat.',
        why: 'No custodian in the middle of your treasury, no off-ramp tax, no counterparty holding the balance. The infrastructure is yours to operate; the licensed pieces stay with licensed partners.',
      },
    ],
  },

  math: {
    eyebrow: 'The math',
    title: 'What idle dry powder actually costs.',
    intro: 'A simple, honest opportunity-cost model. Take $100M of stablecoin reserve a fund holds fully liquid between deployments. The point is not a promised return — it is that staying callable no longer has to mean earning nothing.',
    rows: [
      { label: 'Idle cash (today)', rate: '~0%', yr: '$0', note: 'Fully callable, earning nothing — the status quo.' },
      { label: 'Best-venue lending (Aave + Morpho)', rate: '~7%', yr: '~$7.0M / yr', note: 'Illustrative: the adapter shops Aave (~3.3–3.5%, 2026) + Morpho USDC vaults (~4–8%, some ~7–8%) for the best supply rate.' },
      { label: 'Stacked: best-venue lending + LP fee + MEV recapture', rate: '~12%', yr: '~$12.0M / yr', note: 'Illustrative target: the lending floor plus just-in-time V4 liquidity capturing fees + recaptured MEV/LVR on the same capital.' },
    ],
    highlight: 'Same $100M. Same day-one callability. The difference between the top row and the bottom is roughly $12M a year of foregone return — the quiet tax of holding productive dollars as dead cash.',
    note: 'Illustrative model on testnet — not a quote, offer, promise of yield, or investment advice. The stacked ~11–14% target is a best-venue lending floor (~6–8%, shopping Aave + Morpho; Aave USDC ~3.3–3.5%, Morpho USDC vaults ~4–8%, 2026; eco.com) plus a ~4–5% LP-fee + MEV-recapture layer on the same capital. Actual returns vary with market conditions and can be zero. LP/rehypothecation strategies carry additional risk.',
  },

  mechanics: {
    eyebrow: 'The mechanics, honestly',
    title: 'How the “callable and productive” part actually works.',
    body: 'The balance behaves like a dollar because the design puts the market risk somewhere else, and because redemption is solvency-aware rather than first-come-first-served.',
    items: [
      { k: 'Structured tranches', v: 'Senior capital is price-free — it never reads a pool price, so it stays spendable at par. A junior first-loss tranche absorbs impermanent loss and market moves. The senior balance behaves like cash; the volatility lands on the tranche built to take it.' },
      { k: 'Solvency-aware redemption', v: 'Redeemable at par while the first-loss cushion covers it. If a tail event ever exhausts the cushion, everyone shares the same transparent pro-rata outcome — no race for the exit, no first-redeemer advantage.' },
      { k: 'The ULV engine', v: 'Idle capital earns via rehypothecation into best-venue lending — the adapter shops Aave and Morpho for the top USDC rate; just-in-time V4 liquidity plus MEV/LVR recapture stack a second layer of return that normally leaks to arbitrageurs. Capital is never idle inside the vault.' },
      { k: 'Native-USDC rails', v: 'Settlement is USDC-native on Circle with CCTP bridging; card spend runs through a regulated card partner. Mintware never custodies funds and never touches fiat.' },
    ],
  },

  trust: {
    eyebrow: 'Why trust the infrastructure',
    title: 'Built to be checked, not taken on faith.',
    body: 'Funds are sophisticated and regulated — so the point is verifiability, not promises. Everything below is real and open to inspection.',
    stats: [
      { v: '0', s: 'critical', label: 'Open critical findings in the self-review; every High remediated.' },
      { v: '463', s: 'Forge tests', label: 'Solidity suite green, including money-loss invariants fuzzed 256×128k.' },
      { v: '100%', s: 'non-custodial', label: 'Keys with the fund. Mintware never holds the balance.' },
      { v: 'Live', s: 'on testnet', label: 'The full loop — deposit → earn → authorize → spend — run on-chain with real hashes.' },
    ],
    points: [
      { k: 'Non-custodial by construction', v: 'Self-custody (Privy + external wallets) or autonomous contracts hold the capital — never Mintware.' },
      { k: 'Formal verification, not just tests', v: 'Machine-checked (Coq) and symbolic (Halmos) proofs on the properties where money can be lost.' },
      { k: 'Proven end-to-end on-chain', v: 'The whole YPN loop, plus a native-USDC bridge, executed on testnet with transaction hashes you can open in a block explorer.' },
      { k: 'Circle rails', v: 'USDC-native settlement built on Circle’s CCTP; licensed partners carry the regulated legs.' },
    ],
    cta: { label: 'See the whole loop run on-chain', href: '/proof' },
  },

  close: {
    eyebrow: 'Where to start',
    title: 'Put your dry powder to work without giving up liquidity.',
    body: 'No custody to hand over, no lockup to accept, no fiat rail to trust — infrastructure you operate on your own balance. Explore the vision, read the on-chain proof, or talk to us about how a fund would run it.',
    primary: { label: 'Read the vision (YPN)', href: '/yield-payment-network' },
    secondary: [
      { label: 'See it proven on-chain', href: '/proof' },
      { label: 'The yield-engine math', href: '/the-math' },
      { label: 'Talk to us', href: 'https://x.com/Mintware_Fi' },
    ],
  },

  honesty:
    'In testing on Base Sepolia — testnet, unaudited, valueless test USDC. Nothing here is an offer, a solicitation, investment / legal / tax advice, or a claim that Mintware manages, advises, or holds a fund’s capital: it is non-custodial software a fund operates itself. The senior balance is a claim on an autonomous vault, not a deposit, and is not guaranteed, insured, or a fixed rate. Yield figures are illustrative and historical, never a promise. An external audit precedes any real value.',

  sources: [
    'Stablecoin supply ~$315–321B, ~$4.6B yield-bearing — Crypto-Economy, CoinDesk, KuCoin (2026)',
    'VC dry powder ~$600.9B — Eqvista (2026); crypto fund deployment — Insights4VC / The Block (2026)',
    'Stablecoin tx +72% YoY — KuCoin (2026); x402 ~165M tx / ~69k agents — Chainalysis, CoinDesk (2026)',
    'Tokenized MMF/RWA AUM ($5B+ / BUIDL ~$2.9B / RWA ~$31.4B) — CoinDesk, Bitcoin.com (2026)',
    'Best-venue lending floor ~6–8% (Aave USDC ~3.3–3.5%, Morpho USDC vaults ~4–8%, some ~7–8%, 2026) — Aave / Morpho / eco.com; stacked ~11–14% adds a ~4–5% LP-fee + MEV layer (illustrative); on-chain credit scoring — cryptocreditscores.org, Spectral (2026)',
  ],
} as const

const wrap = 'mx-auto max-w-[1080px] px-6 max-[800px]:px-4'
const eyebrow = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const h2 =
  'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 [text-wrap:balance]'

export default function SolutionsFundsPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
        <AirbrushSplash tone="peri" />
        <div className={`relative ${wrap} py-[104px] max-[800px]:py-[64px]`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-peri-deep">{C.hero.eyebrow}</span>
            <span className="text-[11px] font-semibold px-3 py-1 rounded-full text-peri-deep bg-white border border-[rgba(108,108,240,0.22)] inline-flex items-center gap-2">
              <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" /> {C.hero.status}
            </span>
          </div>

          <h1 className="font-atx-display font-medium text-ink mt-6 tracking-[-0.045em] leading-[1.0] text-[clamp(2.4rem,6vw,4.4rem)] max-w-[16ch] [text-wrap:balance]">
            {C.hero.title} <span className="text-gradient-accent">{C.hero.titleAccent}</span>
          </h1>

          <p className="text-ink-mid text-[clamp(15px,1.9vw,18px)] leading-[1.6] mt-6 max-w-[64ch]">{C.hero.lede}</p>

          <div className="mt-10 grid grid-cols-3 max-[720px]:grid-cols-1 gap-3 max-w-[860px]">
            {C.hero.stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/70 backdrop-blur-[10px] border border-hair px-5 py-4">
                <div className="font-atx-display font-bold text-[1.9rem] tracking-[-0.02em] tabular-nums text-ink">
                  {s.v}<span className="text-peri-deep text-[0.95rem] font-semibold"> {s.s}</span>
                </div>
                <p className="text-[12.5px] leading-[1.45] text-ink-mid mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The problem ────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[48px]`}>
          <div className={eyebrow}>{C.problem.eyebrow}</div>
          <h2 className={`${h2} max-w-[18ch]`}>{C.problem.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[70ch]">{C.problem.body}</p>

          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {C.problem.cards.map((c) => (
              <div key={c.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{c.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{c.v}</p>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[76ch] leading-[1.5]">{C.problem.note}</p>
        </div>
      </section>

      {/* ── Trends ─────────────────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[48px]`}>
          <div className={eyebrow}>{C.trends.eyebrow}</div>
          <h2 className={`${h2} max-w-[20ch]`}>{C.trends.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{C.trends.intro}</p>

          <div className="mt-8 flex flex-col gap-3">
            {C.trends.items.map((t, i) => (
              <div key={t.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6 flex items-start gap-5 max-[640px]:flex-col max-[640px]:gap-2">
                <div className="font-atx-display font-bold text-[1.4rem] text-peri-deep tabular-nums shrink-0 min-w-[42px]">{String(i + 1).padStart(2, '0')}</div>
                <div className="min-w-0">
                  <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink">{t.k}</div>
                  <p className="text-[14px] leading-[1.55] text-ink-mid mt-1.5">{t.v}</p>
                  <div className="font-mono text-[11px] text-ink-soft mt-2">{t.src}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How Mintware fits ──────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[48px]`}>
          <div className={eyebrow}>{C.solve.eyebrow}</div>
          <h2 className={`${h2} max-w-[20ch]`}>{C.solve.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{C.solve.body}</p>

          <div className="grid grid-cols-2 max-[820px]:grid-cols-1 gap-4 mt-8">
            {C.solve.cards.map((c) => (
              <div key={c.i} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-mono text-[11px] font-semibold text-peri-deep tabular-nums">{c.i}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mt-1.5">{c.title}</div>
                <p className="text-[13.5px] leading-[1.55] text-ink-mid mt-2.5">{c.how}</p>
                <p className="text-[13.5px] leading-[1.55] text-ink mt-3 pt-3 border-t border-hair-soft">
                  <span className="font-semibold text-peri-deep">Why it matters — </span>{c.why}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The math (worked block) ────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[48px]`}>
          <div className={eyebrow}>{C.math.eyebrow}</div>
          <h2 className={`${h2} max-w-[18ch]`}>{C.math.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[70ch]">{C.math.intro}</p>

          <div className="mt-8 overflow-x-auto rounded-[16px] border border-hair shadow-card bg-white">
            <table className="w-full border-collapse text-[13.5px] min-w-[560px]">
              <thead>
                <tr className="bg-ground-cool">
                  {['On $100M held liquid', 'Illustrative rate', 'Per year', 'Basis'].map((hd) => (
                    <th key={hd} className="text-left font-atx-display text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-5 py-3.5 border-b border-hair">{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {C.math.rows.map((r, i) => (
                  <tr key={r.label} className={`border-b border-hair-soft last:border-0 ${i === C.math.rows.length - 1 ? 'bg-[rgba(108,108,240,0.06)]' : ''}`}>
                    <td className="px-5 py-4">
                      <span className={i === C.math.rows.length - 1 ? 'font-semibold text-peri-deep' : 'font-medium text-ink'}>{r.label}</span>
                    </td>
                    <td className="px-5 py-4 font-mono tabular-nums text-ink">{r.rate}</td>
                    <td className="px-5 py-4 font-atx-display font-semibold tabular-nums text-ink">{r.yr}</td>
                    <td className="px-5 py-4 text-[12.5px] leading-[1.4] text-ink-soft">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-ink text-[clamp(15px,1.8vw,17px)] leading-[1.55] mt-6 max-w-[70ch] font-medium">
            {C.math.highlight}
          </p>
          <p className="font-mono text-[11px] text-ink-soft mt-4 max-w-[78ch] leading-[1.5]">{C.math.note}</p>
        </div>
      </section>

      {/* ── The mechanics, honestly (the one deliberate dark moment) ──────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[40px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 85% 0%, rgba(108,108,240,0.55), transparent 55%), radial-gradient(50% 110% at 8% 100%, rgba(244,161,131,0.35), transparent 55%)' }} />
            <div aria-hidden className="grain pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative px-10 py-11 max-[700px]:px-6 max-[700px]:py-8">
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-pas-peri">{C.mechanics.eyebrow}</div>
              <h2 className="font-atx-display font-semibold text-white tracking-[-0.03em] leading-[1.06] text-[clamp(1.7rem,3.6vw,2.4rem)] mt-3 max-w-[24ch] [text-wrap:balance]">
                {C.mechanics.title}
              </h2>
              <p className="text-[15px] leading-[1.6] mt-3.5 max-w-[58ch]" style={{ color: '#C7C7DC' }}>{C.mechanics.body}</p>
              <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-8 gap-y-5 mt-7">
                {C.mechanics.items.map((it) => (
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

      {/* ── Why trust ──────────────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[48px]`}>
          <div className={eyebrow}>{C.trust.eyebrow}</div>
          <h2 className={`${h2} max-w-[18ch]`}>{C.trust.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{C.trust.body}</p>

          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-8">
            {C.trust.stats.map((m) => (
              <div key={m.label} className="rounded-[16px] border border-hair bg-white shadow-card p-4">
                <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums">
                  {m.v}<span className="text-peri-deep text-[1.05rem]"> {m.s}</span>
                </div>
                <div className="text-[12px] text-ink-mid mt-1 leading-[1.4]">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-5">
            {C.trust.points.map((p) => (
              <div key={p.k} className="soft-card p-5">
                <div className="font-atx-display font-semibold text-[15px] tracking-[-0.01em] text-ink">{p.k}</div>
                <p className="text-[13.5px] leading-[1.55] text-ink-mid mt-1.5">{p.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-7">
            <Link href={C.trust.cta.href} className="glass-pill glass-pill-primary">{C.trust.cta.label} →</Link>
          </div>
        </div>
      </section>

      {/* ── Close / CTA ────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className={`${wrap} py-[88px] max-[800px]:py-[56px]`}>
          <div className={eyebrow}>{C.close.eyebrow}</div>
          <h2 className={`${h2} max-w-[20ch]`}>{C.close.title}</h2>
          <p className="text-ink-mid text-[clamp(15px,1.8vw,18px)] leading-[1.6] mt-5 max-w-[64ch]">{C.close.body}</p>

          <div className="mt-8 flex items-center gap-3 flex-wrap">
            <Link href={C.close.primary.href} className="glass-pill glass-pill-primary">{C.close.primary.label} →</Link>
            {C.close.secondary.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                {...(s.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
                className="text-[14px] font-medium text-ink-mid hover:text-ink no-underline"
              >
                {s.label} →
              </Link>
            ))}
          </div>

          {/* One concentrated honesty note */}
          <div className="rounded-[16px] border border-hair p-5 mt-10 text-[12.5px] text-ink-mid leading-[1.6] max-w-[80ch]"
            style={{ background: 'linear-gradient(120deg, rgba(196,122,0,0.08), var(--color-ground-cool, #F3F3FB))' }}>
            <b className="text-ink">Testnet · unaudited · not an offer or advice.</b>{' '}
            {C.honesty}
          </div>

          {/* Sources */}
          <div className="mt-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft mb-2">Sources</div>
            <ul className="flex flex-col gap-1">
              {C.sources.map((s) => (
                <li key={s} className="font-mono text-[11px] text-ink-soft leading-[1.5]">
                  <Fragment>· {s}</Fragment>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
