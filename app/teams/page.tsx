import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'

// =============================================================================
// /teams — marketing landing for the Matched Liquidity vault (team-facing).
// Design v2 (Privy-esque). Grounded strictly in the deployed contract:
// contracts-v4/src/vaults/MintwareMatchedLiquidityVault.sol
//   · team commits T; community matches quote up to a value cap
//   · threshold within window → activate; 50/50 team(LOCKED)/community(FREE)
//   · MIN_LOCK_DURATION 90d hard cliff (90–730d); NO team early-unlock path
//   · guardian pause can FREEZE but never RELEASE team funds early
//   · during lock, fees accrue PER COMMUNITY LIQUIDITY UNIT — team earns 0%
//     (deposit-pro-rata, NOT reputation-weighted — do not claim AWY here)
//   · MIN_COMMUNITY_DEPOSITORS = 3 (anti self-dealing)
// Trust claim uses the contract's words: "a restriction on withdrawal, not a
// transfer of ownership." Never "community-owned." Undeployed → testnet-honest.
// =============================================================================

export const metadata: Metadata = {
  title: 'For Teams — Prove it, don’t say it | Mintware',
  description:
    'Lock your launch liquidity alongside your community — verifiably, on-chain, for at least 90 days with no early-exit path. During the lock your fee share flows to the people who backed you. Trust us becomes check the contract.',
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

const TREASURY: [string, string][] = [
  ['Spendable while earning', 'Member balances redeem at par while the treasury covers them, and stay instantly spendable — cards, x402, cross-chain. The treasury earns the spread while the money sits ready. Never idle, never locked.'],
  ['Your team, by role', 'Invite by email and pick a preset — owner, manager, contributor, vendor. Each is a daily spend cap. On accept, every member gets a soulbound on-chain membership.'],
  ['Pay vendors & run payroll', 'One payment or a CSV batch, straight from the treasury and authorized against live solvency. Route to any chain via Circle CCTP.'],
  ['Proof of reserves, public', 'A live treasury page — NAV, coverage, members, backed on-chain — plus an embeddable badge. Your community verifies solvency without asking.'],
]

export default function TeamsLandingPage() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="teams" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>For teams · matched liquidity</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            Prove it. <span className="text-gradient-accent">Don’t say it.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Lock your launch liquidity alongside your community — verifiably, on-chain, for at least 90 days with no early-exit path. During the lock, your fee share flows to the people who backed you. “Trust us” becomes “check the contract.”
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <a href="#how" className="glass-pill">How it works ↓</a>
            <Link href="/defi" className="glass-pill">See the LP side →</Link>
          </div>
        </div>
      </section>

      {/* ── 01 · The problem ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The problem" />
          <h2 className={h2}>Every launch asks the same thing: <span className="text-gradient-accent">trust us.</span></h2>
          <p className={lead}>
            Most tokens launch with liquidity concentrated in a few insider wallets, rented mercenary capital that
            leaves within a week, and a team that can pull the floor at any moment. The community is asked to believe it
            won’t happen. Belief isn’t a mechanism — and it’s exactly what gets retail hurt.
          </p>
        </div>
      </section>

      {/* ── 02 · Two models ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Two ways to bring liquidity" />
          <h2 className={h2}>Matched, or a <span className="text-gradient-accent">traditional LP.</span></h2>
          <p className={lead}>
            Not every team wants a locked, community-matched launch. Mintware runs the same reputation engine
            under two vault models — pick the one that fits.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-coral2)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">Matched Liquidity</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-coral2-deep rounded-full border border-[rgba(232,138,103,0.4)] px-2 py-0.5">You’re reading this ↓</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                Your team locks its token; the community matches it in USDC. A hard ≥ 90-day cliff, no early exit,
                and during the lock the fees flow to your backers. Built for launches where <b className="text-ink">trust is the bottleneck</b>.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: '4px solid var(--color-peri)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-atx-display text-[19px] font-medium text-ink">Growth Vault</span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Traditional LP</span>
              </div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-3">
                A standard LP position — provide one or both sides yourself, no locking, no matching. MEV-protected,
                auto-managed range, and your Attribution score lifts your fee share up to 1.95×. Built for
                <b className="text-ink"> ongoing or treasury liquidity</b>.
              </p>
              <Link href="/vaults" className="inline-block mt-4 text-[12px] uppercase tracking-[0.06em] font-semibold text-peri-deep no-underline hover:underline">See the LP side →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 · How it works · dark pop + animated flow ── */}
      <section id="how" className="bg-white border-b border-hair-soft scroll-mt-[62px]">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">03</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">How matched liquidity works</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            You lock. Your community matches. <span className="text-gradient-accent">The contract holds both.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[60ch] mt-4">A dual-sided pair vault — your token on one side, the community’s stable or ETH on the other. Both go in once; the contract does the rest.</p>
          <div className="grid grid-cols-5 gap-3 mt-8 max-[900px]:grid-cols-1">
            {FLOW.map(([k, d], i) => (
              <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                <span className="text-[11px] text-pas-peri font-semibold tabular-nums">0{i + 1}</span>
                <div className="font-atx-display text-[15px] font-medium leading-tight text-white">{k}</div>
                <div className="text-[12px] text-white/60 leading-[1.45]">{d}</div>
                {i < FLOW.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
              </div>
            ))}
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 · The lock ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="The lock · the proof" />
          <h2 className={h2}>A restriction on withdrawal, <span className="text-gradient-accent">not a transfer of ownership.</span></h2>
          <p className={lead}>
            Your liquidity stays yours. What changes is that you provably can’t withdraw it before the cliff. The term is
            yours to pick — from 90 days up to two years — and once set, there is deliberately no path to unwind it early.
          </p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {LOCK_STATS.map(([n, d]) => (
              <div key={d} className="rounded-2xl bg-ground-cool border border-hair p-5" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[clamp(24px,3.4vw,34px)] font-medium tracking-[-1px] text-peri-deep leading-none tabular-nums">{n}</div>
                <div className="text-[12px] text-ink-mid leading-[1.45] mt-2.5">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 05 · What backers earn ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="05" label="What backers earn" />
          <h2 className={h2}>During the lock, <span className="text-gradient-accent">your fees are theirs.</span></h2>
          <p className={lead}>
            While your side is locked, every swap fee it would have earned — net of the Mintware protocol cut — flows to
            the community instead, accrued on-chain per unit of community liquidity. You give up short-term fees to buy
            long-term trust. That’s the trade, and the contract enforces it exactly: during the lock, the team earns 0%.
          </p>
          <p className="text-[12px] text-ink-soft mt-4">
            <b className="text-peri-deep">↳</b> Community fees today are shared pro-rata to liquidity provided. Reputation-weighting for backers is on the roadmap — we’ll say so here when it ships, not before.
          </p>
        </div>
      </section>

      {/* ── 06 · Referrals ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Referrals · grow the pool" />
          <h2 className={h2}>Let your backers <span className="text-gradient-accent">bring their backers.</span></h2>
          <p className={lead}>
            Matched liquidity is only as deep as the community you can rally — and your community has a community.
            Referrals turn every backer into a channel for more.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[760px]:grid-cols-1">
            {[
              ['Every backer gets a link', 'A referral link is deterministic from any wallet — no signup. Share it, and the liquidity it brings is attributed to you.'],
              ['It builds Sharing — the heaviest signal', 'Referrals feed your Sharing score: up to 400 of 925 Attribution points, the single most-weighted signal. A real network is the hardest thing to fake.'],
              ['A bigger score pays everywhere', 'That higher score lifts your reputation multiplier across the platform — up to 1.95× on the fees you earn. Widen the pool, earn more on your own position.'],
            ].map(([k, d]) => (
              <div key={k} className="soft-card p-6">
                <div className="font-atx-display text-[15px] font-medium leading-tight text-ink">{k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4">
            <b className="text-peri-deep">↳</b> Teams can reward backers through referrals — every wallet brought in pays a referral reward, so widening the pool pays twice. A 24-hour anti-abuse gate keeps referrals real, not farmed.
          </p>
        </div>
      </section>

      {/* ── 07 · Trust ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="07" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span className="text-gradient-accent">Neither does your community.</span></h2>
          <div className="soft-card mt-8 overflow-hidden">
            {TRUST.map(([k, d], i) => (
              <div key={k} className={`flex items-start gap-4 px-6 py-4 ${i < TRUST.length - 1 ? 'border-b border-hair-soft' : ''}`}>
                <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
                  <div className="font-atx-display text-[15px] font-medium w-[190px] shrink-0 max-[640px]:w-auto text-ink">{k}</div>
                  <div className="text-[13px] text-ink-mid leading-[1.5]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            Built for MEME / EMERGING launches and gated as such at deploy. The matched-liquidity vault is invariant-tested
            and ships on Base Sepolia testnet first; live mainnet launches land at Phase 2. Independent audit pending.
          </p>
        </div>
      </section>

      {/* ── 08 · Beyond the launch · the treasury ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="08" label="Beyond the launch · your treasury" />
          <h2 className={h2}>The capital doesn’t have to sit idle. <span className="text-gradient-accent">Or lock you out.</span></h2>
          <p className={lead}>
            The money your team runs on lives in a Mintware treasury that keeps earning while it stays spendable —
            cards, payroll, vendors, cross-chain — with a public page anyone can verify. Community capital is senior —
            redeemable at par while the treasury covers it; your team’s capital is the junior tranche that absorbs
            losses first and earns the spread. The order is fixed in the contract: the code pays the community first,
            automatically — no admin override.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            {TREASURY.map(([k, d], i) => (
              <div key={k} className="rounded-2xl bg-white border border-hair p-6" style={{ borderTop: `4px solid ${i % 2 === 0 ? 'var(--color-peri)' : 'var(--color-coral2)'}` }}>
                <div className="font-atx-display text-[17px] font-medium text-ink">{k}</div>
                <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/app/org/new" className="glass-pill-primary">Create your treasury →</Link>
            <Link href="/app" className="glass-pill">Open the app →</Link>
          </div>
          <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4">
            In testing on testnet, not yet audited — figures read live from the recorded vault; nothing here is an offer.
            External audit gates real value.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="coral" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[28ch] [text-wrap:balance]">
              Launching a token? Prove your commitment from day one.
            </div>
            <a href={TWITTER} target="_blank" rel="noopener noreferrer" className="glass-pill-primary">Talk to us →</a>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
