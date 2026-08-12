import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/web2/MarketingNav'
import { PageHero } from '@/components/web2/PageHero'

// =============================================================================
// /defi — marketing landing for the DeFi vault surface. Footer-linked only.
// Grounded in docs/vaults/overview.md + phase3-two-surface-architecture.md:
// reputation-weighted fee share, five-stage V4 hook engine, 70/15/10/5 split,
// lock tiers, non-custodial trust. Narrative only — the interactive calculators
// live on /vaults; this page CTAs into them rather than duplicating them.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — Reputation is yield | Mintware',
  description:
    'MEV-protected, auto-managed Uniswap V4 vaults where your Attribution score lifts your fee share. Same deposit, stronger on-chain history, more yield — something no capital-only vault can offer.',
}

const BLUE = 'var(--color-atx-blue)'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
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
const REP_TIERS: [string, string, string][] = [
  ['Bronze', '0–33 percentile', '1.00×'],
  ['Silver', '34–66 percentile', '1.25×'],
  ['Gold', '67–100 percentile', '1.50×'],
]

const HOOK = [
  ['MEV Protection', 'TWAP verify + sandwich guard — value stays with LPs, not bots.'],
  ['Dynamic Fee', 'The fee auto-tunes to volatility and depth so LPs capture more.'],
  ['Idle Capital', 'Un-ranged liquidity is routed to yield instead of sitting idle.'],
  ['Attribution Split', 'Fees split 70/15/10/5; your LP share is weighted by reputation.'],
  ['FeeVault', 'Accrues per 7-day epoch, claimable — no manual compounding.'],
]

const LOCK_TIERS: [string, string, string, string][] = [
  ['Flex', 'No lock', '1.00×', 'Withdraw anytime — redeems instantly, no penalty'],
  ['Committed', '30 days', '1.15×', 'Early exit ≤2%, tapering to 0% near unlock'],
  ['Aligned', '90 days', '1.30×', 'Early exit ≤2%, tapering to 0% near unlock'],
  ['Core', '180 days', '1.50×', 'Early exit ≤2%, tapering to 0% near unlock'],
]

const SPLIT: [string, string, string][] = [
  ['70%', 'to LPs', 'Weighted by your Attribution reputation.'],
  ['15%', 'to referrers', 'The LP who brought the liquidity.'],
  ['10%', 'to protocol', 'Treasury — funds the platform.'],
  ['5%', 'to bonus pool', 'A rolling pot redistributed to reputation-weighted LPs each epoch.'],
]

const LOOP = [
  'Refer an LP',
  'Their TVL sticks — you earn on sustained liquidity',
  'Your Sharing signal rises',
  'Your Attribution rises',
  'Your fee-share multiplier rises — permanently',
]

const TRUST = [
  ['Non-custodial', 'You hold ERC-4626 shares. No one — not the team — can move your principal.'],
  ['Guardian kill-switch', 'A guardian can pause deposits and swaps in one call if anything looks wrong — a circuit breaker, not a promise.'],
  ['MEV-resistant hook', 'A truncated-oracle price guard and deviation-priced dynamic fee neutralize sandwich attacks — with no reliance on trader identity.'],
  ['Fee split on-chain', 'The 70/15/10/5 split lives in the FeeVault; any change emits a public event, never a silent tweak.'],
  ['Withdrawal queue', 'A 7-day on-chain notice — visible, enforced by the contract, no discretion.'],
  ['Invariant-tested', 'Core accounting invariants are fuzz-tested across stateful runs — verified, not asserted. Independent audit pending before mainnet.'],
]

export default function DefiLandingPage() {
  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      <MarketingNav active="defi" />

      {/* ── HERO ── */}
      <PageHero
        size="compact"
        eyebrow="DeFi surface · reputation-weighted yield"
        title={<>Same deposit. <span className="text-atx-blue">More yield.</span></>}
        sub="MEV-protected, auto-managed liquidity on Uniswap V4 — where your Attribution score lifts your fee share. Two wallets deposit the same amount into the same vault; the one with the stronger on-chain history earns more. Something no capital-only vault can offer."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/vaults" className={btnAcc}>Open the vaults →</Link>
          <Link href="/attribution" className={btnGhost}>How the score works →</Link>
        </div>
      </PageHero>

      {/* ── 01 · The wedge ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="01" label="The wedge · reputation = yield" />
          <h2 className={h2}>Everyone else pays LPs by size. <span style={{ color: BLUE }}>We pay by reputation.</span></h2>
          <p className={lead}>Your Attribution tier sets a fee-share multiplier on the exact same position — so the wallet that showed up for years out-earns the one that showed up yesterday.</p>
          <div className="grid grid-cols-3 border border-atx-ink mt-8 max-[560px]:grid-cols-1">
            {REP_TIERS.map(([name, pct, mult], i) => (
              <div key={name} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[560px]:border-r-0 max-[560px]:border-b max-[560px]:border-atx-ink' : ''}`} style={i === 2 ? { background: BLUE, color: '#fff' } : undefined}>
                <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] opacity-70">{name}</div>
                <div className="font-atx-mono text-[clamp(30px,4vw,44px)] font-bold tracking-[-1px] mt-2">{mult}</div>
                <div className="font-atx-mono text-[10px] uppercase tracking-[0.1em] opacity-60 mt-1">{pct}</div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[12px] text-atx-mesquite mt-4"><b className="text-atx-blue">↳</b> Want the numbers on your own deposit? The live model is on the <Link href="/vaults" className="text-atx-blue underline">vaults page</Link>.</p>
        </div>
      </section>

      {/* ── 02 · The hook engine ── */}
      <section className="border-b border-atx-ink bg-atx-blue/[0.05]">
        <div className={`${wrap} py-[52px]`}>
          <Head n="02" label="Deposit once · the vault does the rest" />
          <h2 className={h2}>One deposit. <span style={{ color: BLUE }}>A five-stage V4 hook engine.</span></h2>
          <p className={lead}>You provide liquidity once. Every swap that touches the pool runs your capital through a hook stack that protects it, optimizes it, and pays you — automatically.</p>
          <div className="grid grid-cols-5 border border-atx-ink bg-atx-bone mt-8 max-[900px]:grid-cols-1">
            {HOOK.map(([k, d], i) => (
              <div key={k} className={`p-5 flex flex-col gap-3 ${i < HOOK.length - 1 ? 'border-r border-atx-ink/20 max-[900px]:border-r-0 max-[900px]:border-b' : ''}`}>
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

      {/* ── 03 · Two levers ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="03" label="The second lever · commitment" />
          <h2 className={h2}>Reputation is who you are. <span style={{ color: BLUE }}>Lock tier is how long you commit.</span></h2>
          <p className={lead}>Two independent levers raise the same fee share. Longer locks earn a higher multiplier — and the early-exit penalty tapers to zero as you approach unlock, so leaving early is never a cliff.</p>
          <div className="grid grid-cols-4 border border-atx-ink mt-8 max-[720px]:grid-cols-2">
            {LOCK_TIERS.map(([name, dur, mult, exit], i) => (
              <div key={name} className={`p-5 bg-atx-panel flex flex-col gap-3 ${i < 3 ? 'border-r border-atx-ink/20 max-[720px]:[&:nth-child(2)]:border-r-0' : ''} ${i < 2 ? 'max-[720px]:border-b max-[720px]:border-atx-ink/20' : ''}`} style={{ borderTop: `3px solid ${BLUE}` }}>
                <div>
                  <div className="text-[17px] font-bold">{name}</div>
                  <div className="font-atx-mono text-[11px] text-atx-ink/50 mt-0.5">{dur}</div>
                </div>
                <div className="font-atx-mono text-[28px] font-bold leading-none text-atx-blue">{mult}</div>
                <div className="font-atx-mono text-[10px] text-atx-ink/45 leading-[1.5] mt-auto">{exit}</div>
              </div>
            ))}
          </div>
          <p className="font-atx-mono text-[12px] text-atx-mesquite mt-4"><b className="text-atx-blue">↳</b> Reputation × lock stack to a combined ceiling of <b>1.95×</b> on your fee share.</p>
        </div>
      </section>

      {/* ── 04 · The fee split ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className={`${wrap} py-[52px]`}>
          <Head n="04" label="Where the fees go" />
          <h2 className={h2}>Every swap fee, <span style={{ color: BLUE }}>split on-chain.</span></h2>
          <p className={lead}>No black box. The split lives in the FeeVault contract, and any change to it emits a public event.</p>
          <div className="grid grid-cols-4 border border-atx-ink bg-atx-bone mt-8 max-[720px]:grid-cols-2">
            {SPLIT.map(([pct, who, d], i) => (
              <div key={who} className={`p-5 ${i < 3 ? 'border-r border-atx-ink/20 max-[720px]:[&:nth-child(2)]:border-r-0' : ''} ${i < 2 ? 'max-[720px]:border-b max-[720px]:border-atx-ink/20' : ''}`}>
                <div className="font-atx-mono text-[30px] font-bold tracking-[-1px] text-atx-mesquite">{pct}</div>
                <div className="text-[14px] font-bold mt-1">{who}</div>
                <div className="text-[12px] text-atx-ink/55 leading-[1.45] mt-1.5">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 05 · Referral loop ── */}
      <section className="border-b border-atx-ink bg-atx-ink text-atx-bone">
        <div className={`${wrap} py-[52px]`}>
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-acid">05</span>
            <span className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-bone/55">Referrals · the compounding loop</span>
          </div>
          <h2 className={`${h2} text-atx-bone`}>Refer liquidity. Build reputation. <span className="text-atx-acid">Earn more forever.</span></h2>
          <p className="text-[16px] leading-[1.55] text-atx-bone/70 max-w-[62ch] mt-4">Other protocols pay a flat bounty. Here, referring an LP feeds your reputation — so you’re paid twice: in fees now, and in a higher multiplier on every future deposit.</p>
          <div className="grid grid-cols-5 border border-atx-bone/25 mt-8 max-[900px]:grid-cols-1">
            {LOOP.map((s, i) => (
              <div key={s} className={`p-5 flex flex-col gap-2.5 ${i < LOOP.length - 1 ? 'border-r border-atx-bone/20 max-[900px]:border-r-0 max-[900px]:border-b' : ''}`}>
                <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-bone/40 inline-block" />
                <div className="text-[13.5px] font-bold leading-tight">{s}</div>
                {i < LOOP.length - 1 && <span className="font-atx-mono text-atx-bone/35 text-[16px] mt-auto max-[900px]:hidden">→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 · Trust ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[52px]`}>
          <Head n="06" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span style={{ color: BLUE }}>Trust the contract.</span></h2>
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
            The V4 hook + ERC-4626 vault + FeeVault are deployed and indexed on Base Sepolia testnet; mainnet deposits land at Phase 2 public launch.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="border-b border-atx-ink">
        <div className={`${wrap} py-[38px] flex items-center justify-between flex-wrap gap-4`}>
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[26ch]">
            Model your own deposit on the vaults page.
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/vaults" className={btnAcc}>Open the vaults →</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
