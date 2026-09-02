import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { FeeSplitDonut } from '@/components/ui2/FeeSplitDonut'

// =============================================================================
// /defi — marketing landing for the DeFi vault surface. Design v2 (Privy-esque).
// Footer-linked. Grounded in .claude/rules/vaults.md + the homepage story:
// the Unified Liquidity Vault (one balance earns three ways — best-rate lending,
// swap fees, recaptured MEV), a five-stage V4 hook engine, dual-sided / matched
// liquidity, a pro-rata 60/30/10 split, and a balance that stays spendable while
// it earns. Rewards are PRO-RATA by your share — never reputation- or
// lock-multiplier-weighted. Narrative only — calculators live on /vaults.
// =============================================================================

export const metadata: Metadata = {
  title: 'DeFi — One balance, three income streams | Mintware',
  description:
    'MEV-protected, auto-managed Uniswap v4 vaults where one balance earns three ways at once — best-rate lending, swap fees, and recaptured MEV — while it stays spendable. No idle capital, no rebalancing.',
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
// The three income streams — one balance earns all of them at once.
const STREAMS: [string, string][] = [
  ['Best-rate lending', 'Idle capital is routed to the venue paying the most — and re-routed as rates move. Never parked, earning less than it could.'],
  ['Swap fees', 'Your liquidity is JIT-provisioned into each Uniswap v4 swap exactly when it’s needed, and earns the fee for it.'],
  ['Recaptured MEV', 'The value bots usually skim off trades is caught and handed back to the pool — to LPs, not searchers.'],
]

const HOOK = [
  ['Idle → yield', 'Un-ranged capital is routed to the best-paying lending venue instead of sitting in the pool.'],
  ['JIT on swap', 'The V4 hook sees each trade, sizes just-enough liquidity, executes, and returns the rest — atomically.'],
  ['MEV recaptured', 'A truncated-oracle guard + dynamic fee neutralize sandwiches; the arb value goes back to the pool.'],
  ['Fees + MEV split', 'Every swap’s fees and recaptured MEV are captured and split on-chain — pro-rata by your share.'],
  ['Auto-compound', 'Earnings accrue to your position automatically — no manual claiming, no rebalancing.'],
]

// How a matched vault forms — team + community make the market together.
const MATCHED: [string, string, string][] = [
  ['01', 'Team locks its token', 'One side of the pair is the team’s own token, cliff-locked on-chain for ≥90 days.'],
  ['02', 'Community matches USDC', 'The other side is funded by the community in USDC — real, two-sided depth, not a promise.'],
  ['03', 'Senior / junior tranches', 'Community capital sits senior at par; team capital is junior and absorbs the swings first.'],
  ['04', 'Depth from day one', 'Tighter spreads and better fills the moment it’s live, because the liquidity is actually there.'],
]

const SPLIT: [string, string, string][] = [
  ['60%', 'to LPs', 'Split pro-rata — your share of the pool, and nothing else, sets what you earn.'],
  ['30%', 'to treasury', 'Funds the protocol and its operations.'],
  ['10%', 'to buybacks', 'Recycled back into the ecosystem via on-chain buybacks.'],
]

const SPEND = [
  'Your capital sits in the vault, earning all three streams',
  'It stays spendable as USDC — nothing is locked away',
  'Spend on the card or over the wire',
  'A payment is a hold against the earning balance, not a withdrawal',
  'Settled to the cent — your position keeps working',
]

const TRUST = [
  ['Non-custodial', 'You hold ERC-4626 shares. No one — not the team — can move your principal.'],
  ['Guardian kill-switch', 'A guardian can pause deposits and swaps in one call if anything looks wrong — a circuit breaker, not a promise.'],
  ['MEV-resistant hook', 'A truncated-oracle price guard and deviation-priced dynamic fee neutralize sandwich attacks — with no reliance on trader identity.'],
  ['Fee split on-chain', 'The 60/30/10 split is enforced by the vault contract; any change emits a public event, never a silent tweak.'],
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
            One deposit. <span className="text-gradient-accent">Three income streams.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            MEV-protected, auto-managed liquidity on Uniswap v4 — one balance earning three ways at once: best-rate lending routed across venues, swap fees, and recaptured MEV, with no rebalancing. And it never locks away — the balance stays spendable as USDC while it earns.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/vaults" className="glass-pill-primary">Open the vaults →</Link>
            <Link href="/the-math" className="glass-pill">See the math →</Link>
          </div>
        </div>
      </section>

      {/* ── 01 · The wedge ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="01" label="The wedge · never idle" />
          <h2 className={h2}>Everyone else leaves capital half-used. <span className="text-gradient-accent">Here every dollar earns three ways at once.</span></h2>
          <p className={lead}>One balance runs the Unified Liquidity Vault: best-rate lending, swap fees, and recaptured MEV — all stacked on the same capital, so nothing sits idle between trades.</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[560px]:grid-cols-1">
            {STREAMS.map(([name, desc], i) => {
              const hot = i === 2
              return (
                <div key={name} className={hot ? 'rounded-2xl p-6 text-white' : 'soft-card p-6'} style={hot ? { background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri-deep))' } : undefined}>
                  <div className={`text-[11px] uppercase tracking-[0.12em] font-semibold ${hot ? 'text-white/80' : 'text-peri-deep'}`}>{`Stream ${i + 1}`}</div>
                  <div className={`font-atx-display text-[clamp(19px,2.4vw,24px)] font-medium tracking-[-0.01em] mt-2 leading-[1.15] ${hot ? 'text-white' : 'text-ink'}`}>{name}</div>
                  <div className={`text-[12.5px] leading-[1.5] mt-2.5 ${hot ? 'text-white/75' : 'text-ink-mid'}`}>{desc}</div>
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
          <p className={lead}>You provide liquidity once. Every swap that touches the pool runs your capital through a hook stack that keeps it earning, protects it, and pays you — automatically.</p>
          <FlowDiagram className="mt-8" steps={HOOK.map(([k, d]) => ({ label: k, sub: d }))} />
        </div>
      </section>

      {/* ── 03 · Dual-sided / matched liquidity ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="03" label="Dual-sided · matched liquidity" />
          <h2 className={h2}>Liquidity isn’t a solo act. <span className="text-gradient-accent">Teams and their community make the market together.</span></h2>
          <p className={lead}>A matched vault pairs a team’s own token with community USDC — cliff-locked, senior/junior tranched, and deep from the first swap. Two economic sides, one pool.</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {MATCHED.map(([step, name, desc]) => (
              <div key={step} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-3" style={{ borderTop: '3px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[22px] font-medium leading-none text-peri-deep tabular-nums">{step}</div>
                <div className="font-atx-display text-[15px] font-medium text-ink leading-[1.2]">{name}</div>
                <div className="text-[11px] text-ink-mid leading-[1.5] mt-auto">{desc}</div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4"><b className="text-peri-deep">↳</b> Every backer earns their <b className="text-ink">pro-rata</b> share of all three income streams — by the size of their stake, and nothing else.</p>
        </div>
      </section>

      {/* ── 04 · The fee split ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="04" label="Where the fees go" />
          <h2 className={h2}>Every swap fee, <span className="text-gradient-accent">split on-chain.</span></h2>
          <p className={lead}>No black box. The split is enforced by the vault contract, and any change to it emits a public event. Each project can set its own template — this is the default.</p>
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

      {/* ── 05 · Earning here, spendable there · dark pop ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] font-semibold text-pas-peri tabular-nums">05</span>
            <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-white/55">The Liquid Sovereign Account · spend the yield</span>
          </div>
          <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
            Earning here. <span className="text-gradient-accent">Spendable there.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">Most yield locks your capital away. Here the balance keeps earning while it stays spendable as USDC — on a card or over the wire. A spend is a hold against the earning position, never an unwind.</p>
          <div className="grid grid-cols-5 gap-3 mt-8 max-[900px]:grid-cols-1">
            {SPEND.map((s, i) => (
              <div key={s} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
                <span className="w-[8px] h-[8px] rounded-full bg-pas-peri inline-block" />
                <div className="font-atx-display text-[13.5px] font-medium leading-tight text-white">{s}</div>
                {i < SPEND.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
              </div>
            ))}
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 06 · Trust ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <Head n="06" label="Trust · enforced by code" />
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
            The V4 hook + ERC-4626 vault are in testing on Base Sepolia — empty and unaudited. Mainnet deposits are gated on an external audit; figures on this page are illustrative, not a projection or guarantee.
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
