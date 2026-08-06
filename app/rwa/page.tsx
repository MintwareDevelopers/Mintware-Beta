import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/web2/MarketingNav'

// =============================================================================
// /rwa — flagship marketing landing for the RWA surface. Footer-linked only.
// Sells the benefits + the legal precedent, grounded in the committed language
// in app/docs/page.tsx (precedent table, "incentivize the token not the holder"
// moat, oracle bands, "precedent not legal advice" disclaimer). No new legal
// claims are introduced here beyond what the docs already assert.
// ATX Settlemint: bone/ink, mono labels, hairline borders, square, no gradients.
// =============================================================================

export const metadata: Metadata = {
  title: 'RWA — Real-world yield, without the six-figure door | Mintware',
  description:
    'Tokenized real-world assets as a token you actually hold: buy any amount, no six-figure minimum, trade vRWA 24/7 wherever the asset permits, redeem the underlying on request. Verification scales with the asset — open for Reg A+, verified wallets for Reg D. Built on the exact legal structures BlackRock, Backed, and Ondo already run in production.',
}

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const CORAL = '#FF8574'

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
const lead = 'text-[16px] leading-[1.55] text-atx-ink/70 max-w-[60ch] mt-4'
const btnAcc = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-ink bg-atx-coral text-atx-ink no-underline inline-block cursor-pointer'
const btnGhost = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-ink bg-atx-bone text-atx-ink no-underline inline-block cursor-pointer'

function SectionHead({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3.5">
      <span className="font-atx-mono text-[12px] text-atx-coral">{n}</span>
      <span className={ey}>{label}</span>
      <span className="sr-only">{children}</span>
    </div>
  )
}

// ── data ─────────────────────────────────────────────────────────────────────
const HERO_CHIPS = ['Any amount — no $50k minimum', 'Verified wallets for Reg D · open for Reg A+', 'Trade vRWA on Uniswap 24/7', 'You hold the token — self-custody']

const STUCK = [
  ['$5M minimums, accreditation walls', 'Any amount, no six-figure minimum — access set by the asset, not by us'],
  ['Redemption by request, thin secondary', 'Trade vRWA 24/7 on Uniswap'],
  ['A token that can’t touch DeFi', 'Composable ERC-20 — collateral, strategies, vaults'],
  ['A database entry on someone’s cap table', 'A token you actually hold — self-custody'],
]

const STEPS = [
  ['01', 'Buy vRWA', 'The tokenized security itself — buy it on the pool. Any amount, no six-figure minimum.'],
  ['02', 'Hold it', 'A self-custodied, composable ERC-20 that tracks the SPV’s NAV. Verification scales with the asset.'],
  ['03', 'Trade 24/7', 'Real-world yield accrues to the asset; trade vRWA against USDC on Uniswap, any time.'],
  ['04', 'Redeem — if you want', 'Burn vRWA → the issuer settles the underlying at par after a 30-day window + KYC.'],
]

const PRECEDENT: [string, string, string, string, boolean][] = [
  ['Backed Finance', 'Tokenized T-bills & S&P 500', 'Bearer ERC-20 — KYC at the gateway, then trades on Uniswap', 'Swiss / Liechtenstein DLT Act', false],
  ['Paxos (PAXG)', 'Tokenized gold', 'Bearer ERC-20 — freely transferable', 'NYDFS-regulated', false],
  ['Ondo (USDY)', 'Tokenized T-bill yield', 'Bearer-style — transferable after a short lockup', 'US frameworks', false],
  ['BlackRock BUIDL', 'Tokenized US Treasuries', 'Permissioned — allowlist enforced on every transfer', 'SEC Reg D · Securitize transfer agent', true],
  ['Superstate (USTB)', 'Tokenized Treasuries', 'Permissioned token', 'US', false],
  ['ERC-3643 / T-REX', 'The security-token standard itself', 'Permissioned — on-chain identity gates transfer', 'EU security tokens', false],
]

const SAFE = [
  ['Bankruptcy-remote SPV', 'The underlying sits in a special-purpose vehicle, isolated from the issuer’s balance sheet.'],
  ['Oracle-banded price', 'vRWA only trades within a band around NAV — ±15% soft, ±45% hard. No runaway mispricing, no manipulation outside the band.'],
  ['On-chain guardian', 'A freeze / kill-switch in the contracts can halt a compromised deal — behind a 48-hour timelock.'],
  ['Automatic holder gating', 'For permissioned tokens, an ineligible transfer reverts on-chain — the token protects itself, with no action from us.'],
  ['Review before public', 'Issuer verification + a content review gate (draft → in_review → approved) stand between a deal and its first public wallet.'],
  ['Non-custodial, end to end', 'Mintware never holds your funds, never holds the underlying (the SPV does), never holds your keys.'],
]

const NOT = [
  'Custody the underlying asset',
  'Decide or check who may hold the token',
  'Run the primary placement or solicit investors into it',
  'Make the market with our own book',
  'Touch primary issuance of a restricted instrument directly',
]

const ASSETS = [
  ['ATX Credit Facility', 'Private credit · vRWA / USDC', '10.4%'],
  ['Sovereign T-Bill', 'Treasury ladder · vRWA / USDC', '~ T-bill'],
  ['LiquidHectar Note', 'Trade-finance note · vRWA / USDC', '9.0%'],
]

export default function RwaLandingPage() {
  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      <MarketingNav active="rwa" />

      {/* ── HERO ── */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className={`${wrap} py-[54px]`}>
          <div className={ey}>✴ RWA surface · real-world yield, without the six-figure door</div>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.97] text-[clamp(38px,6.4vw,86px)] max-w-[15ch] mt-4">
            Wall Street’s yield. <span style={{ color: CORAL }}>Without the six-figure door.</span>
          </h1>
          <p className="text-[clamp(15px,1.9vw,20px)] leading-[1.5] text-atx-ink/70 max-w-[52ch] mt-6">
            Tokenized real-world assets — private credit, T-bills, trade finance — as a token you actually hold.
            Buy any amount, no six-figure minimum. Earn real yield. Trade 24/7. Verification scales with the asset:
            open for Reg A+, verified wallets for Reg D.
          </p>
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-8 mt-7 max-w-[720px] max-[560px]:grid-cols-1">
            {HERO_CHIPS.map((c) => (
              <div key={c} className="flex gap-2.5 items-start text-[14px] leading-[1.4]">
                <span className="w-[9px] h-[9px] mt-1 border border-atx-ink inline-block shrink-0" style={{ background: CORAL }} />
                {c}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/vaults" className={btnAcc}>Explore the RWA vaults →</Link>
            <Link href="/docs" className={btnGhost}>Read the full thesis →</Link>
          </div>
        </div>
      </section>

      {/* ── 01 · The problem ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="01" label="Tokenizing was the easy part">The problem</SectionHead>
          <h2 className={h2}>Trillions got tokenized. <span style={{ color: CORAL }}>Almost none of it moved.</span></h2>
          <p className={lead}>
            Most tokenized assets just sit there — gated behind the same accreditation wall, redeemable only by request,
            unable to touch the rest of DeFi. Wrapping an asset in a token was never the point. What the token can <i>do</i> is.
          </p>
          <div className="grid grid-cols-2 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            <div className="p-6 border-r border-atx-ink bg-atx-panel max-[720px]:border-r-0 max-[720px]:border-b">
              <div className="font-atx-mono text-[12px] uppercase tracking-[0.12em] text-atx-ink/45 mb-4">✕ Tokenized — still stuck</div>
              {STUCK.map(([a]) => (
                <div key={a} className="flex gap-3 items-start py-3 border-b border-atx-ink/10 last:border-b-0">
                  <span className="font-atx-mono font-bold text-atx-ink/35">✕</span>
                  <span className="text-[14px] leading-[1.45] text-atx-ink/70">{a}</span>
                </div>
              ))}
            </div>
            <div className="p-6">
              <div className="font-atx-mono text-[12px] uppercase tracking-[0.12em] mb-4" style={{ color: CORAL }}>✴ On Mintware — unlocked</div>
              {STUCK.map(([, b]) => (
                <div key={b} className="flex gap-3 items-start py-3 border-b border-atx-ink/10 last:border-b-0">
                  <span className="font-atx-mono font-bold" style={{ color: CORAL }}>✓</span>
                  <span className="text-[14px] leading-[1.45] font-medium">{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[clamp(19px,2.4vw,28px)] font-bold tracking-[-0.4px] leading-[1.25] max-w-[26ch] mt-9">
            Real-world assets don’t need a blockchain to exist. <span style={{ color: CORAL }}>They need DeFi to finally move.</span>
          </div>
        </div>
      </section>

      {/* ── 02 · How it works ── */}
      <section className="border-b border-atx-ink bg-atx-coral/[0.05]">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="02" label="Buy → hold → trade → redeem">How it works</SectionHead>
          <h2 className={h2}>Four steps. <span style={{ color: CORAL }}>Verification scales with the asset.</span></h2>
          <p className={lead}>For Reg A+ assets the token trades openly; for Reg D assets it only reaches verified wallets — the token enforces this on every transfer. Redemption always re-checks KYC.</p>
          <div className="grid grid-cols-4 border border-atx-ink bg-atx-bone mt-8 max-[720px]:grid-cols-1">
            {STEPS.map(([n, t, d], i) => (
              <div key={n} className={`p-[18px] ${i < 3 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="font-atx-mono text-[11px] tracking-[0.08em]" style={{ color: i === 3 ? CORAL : 'var(--color-atx-blue)' }}>{n}</div>
                <div className="text-[15px] font-bold mt-2.5 mb-1.5">{t}</div>
                <div className="font-atx-mono text-[10.5px] leading-[1.5] text-atx-ink/55">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 03 · Structure & pricing ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="03" label="Structure & pricing">The structure</SectionHead>
          <h2 className={h2}>A bearer share over a bankruptcy-remote SPV, <span style={{ color: CORAL }}>priced to NAV.</span></h2>
          <p className={lead}>
            Each deal is a bankruptcy-remote SPV holding the underlying — a trade-finance note, a T-bill ladder, a
            private-credit facility — with a defined maturity and a 40/60 reserve/yield split. The ERC-4626 share is
            <b> vRWA</b>, and its value tracks the SPV’s NAV.
          </p>
          <div className="grid grid-cols-3 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            {[
              ['Oracle band', '±15% soft · ±45% hard', 'vRWA can only trade in a band around NAV. Fees ramp near the soft edge; trades outside the hard band revert. Incentivized volume is real price discovery, not wash-trading.'],
              ['Reserve invariant', '40 / 60 · ≥120%', 'A reserve/yield split with an on-chain reserve-ratio invariant backs redemptions — so the liquidity you gain never becomes a liability.'],
              ['Async redemption', '30-day window', 'Request → settlement window → issuer confirms (KYC-gated). Transfer modes and a guardian freeze sit behind a 48-hour timelock.'],
            ].map(([k, v, d], i) => (
              <div key={k} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-ink/45">{k}</div>
                <div className="font-atx-mono text-[22px] font-bold mt-2 text-atx-blue tracking-tight">{v}</div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5] mt-3">{d}</div>
              </div>
            ))}
          </div>
          <div className="border border-atx-ink bg-atx-ink text-atx-bone px-6 py-5 mt-4 text-[14px] leading-[1.55]">
            <span className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-bone/55 block mb-2">✴ Both sides protected</span>
            You can never buy vRWA meaningfully above NAV, or be dumped meaningfully below it. The oracle signs the reference,
            the band enforces it, and everyone — investor, issuer, regulator — sees the same number.
          </div>
        </div>
      </section>

      {/* ── 04 · The moat ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="04" label="The wrapper · the whole moat">Why it&apos;s uncopyable</SectionHead>
          <h2 className={h2}>We incentivize the token. <span style={{ color: CORAL }}>Never the holder.</span></h2>
          <p className={lead}>
            The instant a platform decides <i>who is allowed to hold</i> an asset, it becomes a gatekeeper — legally, a
            distributor soliciting a private placement — and that forces KYC walls onto every surface, which kills liquidity.
            Mintware never enforces holder eligibility. The gate lives entirely in the wrapper, upstream of us.
          </p>
          <div className="grid grid-cols-2 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            <div className="p-6 border-r border-atx-ink bg-atx-bone max-[720px]:border-r-0 max-[720px]:border-b">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.1em] text-atx-blue mb-1.5">Bearer-style</div>
              <div className="text-[14px] leading-[1.5] text-atx-ink/70">The issuer KYCs holders at the mint / redeem gateway; the token then trades freely on the open market. Mintware sees a plain, transferable ERC-20.</div>
            </div>
            <div className="p-6 bg-atx-bone">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.1em] text-atx-blue mb-1.5">Permissioned</div>
              <div className="text-[14px] leading-[1.5] text-atx-ink/70">The token enforces an on-chain allowlist on every transfer — an ineligible wallet’s swap reverts before it touches us. Mintware sees an ERC-20 whose own rules do the gating.</div>
            </div>
          </div>
          <div className="text-[clamp(18px,2.3vw,26px)] font-bold tracking-[-0.3px] leading-[1.3] max-w-[36ch] mt-9">
            Deep, incentivized liquidity <i>plus</i> reputation-weighted rewards — on a bearer or a permissioned token alike —
            is exactly what walled-garden platforms<span style={{ color: CORAL }}> structurally cannot offer</span> — bolting it on would mean dismantling the walls their model is built on.
          </div>
        </div>
      </section>

      {/* ── 05 · Legal precedent (flagship) ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="05" label="Precedent · legal">The legal ground</SectionHead>
          <h2 className={h2}>This is already how regulated assets <span style={{ color: CORAL }}>trade on-chain.</span></h2>
          <p className={lead}>
            The most common objection a legal team raises is “you can’t put a regulated asset on-chain without wrapping every
            surface in KYC.” The market has already answered it — at institutional scale, under real frameworks. Mintware
            didn’t invent the wrapper; we built the liquidity and rewards layer on top of two models the largest institutions
            on earth already run in production.
          </p>

          <div className="overflow-x-auto mt-8 border border-atx-ink">
            <table className="w-full border-collapse text-[13px] min-w-[680px]">
              <thead>
                <tr className="bg-atx-panel">
                  {['Live example', 'Asset', 'Model', 'Regulatory frame'].map((hd) => (
                    <th key={hd} className="text-left font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/55 px-4 py-3 border-b border-atx-ink">{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRECEDENT.map(([name, asset, model, frame, hot]) => (
                  <tr key={name} className={hot ? 'bg-atx-coral/[0.09]' : ''}>
                    <td className="px-4 py-3.5 border-b border-atx-ink/12 align-top font-bold whitespace-nowrap">{name}</td>
                    <td className="px-4 py-3.5 border-b border-atx-ink/12 align-top text-atx-ink/70">{asset}</td>
                    <td className="px-4 py-3.5 border-b border-atx-ink/12 align-top text-atx-ink/70 leading-[1.4]">{model}</td>
                    <td className="px-4 py-3.5 border-b border-atx-ink/12 align-top font-atx-mono text-[11px] text-atx-mesquite">{frame}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4 max-[720px]:grid-cols-1">
            <div className="border border-atx-ink p-5 bg-atx-panel">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-blue mb-2">Bearer / gateway-KYC</div>
              <div className="text-[13.5px] leading-[1.5] text-atx-ink/70">Backed, Paxos, Ondo USDY — KYC at mint and redeem; the token is a freely-transferable ERC-20. <b className="text-atx-ink">This is our bearer model.</b></div>
            </div>
            <div className="border border-atx-ink p-5 bg-atx-panel">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-blue mb-2">Permissioned / gate-in-the-token</div>
              <div className="text-[13.5px] leading-[1.5] text-atx-ink/70">BlackRock BUIDL, Superstate, ERC-3643 — the token itself enforces an on-chain allowlist. <b className="text-atx-ink">This is our permissioned model.</b></div>
            </div>
          </div>

          <div className="text-[clamp(19px,2.5vw,30px)] font-bold tracking-[-0.4px] leading-[1.25] max-w-[28ch] mt-9">
            The largest asset manager on earth already issues a transfer-gated token that trades on Ethereum.
            <span style={{ color: CORAL }}> The “you can’t do this legally” objection is empirically false.</span>
          </div>
          <p className="text-[15px] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-5">
            And the frameworks are opening, not closing. EU <b>MiCA</b>, Liechtenstein’s <b>TVTG (DLT Act)</b>,
            Switzerland’s <b>DLT Act</b>, Singapore’s <b>MAS Project Guardian</b>, and US transfer-agent regimes all
            recognize tokenized, transferable representations of regulated assets. The direction of travel is toward this model.
          </p>

          <div className="border-l-[3px] border-l-atx-coral bg-atx-panel border border-atx-ink px-5 py-4 mt-7 text-[13px] leading-[1.6] text-atx-ink/70">
            <span className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-mesquite block mb-1.5">✴ Honest boundary</span>
            This is precedent, not legal advice — your counsel applies your facts and your jurisdiction. But the road is
            paved: decentralized, transferable wrappers of regulated assets are being legally issued and traded right now,
            using the exact two models Mintware relies on. You’re not the pioneer taking the risk — you’re following BlackRock.
          </div>
        </div>
      </section>

      {/* ── 06 · Safe & legal by design ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="06" label="Safe & legal by design">Trust, enforced</SectionHead>
          <h2 className={h2}>Trust is in the structure and the code — <span style={{ color: CORAL }}>not a badge.</span></h2>
          <div className="border border-atx-ink bg-atx-bone mt-8">
            {SAFE.map(([k, d], i) => (
              <div key={k} className={`flex items-start gap-4 px-6 py-4 ${i < SAFE.length - 1 ? 'border-b border-atx-ink/15' : ''}`}>
                <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-ink inline-block mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
                  <div className="text-[15px] font-bold w-[190px] shrink-0 max-[640px]:w-auto">{k}</div>
                  <div className="text-[13px] text-atx-ink/60 leading-[1.5]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-ink/45 mb-3">What we deliberately do <i>not</i> do</div>
            <div className="border border-atx-ink bg-atx-bone">
              {NOT.map((t, i) => (
                <div key={t} className={`flex items-center gap-3 px-5 py-3 text-[14px] ${i < NOT.length - 1 ? 'border-b border-atx-ink/12' : ''}`}>
                  <span className="font-atx-mono font-bold text-atx-clay">✕</span>{t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 07 · Asset classes ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="07" label="What you can hold">Asset classes</SectionHead>
          <h2 className={h2}>Private credit. Treasuries. <span style={{ color: CORAL }}>Trade finance.</span></h2>
          <p className={lead}>Real off-chain yield, wrapped as a token you can trade. Representative deals on the surface:</p>
          <div className="grid grid-cols-3 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
            {ASSETS.map(([name, pair, apy], i) => (
              <div key={name} className={`p-[18px] ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`} style={{ borderTop: `4px solid ${CORAL}` }}>
                <div className="text-[17px] font-bold">{name}</div>
                <div className="font-atx-mono text-[11px] text-atx-ink/55 mt-1">{pair}</div>
                <div className="font-atx-mono text-[24px] font-bold text-atx-mesquite mt-3.5 border-t border-atx-ink/15 pt-3">{apy}</div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[10.5px] text-atx-ink/45 leading-[1.5] mt-3">
            Representative deals, illustrative of each asset class. On-chain RWA vaults (vRWA, oracle bands, async redeem) are
            built and on testnet; mainnet is gated on the legal track. The deal pipeline and incentive layer are live.
          </p>
        </div>
      </section>

      {/* ── 08 · For issuers ── */}
      <section className="border-b border-atx-ink bg-atx-coral/[0.05]">
        <div className={`${wrap} py-[52px]`}>
          <SectionHead n="08" label="For issuers">The other side</SectionHead>
          <h2 className={h2}>We don’t tokenize your asset. <span style={{ color: CORAL }}>We make it work.</span></h2>
          <p className={lead}>Tokenizing is solved and commoditized. What isn’t: your cold-start, your distribution, and your dead secondary market. That’s the whole opportunity.</p>
          <div className="grid grid-cols-3 border border-atx-ink bg-atx-bone mt-8 max-[720px]:grid-cols-1">
            {[
              ['Cold-start solved', 'Threshold seeding brings qualified capital in before the economics work.'],
              ['Distribution', 'Relationship-sourced referral — placement, not paid mercenaries.'],
              ['A real secondary', 'Volume + LP rewards make the token trade — the one thing tokenizing was supposed to deliver.'],
            ].map(([k, d], i) => (
              <div key={k} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}>
                <div className="text-[16px] font-bold">{k}</div>
                <div className="text-[13px] text-atx-ink/60 leading-[1.5] mt-2">{d}</div>
              </div>
            ))}
          </div>
          <div className="text-[clamp(19px,2.4vw,28px)] font-bold tracking-[-0.4px] leading-[1.25] max-w-[28ch] mt-9">
            Your real-estate position trades at 3am on a Sunday. <span style={{ color: CORAL }}>Try that with a REIT.</span>
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[38px] flex items-center justify-between flex-wrap gap-4`}>
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[24ch]">
            Real-world yield, without the $50k door.
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/vaults" className={btnAcc}>Explore the RWA vaults →</Link>
            <a href="mailto:nic.robinson17@gmail.com?subject=Mintware%20RWA" className={btnGhost}>Issue a deal →</a>
          </div>
        </div>
      </section>
    </div>
  )
}
