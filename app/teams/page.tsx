import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/web2/MarketingNav'
import { PageHero } from '@/components/web2/PageHero'

// =============================================================================
// /teams — marketing landing for the Matched Liquidity vault (team-facing).
// Footer- + nav-linked. Grounded strictly in the deployed contract:
// contracts-v4/src/vaults/MintwareMatchedLiquidityVault.sol
//   · MEME / EMERGING launches, dual-sided pair (projectToken / quoteToken)
//   · team commits T; community matches with quote up to a value cap
//   · threshold within funding window → activate; 50/50 team(LOCKED)/community(FREE)
//   · MIN_LOCK_DURATION 90d hard cliff (selectable 90–730d); NO team early-unlock path
//   · guardian pause can FREEZE but never RELEASE team funds early (Stage-1.4 kill-switch)
//   · during lock, swap fees (net 25% protocol cut) accrue PER COMMUNITY LIQUIDITY UNIT
//     — team earns 0%. This is deposit-pro-rata, NOT reputation-weighted (do not claim AWY here).
//   · MIN_COMMUNITY_DEPOSITORS = 3 (anti self-dealing)
// Trust claim uses the contract's own words: "a restriction on withdrawal, not a
// transfer of ownership." Never "community-owned." Vault is undeployed → testnet-honest.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Teams — Prove it, don’t say it | Mintware',
  description:
    'Lock your launch liquidity alongside your community — verifiably, on-chain, for at least 90 days with no early-exit path. During the lock your fee share flows to the people who backed you. Trust us becomes check the contract.',
}

const BLUE = 'var(--color-atx-blue)'
const TWITTER = 'https://x.com/Mintware_org'

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
const FLOW: [string, string][] = [
  ['You commit your token', 'Deposit your project token into the vault and pick a lock term — 90 days to 2 years.'],
  ['Your community matches it', 'Backers deposit the quote asset (USDC, WETH…) up to a value cap, first-come, until the match is filled.'],
  ['Threshold met → it activates', 'If the community fills the minimum within the funding window, the matched liquidity deploys as one Uniswap V4 position.'],
  ['Two halves, one locked', 'The position splits 50/50 by liquidity — your half is locked for the full term, the community half stays free to redeem.'],
  ['You can’t pull it — by design', 'There is no team early-unlock path in the contract. A guardian can freeze the vault, but can never release your locked liquidity early.'],
]

const LOCK_STATS: [string, string][] = [
  ['≥ 90 days', 'Hard cliff — selectable up to 2 years'],
  ['0', 'Team early-exit paths in the contract'],
  ['50 / 50', 'Team (locked) / community (free) split'],
  ['≥ 3', 'Independent backers required to activate'],
]

const TRUST: [string, string][] = [
  ['Locked, not signed over', 'Your liquidity never changes owner. What’s restricted is your ability to withdraw it before the cliff — a restriction on withdrawal, not a transfer of ownership.'],
  ['No early-unlock path', 'There is no function anywhere in the contract that lets a team pull locked liquidity early. It isn’t gated — it’s absent.'],
  ['Guardian kill-switch', 'A guardian can pause the vault if something looks wrong. It can freeze funds — but it can never release team liquidity ahead of the cliff.'],
  ['Anti-self-dealing floor', 'Activation requires a minimum of three independent community backers, so a team can’t quietly match its own launch.'],
  ['Fee redirection on-chain', 'The community’s share accrues inside the contract, per unit of community liquidity — no off-chain merkle, no discretion, no rounding drift.'],
]

export default function TeamsLandingPage() {
  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      <MarketingNav active="teams" />

      {/* ── HERO ── */}
      <PageHero
        eyebrow="For teams · matched liquidity"
        title={<>Prove it. <span className="text-atx-blue">Don’t say it.</span></>}
        sub="Lock your launch liquidity alongside your community — verifiably, on-chain, for at least 90 days with no early-exit path. During the lock, your fee share flows to the people who backed you. “Trust us” becomes “check the contract.”"
      >
        <div className="flex flex-wrap gap-3">
          <a href="#how" className={btnAcc}>How it works ↓</a>
          <Link href="/defi" className={btnGhost}>The LP side →</Link>
        </div>
      </PageHero>

      {/* ── 01 · The problem ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="01" label="The problem" />
          <h2 className={h2}>Every launch asks the same thing: <span style={{ color: BLUE }}>trust us.</span></h2>
          <p className={lead}>
            Most tokens launch with liquidity concentrated in a few insider wallets, rented mercenary capital that
            leaves within a week, and a team that can pull the floor at any moment. The community is asked to believe it
            won’t happen. Belief isn’t a mechanism — and it’s exactly what gets retail hurt.
          </p>
        </div>
      </section>

      {/* ── 02 · How it works ── */}
      <section id="how" className="border-b border-atx-ink bg-atx-blue/[0.05] scroll-mt-[56px]">
        <div className={`${wrap} py-[52px]`}>
          <Head n="02" label="How matched liquidity works" />
          <h2 className={h2}>You lock. Your community matches. <span style={{ color: BLUE }}>The contract holds both.</span></h2>
          <p className={lead}>A dual-sided pair vault — your token on one side, the community’s stable or ETH on the other. Both go in once; the contract does the rest.</p>
          <div className="grid grid-cols-5 border border-atx-ink bg-atx-bone mt-8 max-[900px]:grid-cols-1">
            {FLOW.map(([k, d], i) => (
              <div key={k} className={`p-5 flex flex-col gap-3 ${i < FLOW.length - 1 ? 'border-r border-atx-ink/20 max-[900px]:border-r-0 max-[900px]:border-b' : ''}`}>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-atx-coral shrink-0" />
                  <span className="font-atx-mono text-[11px] text-atx-ink/45">0{i + 1}</span>
                </div>
                <div className="text-[15px] font-bold leading-tight">{k}</div>
                <div className="text-[12px] text-atx-ink/55 leading-[1.45]">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 03 · The lock ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="03" label="The lock · the proof" />
          <h2 className={h2}>A restriction on withdrawal, <span style={{ color: BLUE }}>not a transfer of ownership.</span></h2>
          <p className={lead}>
            Your liquidity stays yours. What changes is that you provably can’t withdraw it before the cliff. The term is
            yours to pick — from 90 days up to two years — and once set, there is deliberately no path to unwind it early.
          </p>
          <div className="grid grid-cols-4 border border-atx-ink bg-atx-panel mt-8 max-[720px]:grid-cols-2">
            {LOCK_STATS.map(([n, d], i) => (
              <div key={d} className={`p-5 ${i < 3 ? 'border-r border-atx-ink/20 max-[720px]:[&:nth-child(2)]:border-r-0' : ''} ${i < 2 ? 'max-[720px]:border-b max-[720px]:border-atx-ink/20' : ''}`} style={{ borderTop: `3px solid ${BLUE}` }}>
                <div className="font-atx-mono text-[clamp(24px,3.4vw,34px)] font-bold tracking-[-1px] text-atx-blue leading-none">{n}</div>
                <div className="text-[12px] text-atx-ink/55 leading-[1.45] mt-2.5">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · What backers earn ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className={`${wrap} py-[52px]`}>
          <Head n="04" label="What backers earn" />
          <h2 className={h2}>During the lock, <span style={{ color: BLUE }}>your fees are theirs.</span></h2>
          <p className={lead}>
            While your side is locked, every swap fee it would have earned — net of the Mintware protocol cut — flows to
            the community instead, accrued on-chain per unit of community liquidity. You give up short-term fees to buy
            long-term trust. That’s the trade, and the contract enforces it exactly: during the lock, the team earns 0%.
          </p>
          <p className="font-atx-mono text-[12px] text-atx-mesquite mt-4">
            <b className="text-atx-blue">↳</b> Community fees today are shared pro-rata to liquidity provided. Reputation-weighting for backers is on the roadmap — we’ll say so here when it ships, not before.
          </p>
        </div>
      </section>

      {/* ── 05 · Trust ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="05" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span style={{ color: BLUE }}>Neither does your community.</span></h2>
          <div className="border border-atx-ink mt-8">
            {TRUST.map(([k, d], i) => (
              <div key={k} className={`flex items-start gap-4 px-6 py-4 ${i < TRUST.length - 1 ? 'border-b border-atx-ink/15' : ''}`}>
                <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-ink inline-block mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
                  <div className="text-[15px] font-bold w-[190px] shrink-0 max-[640px]:w-auto">{k}</div>
                  <div className="text-[13px] text-atx-ink/60 leading-[1.5]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[10.5px] text-atx-ink/45 leading-[1.5] mt-4">
            Built for MEME / EMERGING launches and gated as such at deploy. The matched-liquidity vault is invariant-tested
            and ships on Base Sepolia testnet first; live mainnet launches land at Phase 2. Independent audit pending.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[38px] flex items-center justify-between flex-wrap gap-4`}>
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[28ch]">
            Launching a token? Prove your commitment from day one.
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href={TWITTER} target="_blank" rel="noopener noreferrer" className={btnAcc}>Talk to us →</a>
          </div>
        </div>
      </section>
    </div>
  )
}
