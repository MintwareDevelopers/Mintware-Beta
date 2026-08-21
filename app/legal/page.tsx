'use client'

// /legal — INTERNAL, auth-gated structural & regulatory posture memo (not public, not legal advice).
// Rendered in the /proof doc style (MwNav + centered column, platform tokens, light-only). The
// argument: Mintware is non-custodial software, and each regulated regime is kept from attaching by a
// deliberate product decision (the five bright lines). Entity = Delaware LLC. Content is strategic
// positioning for counsel to pressure-test — every risk is named, not softened.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'

const BRIGHT_LINES: { n: number; title: string; do: string; dont: string }[] = [
  {
    n: 1,
    title: 'Non-custodial — we never hold keys or assets',
    do: 'Let users self-custody via Privy embedded wallets and their own external wallets; funds sit in the user’s wallet or in autonomous, audited contracts they interact with directly.',
    dont: 'Hold private keys, operate an omnibus/pooled account, or take control of user assets at any point.',
  },
  {
    n: 2,
    title: 'No crypto ↔ fiat — we never convert',
    do: 'Keep everything Mintware touches denominated in on-chain assets (USDC, LP shares). Fiat, card settlement, and USDC issuance are the licensed partners’ rails.',
    dont: 'Exchange crypto for fiat or the reverse, take in fiat, or sit in the flow of funds between a user and a bank.',
  },
  {
    n: 3,
    title: 'No trading on users’ behalf — they self-direct',
    do: 'Let users choose to deposit into a vault. The vault’s behaviour (JIT provisioning, rebalancing) is deterministic protocol code they opt into by depositing.',
    dont: 'Hold trading authority over a user’s account, exercise investment discretion, or give personalised recommendations.',
  },
  {
    n: 4,
    title: 'No promise of return — we are not a deposit-taker',
    do: 'Route protocol-native economics (LP fees, MEV recapture, on-chain lending yield) to the LP position that earned them.',
    dont: 'Promise, guarantee, or owe a return; hold user deposits as a liability on a Mintware balance sheet; market a “savings account.”',
  },
  {
    n: 5,
    title: 'Reputation is information — not advice or a credit decision',
    do: 'Compute analytics over public on-chain data and present them as information.',
    dont: 'Issue personalised investment advice, or make eligibility/credit determinations that trigger fair-lending or consumer-reporting regimes.',
  },
]

const REGIMES: { regime: string; sub: string; trigger: string; why: string; risk: string }[] = [
  {
    regime: 'Money transmission / MSB', sub: 'FinCEN · state MTLs',
    trigger: 'Accepting and transmitting value; converting or handling fiat; custodial wallet services.',
    why: 'No custody, no fiat, no pooled user money. The fiat and settlement legs are performed by the licensed partners.',
    risk: 'The “spendable balance” mechanic and any value movement between users must be reviewed; confirm the partner is transmitter-of-record and the interface is not itself transmitting.',
  },
  {
    regime: 'Custody / trust company', sub: '',
    trigger: 'Holding, controlling, or safeguarding client assets.',
    why: 'Keys never leave the user (Privy self-custody). Assets live in the user’s wallet or in autonomous contracts.',
    risk: 'Admin / upgrade / oracle / relayer keys must be demonstrably unable to move user funds — document multisig, scope limits, and time-locks so operational keys ≠ control of assets.',
  },
  {
    regime: 'Broker-dealer / exchange', sub: 'SEC',
    trigger: 'Operating a marketplace for, or effecting transactions in, securities.',
    why: 'Not matching buyers and sellers of securities or running an exchange; it is an interface to a public AMM protocol.',
    risk: 'Contingent on whether vault shares / tranches are securities (see next row). The interface-vs-protocol line is contested — keep the interface non-discretionary and disclosed.',
  },
  {
    regime: 'Investment adviser / commodity-pool', sub: 'SEC · CFTC · NFA',
    trigger: 'Managing others’ assets for compensation with discretion; pooling for collective trading.',
    why: 'No discretionary authority; vault behaviour is deterministic, disclosed, protocol-level code the user opts into — not a managed account.',
    risk: 'Real grey area: automated rebalancing / JIT can be characterised as “management,” and pooled vaults can resemble a commodity pool. Needs a dedicated opinion.',
  },
  {
    regime: 'Securities / deposit-taking', sub: 'Howey · banking',
    trigger: 'An investment of money in a common enterprise with profit expected from others’ efforts; or taking deposits.',
    why: 'An LP position is participation in an autonomous pool (like being an LP anywhere), and yield is protocol-native — not a return promised by, or from the efforts of, Mintware.',
    risk: 'Highest-risk item. A par-value, spendable, yield-bearing senior balance resembles a deposit or a yield product; marketing and structure decide the outcome (see Risk Register).',
  },
]

const PARTNERS: { who: string; role: string; note: string; mw?: boolean }[] = [
  { who: 'Circle / Arc', role: 'Stablecoin & settlement rail', note: 'Issues USDC, runs CCTP bridging and USDC-native settlement on Arc. The regulated stablecoin and cross-chain value layer.' },
  { who: 'Card issuer (production tier)', role: 'Card issuance & fiat settlement', note: 'Issues the card, connects to the card networks, and settles to fiat — carrying the card-program / MSB / bank-partner obligations. (Lithic sandbox today is demo-only.)' },
  { who: 'Privy', role: 'Non-custodial wallet infra', note: 'Embedded-wallet key management and auth — keys stay under the user’s control. Reinforces non-custody and shrinks Mintware’s security and data surface.' },
  { who: 'Mintware', role: 'Software · interface · analytics', note: 'Front-end, reputation analytics, and off-chain coordination (edge-auth authorises against on-chain NAV; the relayer submits protocol transactions). By design, no licence-triggering function.', mw: true },
]

const RISKS: { title: string; sev: 'high' | 'med' | 'low'; sevLabel: string; body: string; mit: string; mitLabel: string }[] = [
  {
    title: 'Senior tranche characterised as a security or deposit', sev: 'high', sevLabel: 'High',
    body: 'A senior balance that stays at par, earns yield, and is spendable is economically close to a deposit or a packaged yield product — the exact shape regulators scrutinise under Howey, deposit-taking, and emerging stablecoin/yield rules.',
    mitLabel: 'Mitigants',
    mit: 'No Mintware promise or guarantee; yield sourced from the protocol, not Mintware’s efforts; explicit risk disclosures; avoid “deposit / savings / guaranteed / fixed APY” language; consider access limits or geofencing; obtain a securities opinion before any real value goes on.',
  },
  {
    title: 'Managed vaults read as advisory or a commodity pool', sev: 'med', sevLabel: 'High–Med',
    body: 'Automated rebalancing and JIT can be framed as exercising management over pooled user capital, implicating investment-adviser or commodity-pool-operator regimes.',
    mitLabel: 'Mitigants',
    mit: 'Keep vault logic deterministic, on-chain, non-discretionary, and disclosed as such; the user opts in by depositing; document that no human exercises trade discretion; consider structural separation for any pooled product.',
  },
  {
    title: 'Money-transmission residual on “spendable” / settlement', sev: 'med', sevLabel: 'Medium',
    body: 'If the spend mechanism or any user-to-user movement is deemed transmission of value, MSB obligations could reach Mintware rather than the partner.',
    mitLabel: 'Mitigants',
    mit: 'Confirm in writing the partner is transmitter-of-record; keep Mintware interface-only with no pooling of user fiat; ensure the burn-to-pay flow is a protocol action, not a Mintware-operated transfer.',
  },
  {
    title: 'AML / KYC / sanctions attribution', sev: 'med', sevLabel: 'Medium',
    body: 'Permissionless LP is ungated by design; KYC/KYB lives with the card and fiat partner. The risk is that Mintware is nonetheless treated as an obliged entity, or that the interface serves sanctioned users.',
    mitLabel: 'Mitigants',
    mit: 'Confirm the partner is the KYC-obligated party; screen the interface against OFAC lists; geofence prohibited jurisdictions; document that ungated LP holds no third-party funds.',
  },
  {
    title: 'Reputation data — privacy & access-gating optics', sev: 'low', sevLabel: 'Med–Low',
    body: 'Scores are computed on public data, but using them to gate access to financial features invites fair-lending / consumer-reporting-adjacent scrutiny and privacy questions.',
    mitLabel: 'Mitigants',
    mit: 'Keep scores informational; avoid using them as the sole gate for access to money features; document methodology; provide transparency; review before any gating goes live.',
  },
  {
    title: 'Pre-launch discipline is itself the strongest near-term position', sev: 'low', sevLabel: 'By design',
    body: 'Nothing is live with real value: testnet, unaudited, empty. External audit and counsel clearance are explicit gates before launch — so today, no regulated activity is occurring with real money.',
    mitLabel: 'Hold the gate',
    mit: 'Do not move real value ahead of audit + a written counsel position on the High items above.',
  },
]

const QUESTIONS: { n: string; body: ReactNode }[] = [
  { n: 'Q1', body: <><b>Securities analysis of the senior / junior tranches.</b> Is the par-spendable, yield-bearing senior interest a security or a deposit — and what structure or disclosure avoids it?</> },
  { n: 'Q2', body: <><b>Adviser / CPO analysis of the managed vaults.</b> Does automated rebalancing / JIT over pooled capital cross into advisory or commodity-pool territory?</> },
  { n: 'Q3', body: <><b>MTL / MSB confirmation.</b> Are the partners unambiguously the transmitters and KYC-obligated parties, with Mintware outside the definition?</> },
  { n: 'Q4', body: <><b>Jurisdiction & geofencing.</b> Which markets are in scope at launch, and what must be geofenced or gated?</> },
  { n: 'Q5', body: <><b>Token analysis, if any.</b> If a token is contemplated, its own securities and structuring analysis.</> },
  { n: 'Q6', body: <><b>When to separate the protocol layer.</b> Given the single Delaware LLC, at what point does the protocol/contract layer (or a future token) warrant its own entity or foundation, distinct from the operating company?</> },
]

const sevCls: Record<'high' | 'med' | 'low', { chip: string; stripe: string }> = {
  high: { chip: 'text-[#C0392B] bg-[rgba(209,67,67,0.10)]', stripe: '#C0392B' },
  med: { chip: 'text-mw-amber bg-[rgba(196,122,0,0.10)]', stripe: 'var(--color-mw-amber, #C27A00)' },
  low: { chip: 'text-mw-green bg-[rgba(22,163,74,0.10)]', stripe: 'var(--color-mw-green, #16a34a)' },
}
const chip = (cls: string) =>
  `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold font-atx-display ${cls}`

function Kicker({ no, children }: { no: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="font-mono font-semibold text-[12.5px] text-peri-deep tracking-[0.04em] pt-[0.3em]">{no}</span>
      <h2 className="font-atx-display font-semibold text-[clamp(1.4rem,3.2vw,1.85rem)] leading-[1.12] tracking-[-0.02em]">{children}</h2>
    </div>
  )
}

export default function LegalPosturePage() {
  return (
    <MwAuthGuard>
      <div className="min-h-screen bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[820px] px-6 max-[700px]:px-4 py-[44px]">

          {/* hero */}
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
            Internal memorandum · structural & regulatory posture
          </div>
          <h1 className="font-atx-display font-bold text-[clamp(2rem,5.4vw,3rem)] leading-[1.04] tracking-[-0.03em] mt-3.5">
            Software, not a<br /><span className="text-gradient-accent">financial intermediary.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.02rem,2.2vw,1.28rem)] leading-[1.5] max-w-[60ch] mt-5">
            Mintware builds the tools; <span className="text-ink font-medium">users hold their own keys and act for themselves.</span> Every
            regulated leg — fiat, cards, USDC — belongs to a licensed partner. The whole structure is designed to sit on the
            software / interface side of every line.
          </p>

          <div className="grid grid-cols-3 max-[640px]:grid-cols-1 gap-3 mt-6">
            <Fact k="Entity" v="Delaware LLC" />
            <Fact k="Audience" v="Internal + counsel" />
            <Fact k="Product stage" v="Testnet · pre-launch · unaudited" />
          </div>

          {/* read-first banner */}
          <div className="rounded-[16px] border border-hair p-4 mt-5 text-[13.5px] text-ink-mid leading-[1.55]"
            style={{ background: 'linear-gradient(120deg, rgba(108,108,240,0.08), var(--color-ground-cool, #F4F6F9))' }}>
            <span className="inline-block font-mono text-[10px] tracking-[0.1em] uppercase text-peri-deep border border-[rgba(108,108,240,0.3)] rounded-md px-1.5 py-0.5 mr-2 bg-white align-[2px]">Read first</span>
            This is an <b className="text-ink">internal strategic-positioning memo, not legal advice</b>, and is <b className="text-ink">not a public page</b>.
            It records how Mintware is built and why that keeps it clear of the most heavily regulated categories — a map for qualified
            counsel to pressure-test, not a legal conclusion. Nothing here is a representation to any regulator, and no position should be
            relied upon until counsel signs off.
          </div>

          {/* 1 */}
          <section className="mt-12">
            <Kicker no="01">What Mintware actually is</Kicker>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch]">
              Two products, one posture: a <span className="text-ink font-medium">non-custodial software and infrastructure provider</span>.
              Mintware operates (a) an interface and coordination layer for on-chain liquidity provision — reputation-adjacent LP vaults on
              Uniswap v4 — and (b) an on-chain reputation analytics engine (Attribution) that scores public wallet behaviour. In both, the
              user interacts directly with audited smart contracts using a wallet they control. Mintware runs the front-end, the analytics,
              and the off-chain plumbing that helps those contracts do their job. It never runs the money.
            </p>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-3">
              The distinction that carries the whole framework: Mintware provides <span className="text-ink font-medium">tooling and information</span>;
              it does not take custody, does not move fiat, and does not act as anyone’s financial agent. Everything below is a consequence
              of holding that line.
            </p>
          </section>

          {/* 2 — bright lines */}
          <section className="mt-12">
            <Kicker no="02">The five bright lines</Kicker>
            <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
              The structural moat is a set of things Mintware deliberately <span className="italic">does not do</span>. Each one is what keeps a whole regulatory regime from attaching.
            </p>
            <div className="flex flex-col gap-3">
              {BRIGHT_LINES.map((l) => (
                <div key={l.n} className="soft-card p-5 max-[560px]:p-4">
                  <div className="flex items-center gap-3 mb-2.5">
                    <span className="font-atx-display font-bold text-[13px] text-white w-[28px] h-[28px] rounded-[9px] grid place-items-center shrink-0"
                      style={{ background: 'linear-gradient(135deg,var(--color-peri-mid),var(--color-peri))', boxShadow: '0 3px 10px rgba(108,108,240,.35)' }}>
                      {l.n}
                    </span>
                    <h3 className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em]">{l.title}</h3>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13.5px] mt-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mw-green pt-[3px]">Do</span>
                    <span className="text-ink-mid leading-[1.5]">{l.do}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#C0392B] pt-[3px]">Don’t</span>
                    <span className="text-ink-mid leading-[1.5]">{l.dont}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 3 — regimes */}
          <section className="mt-12">
            <Kicker no="03">Regime by regime — why we’re outside, and the honest residual</Kicker>
            <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
              For each regulated category: what triggers it, why Mintware sits outside, and — stated plainly — the residual risk that still needs counsel.
            </p>
            <div className="overflow-x-auto rounded-[16px] border border-hair shadow-card">
              <table className="w-full border-collapse text-[13px] min-w-[720px]">
                <thead>
                  <tr className="bg-ground-cool">
                    {['Regime', 'What triggers it', 'Why Mintware is outside', 'Honest residual risk'].map((h) => (
                      <th key={h} className="text-left font-atx-display text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-4 py-3 border-b border-hair">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {REGIMES.map((r) => (
                    <tr key={r.regime} className="border-b border-hair-soft last:border-0 align-top">
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-ink block">{r.regime}</span>
                        {r.sub && <span className="block font-mono text-[11px] text-ink-soft mt-0.5">{r.sub}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-ink-mid leading-[1.5]">{r.trigger}</td>
                      <td className="px-4 py-3.5 text-ink-mid leading-[1.5]">{r.why}</td>
                      <td className="px-4 py-3.5 text-ink-mid leading-[1.5]">{r.risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4 — partner map */}
          <section className="mt-12">
            <Kicker no="04">Who carries which licence</Kicker>
            <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
              The classic licence-triggering functions — fiat, cards, stablecoin issuance — are deliberately <span className="italic">not ours</span>. They belong, contractually and operationally, to regulated counterparties.
            </p>
            <div className="grid grid-cols-2 max-[600px]:grid-cols-1 gap-3">
              {PARTNERS.map((p) => (
                <div key={p.who} className={`soft-card p-5 ${p.mw ? 'border-[rgba(108,108,240,0.35)]' : ''}`}
                  style={p.mw ? { background: 'linear-gradient(180deg,#fff,rgba(108,108,240,0.07))' } : undefined}>
                  <div className="font-mono font-semibold text-[13.5px] text-ink tracking-[-0.01em]">{p.who}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-peri-deep mt-0.5">{p.role}</div>
                  <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{p.note}</p>
                </div>
              ))}
            </div>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-4">
              The single most important structural choice is here: the fiat / card / stablecoin legs — the usual money-transmission and banking
              triggers — are <span className="text-ink font-medium">outsourced to entities that hold those licences</span>. Mintware is the technology layer above them.
            </p>
          </section>

          {/* 5 — risk register */}
          <section className="mt-12">
            <Kicker no="05">Risk register — ranked, not softened</Kicker>
            <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
              A credible posture names its own exposures. These are the areas where the favourable framing is <span className="italic">contestable</span>, worst first.
            </p>
            <div className="flex flex-col gap-3">
              {RISKS.map((r) => (
                <div key={r.title} className="soft-card p-5 max-[560px]:p-4 border-l-[4px]" style={{ borderLeftColor: sevCls[r.sev].stripe }}>
                  <div className="flex items-center gap-2.5 flex-wrap mb-2">
                    <h3 className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em]">{r.title}</h3>
                    <span className={chip(sevCls[r.sev].chip)}>{r.sevLabel}</span>
                  </div>
                  <p className="text-[14px] text-ink-mid leading-[1.55]">{r.body}</p>
                  <p className="text-[13.3px] text-ink-mid leading-[1.55] mt-2.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-mw-green font-semibold mr-1.5">{r.mitLabel}</span>
                    {r.mit}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 6 — structure + questions */}
          <section className="mt-12">
            <Kicker no="06">Structure & the questions for counsel</Kicker>
            <p className="text-ink-mid text-[15px] mt-[-6px] mb-4 max-w-[64ch]">
              The functional posture above is grounded in what the product does. The structure notes below flow from the entity being a single US company.
            </p>
            <h3 className="font-atx-display font-semibold text-[15.5px] mt-1 mb-2">The entity, and what it does — and doesn’t — resolve</h3>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch]">
              Mintware operates as a <span className="text-ink font-medium">Delaware LLC</span> — a single US company that builds the app,
              employs the team, and faces users. The LLC gives its members liability separation and is a clean home for the software business.
              The honest caveat: entity <span className="italic">form</span> (LLC vs C-corp) is a liability and tax choice — it does
              <span className="text-ink font-medium"> not by itself resolve the securities or money-transmission questions</span>. Those turn on the
              <span className="text-ink font-medium"> activity</span> — the five bright lines — not the wrapper. As the protocol / contract layer (and any
              future token) matures, evaluate whether it warrants a separate entity or foundation distinct from the operating LLC.
            </p>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-3">
              Around it: a <span className="text-ink font-medium">Terms of Service + risk disclosure</span> that states non-custody, no advice,
              protocol-native (not promised) yield, user responsibility, prohibited jurisdictions, and dispute terms; <span className="text-ink font-medium">written
              contracts</span> with Circle and the card issuer making them the regulated party of record; and <span className="text-ink font-medium">key-management
              governance</span> (multisig on upgrade/admin keys, scoped and time-locked oracle/relayer keys that cannot move user funds).
            </p>

            <h3 className="font-atx-display font-semibold text-[15.5px] mt-6 mb-2">The questions to put to counsel, in order</h3>
            <div className="soft-card overflow-hidden p-0">
              {QUESTIONS.map((q, i) => (
                <div key={q.n} className={`grid grid-cols-[auto_1fr] gap-3.5 px-5 py-3.5 text-[14px] ${i < QUESTIONS.length - 1 ? 'border-b border-hair-soft' : ''}`}>
                  <span className="font-mono text-peri-deep font-semibold text-[12px] pt-0.5">{q.n}</span>
                  <span className="text-ink-mid leading-[1.5] [&_b]:text-ink [&_b]:font-semibold">{q.body}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 7 — through-line */}
          <section className="mt-12">
            <Kicker no="07">The through-line</Kicker>
            <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-[-2px]">
              Mintware’s best legal position is a direct consequence of its product decisions, not a wrapper bolted on afterward:
              <span className="text-ink font-medium"> hold your own keys</span> (non-custody), <span className="text-ink font-medium">we never touch fiat</span> (partners
              carry the money licences), and <span className="text-ink font-medium">the protocol earns — we don’t promise</span> (no deposit, no discretion). Keep
              those three lines bright and the heavily-regulated categories mostly do not attach. The residual — chiefly how a par-spendable
              yield balance is characterised — is real, is named above, and is gated behind counsel and audit before any real value moves.
            </p>
          </section>

          <div className="mt-14 pt-6 border-t border-hair text-[13px] text-ink-soft leading-[1.6]">
            <p>
              <b className="text-ink-mid">Living document.</b> Update as the structure, partners, and product evolve — particularly after
              audit and once counsel has weighed in on the High-risk items. This memo is internal strategic positioning,
              <b className="text-ink-mid"> not legal advice</b>, and creates no representation to any party. Obtain qualified counsel sign-off before
              relying on any position stated here.
            </p>
            <p className="font-mono text-[11px] text-ink-soft mt-3">
              Mintware · internal · structural &amp; regulatory posture · working draft ·{' '}
              <Link href="/proof" className="text-peri-deep no-underline hover:underline">Proof of life →</Link>
            </p>
          </div>

        </main>
      </div>
    </MwAuthGuard>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[16px] border border-hair bg-white shadow-card p-4">
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{k}</div>
      <div className="font-atx-display font-semibold text-[15px] mt-1">{v}</div>
    </div>
  )
}
