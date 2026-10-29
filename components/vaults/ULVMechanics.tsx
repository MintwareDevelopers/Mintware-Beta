'use client'

// =============================================================================
// MarketEngine mechanics for the current testnet pool product.
// =============================================================================

const STEPS: { n: string; h: string; p: string; hot?: boolean }[] = [
  { n: '01', h: 'Deposit', p: 'Add either pool token or both with a minimum-shares floor.' },
  { n: '02', h: 'Fresh mark', p: 'Deposits require a fresh external mark for the non-quote token.' },
  { n: '03', h: 'Spot check', p: 'Pool spot must be near the mark before a deposit is accepted.', hot: true },
  { n: '04', h: 'Resting liquidity', p: 'Capital sits in the v4 band plus per-token ERC-4626 adapters. Robinhood testnet adapters are idle custody.' },
  { n: '05', h: 'In-kind exit', p: 'Withdraw pro-rata in both tokens with minimum-output checks; exits work when the mark is stale.' },
]

const COMPONENTS: { k: string; v: string }[] = [
  { k: 'MarketEngine', v: 'One engine and one share token per curated pool' },
  { k: 'Resting band', v: 'Managed Uniswap v4 liquidity with guarded recentering' },
  { k: 'Token adapters', v: 'ERC-4626 adapters hold each pool token outside the band' },
  { k: 'Testnet status', v: 'Robinhood Chain testnet · unaudited' },
]

export function ULVMechanics() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
        {/* header */}
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">How it works · MarketEngine</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft rounded-full border border-hair px-2.5 py-1">Robinhood Chain testnet · unaudited</span>
        </div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-4 max-w-[18ch] [text-wrap:balance]">
          Quote-valued shares, <span className="text-peri">liquidity in a resting band.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-ink-mid max-w-[62ch] mt-4">
          One MarketEngine serves each curated pool. It issues one quote-valued share token and holds capital in a resting v4 band plus per-token adapters. Robinhood testnet adapters are idle custody and do not earn yield.
        </p>

        {/* atomic-swap centerpiece · dark pop */}
        <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white mt-9">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 130% at 12% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
          <div className="grain absolute inset-0 opacity-40" aria-hidden />
          <div className="relative flex items-center justify-between px-5 py-3 border-b border-white/12">
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-pas-peri">Current pool lifecycle</span>
            <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-white/55">Testnet</span>
          </div>
          <div className="relative grid grid-cols-[1fr_auto_1.3fr_auto_1fr] items-stretch max-[760px]:grid-cols-1">
            <Phase label="Pool" title="Curated v4 pool" sub="one MarketEngine per pool" tone="calm" />
            <Arrow>deposit →</Arrow>
            <Phase label="Guard" title="Fresh mark" sub="spot must be near the mark" tone="hot" />
            <Arrow>← withdraw</Arrow>
            <Phase label="Exit" title="Both tokens" sub="pro-rata in-kind withdrawal" tone="calm" />
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
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-3.5">Current engine behavior</div>
            <p className="text-[13px] leading-[1.5] text-ink-mid">A single quote-valued share token represents each engine portfolio. The code does not describe the retired 60/30/10 fee split.</p>
          </div>

          {/* normal vs ULV */}
          <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
            <div className="rounded-2xl bg-ground-cool border border-hair p-5">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Deposits</div>
              <p className="text-[13px] leading-[1.5] text-ink-mid mt-2.5">A fresh mark and a spot-near-mark check are required.</p>
            </div>
            <div className="rounded-2xl bg-white border border-[rgba(108,108,240,0.28)] p-5">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Withdrawals</div>
              <p className="text-[13px] leading-[1.5] text-ink-mid mt-2.5">Return both tokens pro-rata and remain available when the mark is stale.</p>
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
