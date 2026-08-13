'use client'

// =============================================================================
// ULVMechanics — "how it works" for the Unified Liquidity Vault. Design v2.
// The flagship differentiator: capital lives in Aave earning yield, and a V4 hook
// pulls just-in-time liquidity into the pool for each swap (atomic), capturing
// fees + MEV. Presented as the MECHANISM under the page's testnet-beta framing —
// no live TVL/yield claimed. The atomic-swap centerpiece is a dark 'pop' panel.
// =============================================================================

const STEPS: { n: string; h: string; p: string; hot?: boolean }[] = [
  { n: '01', h: 'Deposit', p: 'Add one side of the pair or both — the vault balances it. You receive vault shares representing your slice of the whole position.' },
  { n: '02', h: 'Capital sits in Aave', p: 'By default almost nothing idles in the pool. The majority earns continuous lending yield in Aave (or another quality ERC-4626 vault).' },
  { n: '03', h: 'A swap arrives → JIT liquidity', p: 'The V4 hook sees the trade, computes exactly how much liquidity it needs, pulls only that from Aave, executes, and returns the rest — atomically, one transaction.', hot: true },
  { n: '04', h: 'Fees + MEV captured', p: 'Trading fees, plus MEV/arb value that would go to bots, plus impact fees on large trades — split by the project’s template (e.g. 60% LPs / 30% treasury / 10% buybacks).' },
  { n: '05', h: 'Managed automatically', p: 'Optimal range, rebalancing, and fee compounding run on their own — keeping as much capital in Aave as possible while still giving traders good execution.' },
]

const COMPONENTS: { k: string; v: string }[] = [
  { k: 'Vault', v: 'Holds capital, issues shares, talks to Aave' },
  { k: 'V4 Hook', v: 'Watches every swap, pulls JIT liquidity, captures MEV' },
  { k: 'Aave', v: 'Provides the continuous base yield' },
  { k: 'Fee Splitter', v: 'Distributes fees + MEV by the chosen template' },
]

export function ULVMechanics() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
        {/* header */}
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">How it works · Unified Liquidity Vault</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft rounded-full border border-hair px-2.5 py-1">The mechanism · in testing on Base</span>
        </div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-4 max-w-[18ch] [text-wrap:balance]">
          Capital in Aave, <span className="text-peri">liquidity on demand.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-ink-mid max-w-[62ch] mt-4">
          A normal pool is a warehouse of inventory sitting idle, earning nothing until a customer walks in.
          The ULV keeps that inventory in a high-yield account — and moves just enough to the front of the store
          for each sale, the instant it’s needed.
        </p>

        {/* atomic-swap centerpiece · dark pop */}
        <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white mt-9">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 130% at 12% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
          <div className="grain absolute inset-0 opacity-40" aria-hidden />
          <div className="relative flex items-center justify-between px-5 py-3 border-b border-white/12">
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-pas-peri">One swap · one transaction</span>
            <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-white/55">Atomic</span>
          </div>
          <div className="relative grid grid-cols-[1fr_auto_1.3fr_auto_1fr] items-stretch max-[760px]:grid-cols-1">
            <Phase label="Resting" title="Capital in Aave" sub="earning lending yield" tone="calm" />
            <Arrow>pull JIT →</Arrow>
            <Phase label="On swap" title="Just-enough liquidity" sub="hook sizes it to the trade, executes in-range" tone="hot" />
            <Arrow>← return</Arrow>
            <Phase label="Resting" title="Back in Aave" sub="remainder re-deposited, fees + MEV booked" tone="calm" />
          </div>
        </div>

        {/* five steps */}
        <div className="grid grid-cols-5 gap-3 mt-4 max-[900px]:grid-cols-1">
          {STEPS.map((s) => (
            <div key={s.n} className={`rounded-2xl border p-[18px] ${s.hot ? 'bg-[rgba(108,108,240,0.06)] border-[rgba(108,108,240,0.28)]' : 'bg-white border-hair'}`}>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-[12px] font-semibold tabular-nums ${s.hot ? 'text-peri-deep' : 'text-ink-soft'}`}>{s.n}</span>
                {s.hot && <span className="text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full bg-[rgba(108,108,240,0.14)] text-peri-deep px-2 py-0.5">the trick</span>}
              </div>
              <div className="font-atx-display text-[15px] font-medium tracking-[-0.01em] leading-[1.2] text-ink">{s.h}</div>
              <p className="text-[12.5px] leading-[1.5] text-ink-mid mt-2">{s.p}</p>
            </div>
          ))}
        </div>

        {/* fee split + mental model */}
        <div className="grid grid-cols-[1fr_1fr] gap-4 mt-8 max-[820px]:grid-cols-1">
          {/* fee split */}
          <div className="soft-card p-5">
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-3.5">Where the value goes · example template</div>
            <div className="flex h-9 rounded-full overflow-hidden">
              <div className="bg-peri" style={{ width: '60%' }} />
              <div className="bg-coral2" style={{ width: '30%' }} />
              <div className="bg-pas-peri" style={{ width: '10%' }} />
            </div>
            <div className="flex justify-between mt-2.5 text-[11px] font-medium">
              <span className="text-peri-deep">60% LPs</span>
              <span className="text-coral2-deep">30% treasury</span>
              <span className="text-ink-mid">10% buybacks</span>
            </div>
            <p className="text-[12px] leading-[1.5] text-ink-mid mt-3.5">
              Each project sets its own split. Trading fees, captured MEV, and impact fees all flow through it.
            </p>
          </div>

          {/* normal vs ULV */}
          <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
            <div className="rounded-2xl bg-ground-cool border border-hair p-5">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">✕ Normal pool</div>
              <p className="text-[13px] leading-[1.5] text-ink-mid mt-2.5">Inventory sits in the pool, mostly idle, earning nothing between trades. Bots skim the arb.</p>
            </div>
            <div className="rounded-2xl bg-white border border-[rgba(108,108,240,0.28)] p-5">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">✴ Mintware ULV</div>
              <p className="text-[13px] leading-[1.5] text-ink-mid mt-2.5">Capital earns in Aave, serves each trade just-in-time, and shares the value bots used to take.</p>
            </div>
          </div>
        </div>

        {/* components */}
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mt-9 mb-2.5">The pieces</div>
        <div className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2 max-[420px]:grid-cols-1">
          {COMPONENTS.map((c) => (
            <div key={c.k} className="soft-card p-4">
              <div className="font-atx-display text-[14px] font-medium text-ink">{c.k}</div>
              <p className="text-[12px] leading-[1.45] text-ink-mid mt-1.5">{c.v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Phase({ label, title, sub, tone }: { label: string; title: string; sub: string; tone: 'calm' | 'hot' }) {
  return (
    <div className={`px-5 py-6 flex flex-col gap-1.5 justify-center ${tone === 'hot' ? 'bg-white/[0.06]' : ''} max-[760px]:border-b max-[760px]:border-white/12`}>
      <span className="text-[9.5px] uppercase tracking-[0.12em] text-white/45">{label}</span>
      <span className={`font-atx-display text-[16px] font-medium tracking-[-0.01em] leading-[1.15] ${tone === 'hot' ? 'text-pas-peri' : 'text-white'}`}>{title}</span>
      <span className="text-[11px] text-white/55 leading-[1.4]">{sub}</span>
    </div>
  )
}

function Arrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-3 max-[760px]:py-3">
      <span className="flow-dash-h h-[2px] w-10 rounded-full opacity-70 max-[760px]:hidden" aria-hidden />
      <span className="hidden max-[760px]:inline text-[10px] uppercase tracking-[0.08em] text-white/55 whitespace-nowrap">{children}</span>
    </div>
  )
}
