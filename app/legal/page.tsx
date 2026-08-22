'use client'

// /legal — PUBLIC "Legal & Disclosures" page (not legal advice, not an offer).
// Rendered in the /proof doc style (MwNav + centered column, platform tokens, light-only). The
// posture: Mintware is non-custodial software, not a financial intermediary; every regulated leg
// (fiat, cards, USDC issuance) belongs to a licensed partner. Public-safe: it states the six
// bright lines, the partner licence map, the Delaware-LLC entity note, and USER-facing risk
// disclosures. It deliberately contains NO internal risk-register / counsel questions / candid
// self-exposure content — those live only in internal working documents, never here (see
// docs/legal/priority-buffer-redesign.md for the full internal rationale + research trail).
//
// Bright line #6 and the reworded #4 reflect the 2026-08-22 "priority buffer" redesign: protected
// LP positions are paid first by immutable, non-discretionary contract logic (never a guarantee),
// first-loss capital is restricted on-chain to team-controlled addresses (never sold to depositors
// or outside investors), and protocol-native yield — including MEV/fee capture — flows in full and
// unrestricted to every LP position that earned it, senior and junior alike.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'

const BRIGHT_LINES: { n: number; title: string; do: string; dont: string }[] = [
  {
    n: 1,
    title: 'Non-custodial — we never hold keys or assets',
    do: 'Let users self-custody via Privy embedded wallets and their own external wallets; funds sit in the user’s wallet or in autonomous contracts they interact with directly.',
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
    do: 'Route protocol-native economics (LP fees, MEV recapture, on-chain lending yield) to the LP position that earned them — in full, unrestricted, senior and junior alike. Where a vault pairs a protected and a first-loss position, payout order (protected side first) is fixed in contract logic, not a settable parameter; any risk parameter that affects the size of protection is bounded, publicly disclosed on-chain, and either instant only when it tightens protection or delayed 48h with an on-chain event when it loosens it.',
    dont: 'Promise, guarantee, or owe a return or a par-value outcome; hold user deposits as a liability on a Mintware balance sheet; market a “savings account” or an “always whole” claim; or let payout order itself be changed post-deployment by anyone.',
  },
  {
    n: 5,
    title: 'Reputation is information — not advice or a credit decision',
    do: 'Compute analytics over public on-chain data and present them as information.',
    dont: 'Issue personalised investment advice, or make eligibility/credit determinations that trigger fair-lending or consumer-reporting regimes.',
  },
  {
    n: 6,
    title: 'First-loss capital is the team’s own — never sold to depositors',
    do: 'Fund the loss-absorbing side of a vault only with the team’s own capital (typically the token the team already brought to seed the pool). Restrict that position on-chain to team-controlled addresses.',
    dont: 'Tokenize, market, or sell first-loss exposure to depositors or outside investors as an investment product, or let it become a freely transferable instrument once any lock period ends.',
  },
]

const REGIMES: { regime: string; sub: string; trigger: string; why: string }[] = [
  {
    regime: 'Money transmission / MSB', sub: 'FinCEN · state MTLs',
    trigger: 'Accepting and transmitting value; converting or handling fiat; custodial wallet services.',
    why: 'No custody, no fiat, no pooled user money. The fiat and settlement legs are performed by the licensed partners.',
  },
  {
    regime: 'Custody / trust company', sub: '',
    trigger: 'Holding, controlling, or safeguarding client assets.',
    why: 'Keys never leave the user (Privy self-custody). Assets live in the user’s wallet or in autonomous contracts.',
  },
  {
    regime: 'Broker-dealer / exchange', sub: 'SEC',
    trigger: 'Operating a marketplace for, or effecting transactions in, securities.',
    why: 'Not matching buyers and sellers of securities or running an exchange — it is an interface to a public AMM protocol.',
  },
  {
    regime: 'Investment adviser / commodity-pool', sub: 'SEC · CFTC · NFA',
    trigger: 'Managing others’ assets for compensation with discretion; pooling for collective trading.',
    why: 'No discretionary authority; vault behaviour is deterministic, disclosed, protocol-level code the user opts into — not a managed account.',
  },
  {
    regime: 'Securities / deposit-taking', sub: 'Howey · banking',
    trigger: 'An investment of money in a common enterprise with profit expected from others’ efforts; or taking deposits; or a note-like promise of a fixed/guaranteed return.',
    why: 'An LP position is participation in an autonomous pool (like being an LP anywhere), and yield — including MEV/fee capture — is protocol-native and unrestricted, not a return promised by, or from the efforts of, Mintware. Where a vault has a protected/first-loss split, protection is fixed contract priority, never a guarantee, and first-loss capital is the team’s own — never a security sold to a second class of investors.',
  },
]

const PARTNERS: { who: string; role: string; note: string; mw?: boolean }[] = [
  { who: 'Circle / Arc', role: 'Stablecoin & settlement rail', note: 'Issues USDC, runs CCTP bridging and USDC-native settlement on Arc. The regulated stablecoin and cross-chain value layer.' },
  { who: 'Card issuer (production tier)', role: 'Card issuance & fiat settlement', note: 'Issues the card, connects to the card networks, and settles to fiat — carrying the card-program / MSB / bank-partner obligations. (Any sandbox card today is demo-only.)' },
  { who: 'Privy', role: 'Non-custodial wallet infra', note: 'Embedded-wallet key management and auth — keys stay under the user’s control. Reinforces non-custody and shrinks Mintware’s security and data surface.' },
  { who: 'Mintware', role: 'Software · interface · analytics', note: 'Front-end, reputation analytics, and off-chain coordination (edge-auth authorises against on-chain NAV; the relayer submits protocol transactions). By design, the software layer above regulated partners.', mw: true },
]

const DISCLOSURES: { title: string; body: string }[] = [
  {
    title: 'Testnet and unaudited — do not deposit real value',
    body: 'Everything Mintware operates today runs on public test networks, with unaudited smart-contract code and no real assets. Nothing here is production software. Do not send real funds to any Mintware contract or interface until an external security audit is complete and this page says otherwise.',
  },
  {
    title: 'A vault balance is not a bank deposit',
    body: 'A senior vault balance is a claim on an autonomous smart-contract vault — not a deposit, not a savings account, and not a money-market fund. It is not held by a bank, is not FDIC- or SIPC-insured, and carries no government or Mintware guarantee. Its value depends entirely on the vault’s on-chain solvency.',
  },
  {
    title: 'No promised or guaranteed return',
    body: 'Any yield is generated by protocol-native mechanics (LP fees, on-chain lending, MEV recapture) and varies with market conditions. Mintware does not promise, guarantee, or owe a fixed rate of return. Illustrative or historical figures are not indicative of future results, and yield can be zero.',
  },
  {
    title: 'Smart contracts carry risk, including total loss',
    body: 'Smart contracts can contain bugs, be exploited, or behave unexpectedly; bridges, oracles, and third-party protocols add further risk. You could lose some or all of the value you interact with. Because Mintware is non-custodial, you are solely responsible for your wallet, keys, and transactions — we cannot recover, reverse, or freeze them.',
  },
  {
    title: 'A protected position is a priority claim, not a guarantee',
    body: 'Where a vault pairs a protected position with a first-loss position, protection means the protected side is paid first — a fixed order in the contract code, not a settable parameter and not a promise that it will always be made whole. Parameters affecting the size of protection are bounded and publicly disclosed on-chain (changes that loosen protection are delayed 48h and logged; changes that tighten it apply immediately). In an extreme loss event the first-loss balance could still be exhausted before the protected side is fully covered. First-loss capital is the team’s own and is restricted on-chain to team-controlled addresses; it is never sold to depositors or outside investors as an investment.',
  },
  {
    title: 'Not investment, legal, or tax advice',
    body: 'Nothing on this site or in the product is investment, legal, accounting, or tax advice, an offer or solicitation to buy or sell any asset, or a recommendation of any strategy. Reputation scores are informational analytics over public on-chain data — not eligibility or credit decisions. Do your own research and consult your own qualified advisers.',
  },
  {
    title: 'Availability and eligibility',
    body: 'Mintware is not offered where its use would be unlawful, and access may be restricted or geofenced in certain jurisdictions. It is your responsibility to ensure that your use complies with the laws that apply to you.',
  },
]

function Kicker({ no, children }: { no: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="font-mono font-semibold text-[12.5px] text-peri-deep tracking-[0.04em] pt-[0.3em]">{no}</span>
      <h2 className="font-atx-display font-semibold text-[clamp(1.4rem,3.2vw,1.85rem)] leading-[1.12] tracking-[-0.02em]">{children}</h2>
    </div>
  )
}

export default function LegalDisclosuresPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <MwNav />
      <main className="mx-auto max-w-[820px] px-6 max-[700px]:px-4 py-[44px]">

        {/* hero */}
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
          Legal &amp; Disclosures
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(2rem,5.4vw,3rem)] leading-[1.04] tracking-[-0.03em] mt-3.5">
          Software, not a<br /><span className="text-gradient-accent">financial intermediary.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1.02rem,2.2vw,1.28rem)] leading-[1.5] max-w-[60ch] mt-5">
          Mintware builds the tools; <span className="text-ink font-medium">users hold their own keys and act for themselves.</span> Every
          regulated leg — fiat, cards, USDC — belongs to a licensed partner. This page explains how the product is structured and sets out
          the risks you should understand before using it.
        </p>

        <div className="grid grid-cols-3 max-[640px]:grid-cols-1 gap-3 mt-6">
          <Fact k="Entity" v="Delaware LLC" />
          <Fact k="Nature" v="Non-custodial software" />
          <Fact k="Product stage" v="Testnet · pre-launch · unaudited" />
        </div>

        {/* read-first banner */}
        <div className="rounded-[16px] border border-hair p-4 mt-5 text-[13.5px] text-ink-mid leading-[1.55]"
          style={{ background: 'linear-gradient(120deg, rgba(108,108,240,0.08), var(--color-ground-cool, #F4F6F9))' }}>
          <span className="inline-block font-mono text-[10px] tracking-[0.1em] uppercase text-peri-deep border border-[rgba(108,108,240,0.3)] rounded-md px-1.5 py-0.5 mr-2 bg-white align-[2px]">Read first</span>
          This page is <b className="text-ink">information, not legal advice</b>. The product is on <b className="text-ink">testnet and unaudited</b> —
          nothing here is an offer, solicitation, or recommendation, and nothing here is a bank deposit or a promise of return. Read the
          <b className="text-ink"> risk disclosures</b> below before interacting with anything.
        </div>

        {/* 1 */}
        <section className="mt-12">
          <Kicker no="01">What Mintware is</Kicker>
          <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch]">
            Two products, one posture: a <span className="text-ink font-medium">non-custodial software and infrastructure provider</span>.
            Mintware operates (a) an interface and coordination layer for on-chain liquidity provision — reputation-adjacent LP vaults on
            Uniswap v4 — and (b) an on-chain reputation analytics engine (Attribution) that scores public wallet behaviour. In both, the
            user interacts directly with smart contracts using a wallet they control. Mintware runs the front-end, the analytics,
            and the off-chain plumbing that helps those contracts do their job. It never runs the money.
          </p>
          <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-3">
            The distinction that carries the whole framework: Mintware provides <span className="text-ink font-medium">tooling and information</span>;
            it does not take custody, does not move fiat, and does not act as anyone’s financial agent. Everything below is a consequence
            of holding that line.
          </p>
          <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-3">
            A vault position is built around <span className="text-ink font-medium">actual use</span>, not passive waiting — the same wallet
            position that provides liquidity is the one you spend against through the platform’s card and settlement tools. It is a
            position in a service you use, not a fund you invest in and leave alone.
          </p>
        </section>

        {/* 2 — bright lines */}
        <section className="mt-12">
          <Kicker no="02">The six bright lines</Kicker>
          <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
            Our structure is defined by a set of things Mintware deliberately <span className="italic">does not do</span>. Each one keeps a whole category of regulated activity from attaching to the software.
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
          <Kicker no="03">How each regime is kept from attaching</Kicker>
          <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
            For each regulated category: what typically triggers it, and the product decision that keeps Mintware on the software / interface side of the line.
          </p>
          <div className="overflow-x-auto rounded-[16px] border border-hair shadow-card">
            <table className="w-full border-collapse text-[13px] min-w-[640px]">
              <thead>
                <tr className="bg-ground-cool">
                  {['Regime', 'What triggers it', 'Why it doesn’t attach to Mintware'].map((h) => (
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
            triggers — are <span className="text-ink font-medium">handled by entities that hold those licences</span>. Mintware is the technology layer above them.
          </p>
        </section>

        {/* 5 — risk disclosures (public, user-facing) */}
        <section className="mt-12">
          <Kicker no="05">Risk disclosures</Kicker>
          <p className="text-ink-mid text-[15px] mt-[-6px] mb-5 max-w-[64ch]">
            Please read these before using anything on the platform. They describe the risks <span className="italic">you</span> take on — using DeFi software carries real risk, including loss of value.
          </p>
          <div className="flex flex-col gap-3">
            {DISCLOSURES.map((d) => (
              <div key={d.title} className="soft-card p-5 max-[560px]:p-4 border-l-[4px]" style={{ borderLeftColor: 'var(--color-peri, #6C6CF0)' }}>
                <h3 className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em] mb-2">{d.title}</h3>
                <p className="text-[14px] text-ink-mid leading-[1.55]">{d.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 6 — entity */}
        <section className="mt-12">
          <Kicker no="06">The entity</Kicker>
          <p className="text-ink-mid text-[15px] leading-[1.6] max-w-[64ch] mt-[-2px]">
            Mintware operates as a <span className="text-ink font-medium">Delaware LLC</span> — a single US company that builds the app,
            employs the team, and faces users. Around it sits a <span className="text-ink font-medium">Terms of Service and risk disclosure</span> stating
            non-custody, no advice, protocol-native (not promised) yield, user responsibility, prohibited jurisdictions, and dispute terms;
            <span className="text-ink font-medium"> written agreements</span> with the stablecoin and card partners making them the regulated party of record; and
            <span className="text-ink font-medium"> key-management governance</span> (multisig on upgrade/admin keys; scoped, time-locked operational keys that cannot move user funds).
          </p>
        </section>

        <div className="mt-14 pt-6 border-t border-hair text-[13px] text-ink-soft leading-[1.6]">
          <p>
            <b className="text-ink-mid">This is information, not legal advice</b>, and creates no relationship, offer, or guarantee. The
            product is early, on testnet, and unaudited; do not rely on it with real value. Terms and disclosures may change as the
            structure, partners, and product evolve.
          </p>
          <p className="font-mono text-[11px] text-ink-soft mt-3">
            Mintware · Legal &amp; Disclosures ·{' '}
            <Link href="/proof" className="text-peri-deep no-underline hover:underline">Proof of life →</Link>
          </p>
        </div>

      </main>
    </div>
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
