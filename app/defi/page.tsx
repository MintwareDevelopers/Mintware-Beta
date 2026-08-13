import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { FeeSplitDonut } from '@/components/ui2/FeeSplitDonut'

// =============================================================================
// /defi — marketing landing for the DeFi vault surface. Design v2 (Privy-esque).
// Footer-linked. Grounded in docs/vaults/overview.md + phase3 architecture:
// reputation-weighted fee share, five-stage V4 hook engine, 70/15/10/5 split,
// lock tiers, non-custodial trust. Narrative only — calculators live on /vaults.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — Reputation is yield | Mintware',
  description:
    'MEV-protected, auto-managed Uniswap V4 vaults where your Attribution score lifts your fee share. Same deposit, stronger on-chain history, more yield — something no capital-only vault can offer.',
}

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 [text-wrap:balance]'
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
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav active="defi" />

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className={ey}>DeFi surface · reputation-weighted yield</div>
          <h1 className="font-atx-display font-medium text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            Same deposit. <span className="text-peri">More yield.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            MEV-protected, auto-managed liquidity on Uniswap V4 — where your Attribution score lifts your fee share. Two wallets deposit the same amount into the same vault; the one with the stronger on-chain history earns more. Something no capital-only vault can offer.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/vaults" className="glass-pill">Open the vaults →</Link>
            <Link href="/attribution" className="glass-pill">How the score works →</Link>
          </div>
        </div>
      </section>

      {/* ── 01 · The wedge ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The wedge · reputation = yield" />
          <h2 className={h2}>Everyone else pays LPs by size. <span className="text-peri">We pay by reputation.</span></h2>
          <p className={lead}>Your Attribution tier sets a fee-share multiplier on the exact same position — so the wallet that showed up for years out-earns the one that showed up yesterday.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[560px]:grid-cols-1">
            {REP_TIERS.map(([name, pct, mult], i) => {
              const gold = i === 2
              return (
                <div key={name} className={gold ? 'rounded-2xl p-6 text-white' : 'soft-card p-6'} style={gold ? { background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri-deep))' } : undefined}>
                  <div className={`text-[11px] uppercase tracking-[0.12em] font-semibold ${gold ? 'text-white/80' : 'text-ink-soft'}`}>{name}</div>
                  <div className="font-atx-display text-[clamp(30px,4vw,44px)] font-medium tracking-[-1px] mt-2 tabular-nums">{mult}</div>
                  <div className={`text-[10px] uppercase tracking-[0.1em] mt-1 ${gold ? 'text-white/70' : 'text-ink-soft'}`}>{pct}</div>
                </div>
              )
            })}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Want the numbers on your own deposit? The live model is on the <Link href="/vaults" className="text-peri-deep underline">vaults page</Link>.</p>
        </div>
      </section>

      {/* ── 02 · The hook engine ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="02" label="Deposit once · the vault does the rest" />
          <h2 className={h2}>One deposit. <span className="text-peri">A five-stage V4 hook engine.</span></h2>
          <p className={lead}>You provide liquidity once. Every swap that touches the pool runs your capital through a hook stack that protects it, optimizes it, and pays you — automatically.</p>
          <FlowDiagram className="mt-8" steps={HOOK.map(([k, d]) => ({ label: k, sub: d }))} />
        </div>
      </section>

      {/* ── 03 · Two levers ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="The second lever · commitment" />
          <h2 className={h2}>Reputation is who you are. <span className="text-peri">Lock tier is how long you commit.</span></h2>
          <p className={lead}>Two independent levers raise the same fee share. Longer locks earn a higher multiplier — and the early-exit penalty tapers to zero as you approach unlock, so leaving early is never a cliff.</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {LOCK_TIERS.map(([name, dur, mult, exit]) => (
              <div key={name} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-3" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div>
                  <div className="font-atx-display text-[17px] font-medium text-ink">{name}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">{dur}</div>
                </div>
                <div className="font-atx-display text-[28px] font-medium leading-none text-peri-deep tabular-nums">{mult}</div>
                <div className="text-[10px] text-ink-soft leading-[1.5] mt-auto">{exit}</div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Reputation × lock stack to a combined ceiling of <b className="text-ink">1.95×</b> on your fee share.</p>
        </div>
      </section>

      {/* ── 04 · The fee split ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Where the fees go" />
          <h2 className={h2}>Every swap fee, <span className="text-peri">split on-chain.</span></h2>
          <p className={lead}>No black box. The split lives in the FeeVault contract, and any change to it emits a public event.</p>
          <div className="grid grid-cols-[auto_1fr] gap-8 items-center mt-8 max-[640px]:grid-cols-1 max-[640px]:gap-5">
            <div className="soft-card p-7 max-[640px]:justify-self-start">
              <FeeSplitDonut />
            </div>
            <div className="flex flex-col gap-3">
              {SPLIT.map(([pct, who, d]) => (
                <div key={who} className="flex gap-3">
                  <span className="font-atx-display text-[18px] font-medium text-coral2-deep tabular-nums w-[52px] shrink-0">{pct}</span>
                  <div>
                    <div className="font-atx-display text-[14px] font-medium text-ink">{who}</div>
                    <div className="text-[12px] text-ink-mid leading-[1.45]">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 05 · Referral loop · dark pop ── */}
      <section className="relative overflow-hidden bg-ink text-white border-b border-hair-soft">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
        <div className="grain absolute inset-0 opacity-40" aria-hidden />
        <div className={`${wrap} relative py-[72px] max-[800px]:py-[52px]`}>
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">05</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">Referrals · the compounding loop</span>
          </div>
          <h2 className="font-atx-display font-medium tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            Refer liquidity. Build reputation. <span className="text-pas-peri">Earn more forever.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">Other protocols pay a flat bounty. Here, referring an LP feeds your reputation — so you’re paid twice: in fees now, and in a higher multiplier on every future deposit.</p>
          <div className="grid grid-cols-5 gap-3 mt-8 max-[900px]:grid-cols-1">
            {LOOP.map((s, i) => (
              <div key={s} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                <span className="w-[8px] h-[8px] rounded-full bg-pas-peri inline-block" />
                <div className="font-atx-display text-[13.5px] font-medium leading-tight text-white">{s}</div>
                {i < LOOP.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 · Trust ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span className="text-peri">Trust the contract.</span></h2>
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
            The V4 hook + ERC-4626 vault + FeeVault are deployed and indexed on Base Sepolia testnet; mainnet deposits land at Phase 2 public launch.
          </p>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[26ch] [text-wrap:balance]">
              Model your own deposit on the vaults page.
            </div>
            <Link href="/vaults" className="glass-pill">Open the vaults →</Link>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
