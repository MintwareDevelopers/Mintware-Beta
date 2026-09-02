import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'

// =============================================================================
// /teams — marketing landing, TREASURY-FIRST reframe (2026-09).
// The pivot: a team's treasury that earns real DeFi yield while every dollar
// stays spendable in real time — payroll, vendors, cards. "Spend the yield,
// not the position." Voice + design match app/page.tsx (homepage) and
// app/deck/deckMarkup.ts (investor deck).
//
// Honesty (hard rules — legal): everything is testnet · Base Sepolia · UNAUDITED.
// Never "deposit / savings / guaranteed / fixed APY / risk-free". Non-custodial
// throughout. External audit gates real value. No "reputation = yield" framing —
// rewards/fees are pro-rata, never reputation-weighted. Figures are illustrative.
//
// Matched-liquidity (community-matched token launch) is still a real product but
// is DEMOTED to a single secondary card, never the headline.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Teams — A treasury that earns while it spends | Mintware',
  description:
    'Your treasury shouldn’t have to choose between earning and being spendable. Mintware makes it productive — earning real DeFi yield — while it stays fully spendable in real time: payroll, vendors, cards. Never idle. Never locked. Always yours.',
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
// The three income streams, on one balance (matches homepage ENGINES + deck slide 4).
const ENGINES: [string, string, string][] = [
  ['01', 'Best-rate lending', 'Idle treasury is routed to the venue paying the most — and re-routed as rates move. Never parked in one place, earning less than it could.'],
  ['02', 'Just-in-time market-making', 'The balance provides just-in-time depth on Uniswap V4 exactly when trades need it, and earns the swap fees for it.'],
  ['03', 'Recaptured MEV', 'The value bots usually skim off trades is caught and handed back to the pool — not left to the searchers.'],
]

// Treasury OS — the operator controls. Every spend is recorded to the on-chain treasury.
const TREASURY_OS: [string, string][] = [
  ['Role-capped cards', 'Issue cards that draw on the treasury, each bounded by a role — owner, manager, contributor, vendor. The cap is a daily spend ceiling enforced on every swipe, not a suggestion.'],
  ['Payroll & vendor payouts', 'Run a CSV payroll batch or a one-off vendor payment straight from the treasury. Route to any chain via Circle CCTP.'],
  ['A spend ledger you can audit', 'Every spend across every rail lands in one ledger — with caps, categories, and a memo per line. Cumulative caps are checked before money moves.'],
  ['Passkey multisig', 'The treasury sits behind a passkey multisig. On accept, every member gets a soulbound on-chain membership — the actor on each line is provable.'],
]

// Why it holds — the tranche structure + non-custodial posture.
const SAFETY: [string, string][] = [
  ['Senior sits at par', 'Community / senior capital is redeemable at par while the treasury covers it, and stays instantly spendable. The senior NAV is price-free — it doesn’t swing with the market.'],
  ['Junior absorbs the volatility', 'Team / junior capital is first-loss: it takes the hit before senior ever does. The order is fixed in the contract — the code covers senior first, with no admin override.'],
  ['Honest in the tail', 'Par while covered; a conservative, pro-rata haircut only in a deep-crash tail — no first-redeemer run. That’s what makes “stays spendable” honest rather than a marketing line.'],
  ['Non-custodial by construction', 'The team’s keys, the team’s contracts. No deposit desk, no lockup, no counterparty holding the cash — Mintware is the software, not the bank.'],
]

export default function TeamsLandingPage() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="teams" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>For teams · the treasury</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[18ch] [text-wrap:balance]">
            A treasury that earns <span className="text-gradient-accent">while it spends.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Your treasury shouldn’t have to choose between earning and being spendable. Mintware makes it productive — earning real DeFi yield — while it stays fully spendable in real time: payroll, vendors, cards. Never idle. Never locked. Always yours.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/app/team" className="glass-pill-primary">See the treasury →</Link>
            <a href="#how" className="glass-pill">How it works ↓</a>
          </div>
          <p className="text-[11px] text-ink-soft leading-[1.5] mt-6 max-w-[60ch]">
            For crypto-native teams, DAOs, and on-chain startups. In testing on Base Sepolia — testnet, not yet audited; nothing here is a deposit, an offer, or a guaranteed return.
          </p>
        </div>
      </section>

      {/* ── 01 · The problem ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The problem" />
          <h2 className={h2}>Idle treasury pays an <span className="text-gradient-accent">idle-cash tax.</span></h2>
          <p className={lead}>
            A team holds its treasury in USDC. It has to stay liquid — payroll on Friday, a vendor invoice today, a
            card swipe this afternoon — so it sits in a wallet earning close to nothing. The moment capital has to
            stay usable, yield gets in the way. Every team pays that tax, month after month, on money that should be
            working the whole time it waits.
          </p>
        </div>
      </section>

      {/* ── 02 · How it works · dark pop ── */}
      <section id="how" className="bg-white border-b border-hair-soft scroll-mt-[62px]">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
              <div className="flex items-baseline gap-3">
                <span className="text-[12px] font-semibold text-pas-peri tabular-nums">02</span>
                <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">How it works</span>
              </div>
              <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
                Deposit once. Earn three ways. <span className="text-gradient-accent">Spend from the yield.</span>
              </h2>
              <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">
                Your treasury goes into a Uniswap V4 vault that earns three ways on one balance. When you pay, you spend the yield — a payment is a <b className="text-white">hold</b> against the earning position, authorized in ~milliseconds off live NAV. It is not a withdrawal. On settlement, exactly enough is settled on-chain to cover the payment; principal keeps compounding and the position never unwinds.
              </p>
              <div className="grid grid-cols-3 gap-3 mt-8 max-[820px]:grid-cols-1">
                {ENGINES.map(([n, k, d]) => (
                  <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                    <span className="text-[11px] text-pas-peri font-semibold tabular-nums font-mono">{n}</span>
                    <div className="font-atx-display text-[16px] font-medium leading-tight text-white">{k}</div>
                    <div className="text-[12.5px] text-white/60 leading-[1.5]">{d}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl bg-white/[0.07] border border-white/15 px-6 py-5 flex items-center gap-4 flex-wrap">
                <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] font-semibold text-white rounded-full border border-white/20 px-3 py-1.5">
                  <span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block" />Proven on-chain
                </span>
                <span className="text-[14px] text-white/80 leading-[1.5] flex-1 min-w-[240px]">
                  <b className="text-white">Spend the yield, not the position.</b> A real card swipe authorized off live NAV and settled on-chain — <span className="font-mono text-white font-bold">$2.00 · 12→10 USDC</span> — position never unwound. That’s the whole loop, working.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 · Treasury OS ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="Treasury OS · the controls" />
          <h2 className={h2}>The controls a team <span className="text-gradient-accent">actually runs on.</span></h2>
          <p className={lead}>
            The earning treasury is the engine. On top of it sits the operating layer your team uses every day — cards,
            payroll, vendor pay, and a ledger that reconciles it all. Cap enforcement and settlement are real, on-chain
            events, not a dashboard mock.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            {TREASURY_OS.map(([k, d], i) => (
              <div key={k} className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: `4px solid ${i % 2 === 0 ? 'var(--color-peri)' : 'var(--color-coral2)'}` }}>
                <div className="font-atx-display text-[17px] font-medium text-ink">{k}</div>
                <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/app/org/new" className="glass-pill-primary">Create your treasury →</Link>
            <Link href="/app/team" className="glass-pill">Open the treasury terminal →</Link>
          </div>
        </div>
      </section>

      {/* ── 04 · Safety · why it holds ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Why it holds" />
          <h2 className={h2}>Spendable-while-earning, <span className="text-gradient-accent">without hand-waving the risk.</span></h2>
          <p className={lead}>
            Keeping a balance spendable and earning at the same time only works if the structure is honest about who
            absorbs a bad day. Mintware splits the treasury into two tranches and fixes their order in the contract.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            {SAFETY.map(([k, d], i) => (
              <div key={k} className="soft-card p-6" style={{ borderTop: `3px solid ${i % 2 === 0 ? 'var(--color-peri)' : 'var(--color-coral2)'}` }}>
                <div className="font-atx-display text-[16px] font-medium text-ink">{k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            All of this is in testing on Base Sepolia — testnet and not yet audited. Nothing here is a deposit, a savings
            product, or a guaranteed or fixed return, and figures shown are illustrative, not a projection. External
            audit gates real value.
          </p>
        </div>
      </section>

      {/* ── 05 · Proof ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="05" label="Proof · on-chain" />
          <h2 className={h2}>Every claim here has an <span className="text-gradient-accent">on-chain receipt.</span></h2>
          <p className={lead}>
            The earn → hold → settle loop isn’t a slide. It has already run on-chain — deposit, earn, and a real
            settlement — and you can verify the last run yourself.
          </p>
          <Link href="/proof" className="inline-flex items-center gap-2.5 mt-6 rounded-full border border-hair bg-white pl-3 pr-3.5 py-2.5 text-[12.5px] text-ink-mid no-underline hover:border-[rgba(76,76,214,0.4)] transition-colors">
            <span className="w-[7px] h-[7px] rounded-full bg-mw-live inline-block shrink-0" />
            <span className="whitespace-nowrap">Last settle</span>
            <span className="font-mono text-ink font-bold whitespace-nowrap">$2.00 · 12→10 USDC</span>
            <span className="text-peri-deep font-semibold whitespace-nowrap">verify on-chain →</span>
          </Link>
        </div>
      </section>

      {/* ── secondary · community-matched launch (demoted, single card) ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[56px] max-[800px]:py-[40px]`}>
          <div className="rounded-2xl bg-ground-cool border border-hair p-6 flex items-start gap-5 max-[640px]:flex-col">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Also — launching a token</div>
              <div className="font-atx-display text-[16px] font-medium text-ink mt-1.5">Community-matched launch liquidity</div>
              <p className="text-[13px] text-ink-mid leading-[1.5] mt-2">
                Bringing a token to market too? Teams can also launch with community-matched liquidity — your token on
                one side, the community’s stablecoin on the other, in a locked dual-sided vault. A separate product from
                the treasury; fees are shared pro-rata to liquidity provided, never reputation-weighted.
              </p>
            </div>
            <Link href="/vaults" className="glass-pill whitespace-nowrap shrink-0">See launch vaults →</Link>
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="coral" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="max-w-[34ch]">
              <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] [text-wrap:balance]">
                Put your treasury to work — without ever locking it up.
              </div>
              <p className="text-[13px] text-ink-mid leading-[1.5] mt-3">
                Early access is opening to a first cohort of crypto-native treasuries. Tell us about yours.
              </p>
            </div>
            <a href={TWITTER} target="_blank" rel="noopener noreferrer" className="glass-pill-primary">Talk to us →</a>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
