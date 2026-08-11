'use client'

// =============================================================================
// ULVMechanics — "how it works" for the Unified Liquidity Vault.
// The flagship differentiator: capital lives in Aave earning yield, and a V4 hook
// pulls just-in-time liquidity into the pool for each swap (atomic), capturing
// fees + MEV. Presented as the MECHANISM under the page's testnet-beta framing —
// no live TVL/yield claimed. ATX Settlemint; motion via the global reveal system.
// =============================================================================

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const EY = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

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
    <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
      <div className="max-w-[1100px] mx-auto px-7 py-[56px] max-[800px]:px-4 mw-reveal">
        {/* header */}
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className={EY}>How it works · Unified Liquidity Vault</span>
          <span className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-ink/50 border border-atx-ink/20 px-2 py-1">The mechanism · in testing on Base</span>
        </div>
        <h2 className="font-bold tracking-[-0.02em] leading-[1.03] text-[clamp(28px,3.6vw,46px)] mt-4 max-w-[18ch]">
          Liquidity that <span className="text-atx-blue">never sits idle.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-4">
          A normal pool is a warehouse of inventory sitting idle, earning nothing until a customer walks in.
          The ULV keeps that inventory in a high-yield account — and moves just enough to the front of the store
          for each sale, the instant it’s needed.
        </p>

        {/* atomic-swap centerpiece */}
        <div className="border border-atx-ink bg-atx-bone mt-9">
          <div className="flex items-center justify-between px-5 py-3 border-b border-atx-ink bg-atx-panel">
            <span className={EY}>One swap · one transaction</span>
            <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-mesquite">Atomic</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1.3fr_auto_1fr] items-stretch max-[760px]:grid-cols-1">
            <Phase label="Resting" title="Capital in Aave" sub="earning lending yield" tone="calm" />
            <Arrow>pull JIT →</Arrow>
            <Phase label="On swap" title="Just-enough liquidity" sub="hook sizes it to the trade, executes in-range" tone="hot" />
            <Arrow>← return</Arrow>
            <Phase label="Resting" title="Back in Aave" sub="remainder re-deposited, fees + MEV booked" tone="calm" />
          </div>
        </div>

        {/* five steps */}
        <div className="grid grid-cols-5 border border-atx-ink mt-4 max-[900px]:grid-cols-1">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`p-[18px] ${i < 4 ? 'border-r border-atx-ink max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-atx-ink' : ''} ${s.hot ? 'bg-atx-panel' : 'bg-atx-bone'} mw-lift`}
            >
              <div className="flex items-center justify-between mb-2.5">
                <span className={`font-atx-mono text-[12px] font-bold ${s.hot ? 'text-atx-blue' : 'text-atx-ink/45'}`}>{s.n}</span>
                {s.hot && <span className="font-atx-mono text-[9px] uppercase tracking-[0.08em] bg-atx-acid border border-atx-ink px-1.5 py-0.5">the trick</span>}
              </div>
              <div className="text-[15px] font-bold tracking-[-0.01em] leading-[1.2]">{s.h}</div>
              <p className="text-[12.5px] leading-[1.5] text-atx-ink/60 mt-2">{s.p}</p>
            </div>
          ))}
        </div>

        {/* fee split + mental model */}
        <div className="grid grid-cols-[1fr_1fr] gap-4 mt-8 max-[820px]:grid-cols-1">
          {/* fee split */}
          <div className="border border-atx-ink bg-atx-bone p-5">
            <div className={`${EY} mb-3.5`}>Where the value goes · example template</div>
            <div className="flex h-9 border border-atx-ink">
              <div className="bg-atx-blue" style={{ width: '60%' }} />
              <div className="bg-atx-mesquite border-l border-atx-ink" style={{ width: '30%' }} />
              <div className="bg-atx-acid border-l border-atx-ink" style={{ width: '10%' }} />
            </div>
            <div className="flex justify-between mt-2.5 font-atx-mono text-[11px]">
              <span className="text-atx-blue">60% LPs</span>
              <span className="text-atx-mesquite">30% treasury</span>
              <span className="text-atx-ink/70">10% buybacks</span>
            </div>
            <p className="text-[12px] leading-[1.5] text-atx-ink/55 mt-3.5">
              Each project sets its own split. Trading fees, captured MEV, and impact fees all flow through it.
            </p>
          </div>

          {/* normal vs ULV */}
          <div className="grid grid-cols-2 border border-atx-ink max-[420px]:grid-cols-1">
            <div className="p-5 border-r border-atx-ink bg-atx-panel max-[420px]:border-r-0 max-[420px]:border-b">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-ink/45">✕ Normal pool</div>
              <p className="text-[13px] leading-[1.5] text-atx-ink/70 mt-2.5">Inventory sits in the pool, mostly idle, earning nothing between trades. Bots skim the arb.</p>
            </div>
            <div className="p-5 bg-atx-bone">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-blue">✴ Mintware ULV</div>
              <p className="text-[13px] leading-[1.5] text-atx-ink/70 mt-2.5">Capital earns in Aave, serves each trade just-in-time, and shares the value bots used to take.</p>
            </div>
          </div>
        </div>

        {/* components */}
        <div className={`${EY} mt-9 mb-2.5`}>The pieces</div>
        <div className="grid grid-cols-4 border border-atx-ink max-[760px]:grid-cols-2 max-[420px]:grid-cols-1">
          {COMPONENTS.map((c, i) => (
            <div key={c.k} className={`p-4 mw-lift ${i < 3 ? 'border-r border-atx-ink max-[760px]:[&:nth-child(2)]:border-r-0 max-[420px]:border-r-0' : ''} ${i < 2 ? 'max-[760px]:border-b max-[760px]:border-atx-ink' : ''} ${i < 3 ? 'max-[420px]:border-b max-[420px]:border-atx-ink' : ''} bg-atx-bone`}>
              <div className="text-[14px] font-bold">{c.k}</div>
              <p className="text-[12px] leading-[1.45] text-atx-ink/60 mt-1.5">{c.v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Phase({ label, title, sub, tone }: { label: string; title: string; sub: string; tone: 'calm' | 'hot' }) {
  return (
    <div className={`px-5 py-6 flex flex-col gap-1.5 justify-center ${tone === 'hot' ? 'bg-atx-panel' : 'bg-atx-bone'} max-[760px]:border-b max-[760px]:border-atx-ink/20`}>
      <span className="font-atx-mono text-[9.5px] uppercase tracking-[0.12em] text-atx-ink/45">{label}</span>
      <span className={`text-[16px] font-bold tracking-[-0.01em] leading-[1.15] ${tone === 'hot' ? 'text-atx-blue' : ''}`}>{title}</span>
      <span className="font-atx-mono text-[11px] text-atx-ink/55 leading-[1.4]">{sub}</span>
    </div>
  )
}

function Arrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-2 bg-atx-bone border-x border-atx-ink/15 max-[760px]:py-2 max-[760px]:border-x-0 max-[760px]:border-y max-[760px]:border-atx-ink/15">
      <span className="font-atx-mono text-[10px] uppercase tracking-[0.08em] text-atx-mesquite whitespace-nowrap">{children}</span>
    </div>
  )
}
