import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'

// =============================================================================
// /defi — marketing landing for the DeFi vault surface. Design v2 (Privy-esque).
// Footer-linked. The thesis: never-idle, dual-sided Uniswap v4 LP where one
// balance earns three ways at once and stays spendable (senior/junior tranche).
// LPs are paid pro-rata by liquidity share — NOT by reputation. Narrative only;
// the interactive model lives on /vaults. In testing on Base Sepolia, audit pending.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — Never idle liquidity | Mintware',
  description:
    'MEV-protected, auto-managed Uniswap v4 vaults where one balance earns three ways at once — Aave lending, swap fees, and recaptured MEV — and stays spendable. Fees shared pro-rata by liquidity. In testing on Base Sepolia.',
}

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
const STREAMS: [string, string][] = [
  ['Aave lending', 'Idle capital sits in a quality lending market and earns continuously — working from second one, not waiting for a trade.'],
  ['Swap fees', 'A V4 hook pulls just-in-time depth for each swap, so the pool captures real trading fees without leaving inventory idle between trades.'],
  ['Recaptured MEV', 'The arbitrage and LVR that normally leak to bots are captured back to the pool instead of extracted from it.'],
]

const HOOK = [
  ['MEV Protection', 'TWAP verify + sandwich guard — value stays with LPs, not bots.'],
  ['Dynamic Fee', 'The fee auto-tunes to volatility and depth so LPs capture more.'],
  ['Idle Capital', 'Un-ranged liquidity is routed to lending yield instead of sitting idle.'],
  ['JIT Liquidity', 'The hook sizes exactly the depth each swap needs, pulls it atomically, and returns the rest.'],
  ['Tranche settlement', 'Fees book to the pool; the senior side stays par-protected while first-loss capital absorbs volatility.'],
]

const TRUST = [
  ['Non-custodial', 'You hold ERC-4626 shares. No one — not the team — can move your principal.'],
  ['Guardian kill-switch', 'A guardian can pause deposits and swaps in one call if anything looks wrong — a circuit breaker, not a promise.'],
  ['MEV-resistant hook', 'A truncated-oracle price guard and deviation-priced dynamic fee neutralize sandwich attacks — with no reliance on trader identity.'],
  ['Fees split on-chain', 'Fees flow to LPs pro-rata to the liquidity they provided; the protocol cut is fixed on-chain and any change emits a public event, never a silent tweak.'],
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
          <div className={ey}>The vault engine · never idle</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            One balance. <span className="text-gradient-accent">Three income streams.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            MEV-protected, auto-managed liquidity on Uniswap v4 — one balance earning three ways at once: Aave lending, swap fees, and recaptured MEV, with no rebalancing. Idle capital never sits still, and the yield stays spendable while your position keeps working.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/vaults" className="glass-pill-primary">Open the vaults →</Link>
            <Link href="/the-math" className="glass-pill">See the math →</Link>
          </div>
          <p className="text-[11px] text-ink-soft mt-5">In testing on Base Sepolia · unaudited · independent audit pending before mainnet.</p>
        </div>
      </section>

      {/* ── 01 · The wedge · never idle ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The wedge · never idle" />
          <h2 className={h2}>Everyone else makes you choose. <span className="text-gradient-accent">Your capital does all three.</span></h2>
          <p className={lead}>Normal DeFi makes you pick: your money earns — locked in a farm, illiquid — or it stays usable and earns nothing. Here one balance runs three engines at once, and stays spendable.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[560px]:grid-cols-1">
            {STREAMS.map(([name, d], i) => {
              const hot = i === 1
              return (
                <div key={name} className={hot ? 'rounded-2xl p-6 text-white' : 'soft-card p-6'} style={hot ? { background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri-deep))' } : undefined}>
                  <div className={`text-[11px] uppercase tracking-[0.12em] font-semibold ${hot ? 'text-white/80' : 'text-peri-deep'}`}>{`0${i + 1}`}</div>
                  <div className={`font-atx-display text-[19px] font-medium mt-2 ${hot ? 'text-white' : 'text-ink'}`}>{name}</div>
                  <p className={`text-[13px] leading-[1.5] mt-2.5 ${hot ? 'text-white/75' : 'text-ink-mid'}`}>{d}</p>
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
          <h2 className={h2}>One deposit. <span className="text-gradient-accent">A five-stage V4 hook engine.</span></h2>
          <p className={lead}>You provide liquidity once. Every swap that touches the pool runs your capital through a hook stack that protects it, optimizes it, and pays you — automatically.</p>
          <FlowDiagram className="mt-8" steps={HOOK.map(([k, d]) => ({ label: k, sub: d }))} />
        </div>
      </section>

      {/* ── 03 · Spendable / tranche ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="Never locked · spend the yield" />
          <h2 className={h2}>Earning and spendable <span className="text-gradient-accent">at the same time.</span></h2>
          <p className={lead}>A senior / junior split sits under the vault. The senior side stays redeemable at par while the treasury covers it — spendable as USDC — while first-loss junior capital absorbs the volatility. You spend from realized yield, not by unwinding your position.</p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[560px]:grid-cols-1">
            <div className="soft-card p-6">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Senior</div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-2.5">Redeemable at par while covered — the spendable side. A tail event is a transparent pro-rata haircut, a waterfall, not a promise.</p>
            </div>
            <div className="soft-card p-6">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-coral2-deep">Junior · first-loss</div>
              <p className="text-[13.5px] text-ink-mid leading-[1.5] mt-2.5">Absorbs volatility first, so the senior side can stay near par. The code pays the community first, automatically — no admin override.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 · How you're paid ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="How you're paid · pro-rata" />
          <h2 className={h2}>Your share of the fees is <span className="text-gradient-accent">your share of the liquidity.</span></h2>
          <p className={lead}>No score, no multiplier, no tiers. The fees a pool earns are split across everyone who provided liquidity, in proportion to how much they put in — standard LP economics, enforced on-chain, minus a fixed protocol cut.</p>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Model your own share on the <Link href="/vaults" className="text-peri-deep underline">vaults page</Link>.</p>
        </div>
      </section>

      {/* ── 05 · Trust ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="05" label="Trust · enforced by code" />
          <h2 className={h2}>You don’t have to trust us. <span className="text-gradient-accent">Trust the contract.</span></h2>
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
            The V4 hook + ERC-4626 vault are in testing on Base Sepolia — testnet, unaudited. Never present as live; real value waits on an independent audit.
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
