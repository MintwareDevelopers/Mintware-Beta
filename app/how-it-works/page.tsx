// /how-it-works — the overall model, V1 (live on testnet) and V2 (where it's going), with diagrams.
// SERVER component on purpose: the V2 section is only rendered for visitors who pass the same V1/V2
// gate the rest of the site uses (lib/v2/gate — unlock cookie, or the split flag off). Everyone else
// gets a one-paragraph teaser + an "Investor preview" link, and the V2 detail never ships to them.
// Honesty: every diagram box carries a testnet / built / roadmap pill. Copy rules: no deposit /
// savings / guaranteed / fixed-APY framing; impermanent loss is 100% the LP's; external audit gates
// real value. Diagram specs live in components/marketing/how/diagrams.ts (reusable in /deck, /dataroom).

import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { ModelDiagram, DiagramLegend } from '@/components/marketing/how/ModelDiagram'
import { MODEL, V1_LP, V1_EARN, V2_TREASURY, V2_SPEND } from '@/components/marketing/how/diagrams'
import { isV2FromCookie, V2_COOKIE } from '@/lib/v2/gate'

export const metadata: Metadata = {
  title: 'How it works — Mintware',
  description:
    'The Mintware model in diagrams: capital routed into curated Uniswap v4 pools and lending markets through contracts that issue you shares. V1 is live on testnet; V2 is the roadmap.',
}

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.06] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3 [text-wrap:balance]'
const lede = 'text-[15.5px] text-ink-mid leading-[1.6] mt-4 max-w-[64ch]'
const wrap = 'mx-auto max-w-[1080px] px-7 max-[640px]:px-4'

const PRINCIPLES: [string, string][] = [
  ['Your claim stays yours', 'Every position is a share in an on-chain contract. You can redeem it whenever you want; there is no lockup and no queue we control.'],
  ['We bring no capital, we carry none of the risk', 'Mintware never adds its own money to a position. What your capital earns and what it risks, including impermanent loss, is yours.'],
  ['Curated, not permissionless', 'Capital only goes to venues a curator has approved and the registry has checked on-chain. Discovery ranks pools; it never certifies them.'],
]

const GUARDRAILS: [string, string][] = [
  ['Curated pools only', 'A pool is depositable only once its Position Manager is registered and checked on-chain: quote asset, pool id, owner and fee recipient.'],
  ['Manipulation-resistant pricing', 'Hookless pools have no on-chain TWAP, so entry uses a clamped reference price plus a conservative mark. A pump can’t cheapen your entry.'],
  ['Withdrawals don’t get stuck', 'An exit is a pure pro-rata slice of both legs. If one leg can’t be delivered, it is credited back to you as shares, never lost.'],
  ['A hard cap on total value', 'An on-chain principal cap bounds everything the contract holds, which keeps a first rollout small on purpose.'],
  ['Fees, never principal', 'Harvest only collects trading fees and compounds them into the position value. It can’t touch deposits.'],
  ['Separated signing keys', 'The owner seat that deploys and harvests is its own dedicated key, separate from every other Mintware signer.'],
]

const DOORS: [string, string, string, string][] = [
  ['You', 'A personal account whose balance earns while it stays spendable, by card or anywhere USDC works.', '/yield-payment-network', 'The account →'],
  ['Teams', 'A treasury with matched liquidity, cards, payroll and role-capped spend, all read live off the vault.', '/teams', 'The treasury →'],
  ['Agents', 'An x402 parking account. Idle USDC earns while the agent pays per call.', '/agents', 'The agent account →'],
]

const CARRIES: string[] = [
  'One share-math library (virtual-offset, donation-safe) across every vault',
  'The curated registry with on-chain verification of every instance',
  'Dedicated signing seats in Privy server wallets, one key per role',
  'Fail-closed flags: every money-moving path is off until deliberately switched on',
  'An audit trail of fixed findings, with regression tests kept green',
]

const GATES: string[] = [
  'An external audit of the full stack. This is the gate for real value everywhere.',
  'A production card issuer (today’s card rail is a sandbox)',
  'Mainnet deployments, plus real lending capacity for Earn',
  'Legal review of the spendable-yield structure before any public offer',
]

export default async function HowItWorks() {
  const isV2 = isV2FromCookie((await cookies()).get(V2_COOKIE)?.value)

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav active="how" />

      {/* HERO */}
      <section className="border-b border-hair-soft">
        <div className={`${wrap} pt-[80px] pb-[56px] max-[640px]:pt-[52px]`}>
          <div className={ey}>How it works</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.03] text-[clamp(2.3rem,5.6vw,4rem)] mt-3.5 max-w-[18ch] [text-wrap:balance]">
            Your capital, put to work. <span className="text-gradient-accent">Still yours.</span>
          </h1>
          <p className={lede}>
            Mintware routes capital into venues that already exist, such as curated Uniswap v4 pools and lending markets,
            through contracts that issue you shares. V1 is two separate products you can use today on testnet. V2 is the
            larger system they grow into.
          </p>
          <nav className="flex flex-wrap gap-2.5 mt-8" aria-label="On this page">
            {[['#model', 'The model'], ['#v1', 'V1 · live on testnet'], ['#v2', 'V2 · where it’s going'], ...(isV2 ? [['#bridge', 'V1 → V2']] : [])].map(([h, l]) => (
              <a key={h} href={h} className="glass-pill glass-pill-sm no-underline">{l}</a>
            ))}
          </nav>
        </div>
      </section>

      {/* THE MODEL */}
      <section id="model" className="bg-white border-b border-hair-soft scroll-mt-[70px]">
        <div className={`${wrap} py-[80px] max-[640px]:py-[56px]`}>
          <div className={ey}>The model</div>
          <h2 className={h2}>One picture: in, to work, and back.</h2>
          <p className={lede}>
            You hold shares and the contracts hold the position. The position sits in a third-party venue, and what it earns
            flows back into your share value. LP and Earn are separate products with different risks. They are never
            blended into one.
          </p>
          <ModelDiagram spec={MODEL} className="mt-9" />
          <div className="mt-5"><DiagramLegend /></div>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-[18px] mt-10">
            {PRINCIPLES.map(([t, d]) => (
              <div key={t} className="soft-card p-6">
                <h3 className="font-semibold text-[16.5px] text-ink">{t}</h3>
                <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* V1 */}
      <section id="v1" className="border-b border-hair-soft scroll-mt-[70px]">
        <div className={`${wrap} py-[80px] max-[640px]:py-[56px]`}>
          <span className="live-chip"><span className="dot" aria-hidden />V1 · Live on Robinhood Chain testnet</span>
          <h2 className={h2}>The LP Gateway.</h2>
          <p className={lede}>
            Deposit USDG and the full amount becomes liquidity in a curated Uniswap v4 pool. Part of it is swapped into the
            paired token inside the contract, in the same transaction. There’s no range to pick and nothing to rebalance.
            Trading fees compound back in, and you can withdraw your pro-rata share of both legs at any time.
          </p>
          <ModelDiagram spec={V1_LP} className="mt-9" />
          <div className="mt-4 text-[13.5px] text-ink-mid rounded-[14px] px-5 py-4 bg-[rgba(108,108,240,0.06)] border border-[rgba(108,108,240,0.14)]">
            <b className="text-ink">A liquidity position carries impermanent loss, and 100% of it is the LP’s.</b> Mintware
            supplies no capital to any position, and the contract has no code path that accepts it.
          </div>

          <h3 className="font-semibold text-[19px] text-ink mt-14">Guardrails built into the contracts</h3>
          <div className="grid grid-cols-3 max-[900px]:grid-cols-2 max-[600px]:grid-cols-1 gap-[16px] mt-5">
            {GUARDRAILS.map(([t, d]) => (
              <div key={t} className="rounded-[16px] border border-hair bg-white p-5">
                <div className="font-semibold text-[14.5px] text-ink">{t}</div>
                <p className="text-[13px] text-ink-mid leading-[1.55] mt-1.5">{d}</p>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-ink-mid mt-4">
            Four internal audit rounds so far, with every finding either fixed or explicitly accepted.{' '}
            <Link href="/proof" className="text-peri-deep font-semibold no-underline hover:underline">See the proof →</Link>
          </p>

          <h3 className="font-semibold text-[19px] text-ink mt-14">Earn: a separate product, with no pairing</h3>
          <p className="text-[14.5px] text-ink-mid leading-[1.6] mt-2 max-w-[64ch]">
            Supply USDG to a lending market and earn interest. It’s one asset in and one asset out, with no pool and no
            impermanent loss. The code is built and tested. It goes live once a real USDG lending market has open capacity.
            None does on Robinhood Chain mainnet today.
          </p>
          <ModelDiagram spec={V1_EARN} className="mt-6" />
        </div>
      </section>

      {/* V2 */}
      <section id="v2" className="bg-white border-b border-hair-soft scroll-mt-[70px]">
        <div className={`${wrap} py-[80px] max-[640px]:py-[56px]`}>
          <div className={ey}>V2 · Where it’s going</div>
          {isV2 ? (
            <>
              <h2 className={h2}>A treasury that earns while it spends.</h2>
              <p className={lede}>
                The same pattern (shares in, a productive position, value back) extended to treasuries, cards and agents.
                Community capital is the senior tranche and is paid first. Team capital is the junior tranche and absorbs
                losses first. The combined balance earns across lending and just-in-time liquidity.
              </p>
              <ModelDiagram spec={V2_TREASURY} className="mt-9" />

              <h3 className="font-semibold text-[19px] text-ink mt-14">Spending without un-parking</h3>
              <p className="text-[14.5px] text-ink-mid leading-[1.6] mt-2 max-w-[64ch]">
                A payment is a hold against the earning balance, not a withdrawal. At settlement, just enough shares are
                burned to cover it. Everything else keeps working.
              </p>
              <ModelDiagram spec={V2_SPEND} className="mt-6" />

              <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-[18px] mt-12">
                {DOORS.map(([t, d, href, go]) => (
                  <Link key={t} href={href} className="soft-card p-6 no-underline block">
                    <h3 className="font-semibold text-[17px] text-ink">{t}</h3>
                    <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2">{d}</p>
                    <div className="text-[13.5px] font-semibold text-peri-deep mt-4">{go}</div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <GradientPanel tone="lavender" className="p-[36px] max-[640px]:p-7 mt-5">
              <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.5rem,2.6vw,2.1rem)] max-w-[24ch] [text-wrap:balance]">
                V1 is the first piece of a larger system.
              </h2>
              <p className="text-[14.5px] text-ink-mid leading-[1.6] mt-3 max-w-[58ch]">
                V2 extends the same model to treasuries, cards and agents, so balances keep earning while they stay
                spendable. The full architecture is in investor preview.
              </p>
              <Link href="/v2?next=/how-it-works%23v2" className="glass-pill-primary mt-6 inline-flex no-underline">Investor preview →</Link>
            </GradientPanel>
          )}
        </div>
      </section>

      {/* V1 → V2 */}
      {isV2 && (
        <section id="bridge" className="border-b border-hair-soft scroll-mt-[70px]">
          <div className={`${wrap} py-[80px] max-[640px]:py-[56px]`}>
            <div className={ey}>V1 → V2</div>
            <h2 className={h2}>What carries over, and what still gates it.</h2>
            <div className="grid grid-cols-2 max-[760px]:grid-cols-1 gap-[18px] mt-9">
              <div className="rounded-[20px] border border-hair bg-white p-7">
                <div className="font-semibold text-[16px] text-ink">Carries over from V1</div>
                <ul className="mt-3 space-y-2.5">
                  {CARRIES.map((c) => (
                    <li key={c} className="flex gap-2.5 text-[13.5px] text-ink-mid leading-[1.5]"><span className="text-peri-deep font-bold" aria-hidden>✓</span>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[20px] border border-[rgba(232,138,103,0.35)] bg-[#FFF8F4] p-7">
                <div className="font-semibold text-[16px] text-ink">Still gating real value</div>
                <ul className="mt-3 space-y-2.5">
                  {GATES.map((g) => (
                    <li key={g} className="flex gap-2.5 text-[13.5px] text-ink-mid leading-[1.5]"><span className="text-coral2-deep font-bold" aria-hidden>→</span>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* DISCLOSURE */}
      <section>
        <div className={`${wrap} py-[48px]`}>
          <p className="text-[12px] text-ink-soft leading-[1.6] max-w-[80ch]">
            Everything shown is in testing on testnets with mock tokens and has not been externally audited. Status labels
            mark what is running on testnet, what is built but not live, and what is planned. A liquidity position is not a
            deposit, a savings product, or a guaranteed or fixed return. Its value moves with the pool price and is subject
            to impermanent loss. Diagrams show how the system is designed, not projected returns. Nothing here is an offer.{' '}
            <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}
