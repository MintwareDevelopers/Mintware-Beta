'use client'

// MarketEngine walkthrough using current deposit and withdrawal mechanics.

const STEPS: { n: string; h: string; body: string; stat: string; statLabel: string; hot?: boolean }[] = [
  {
    n: '01', h: 'Fresh mark', statLabel: 'deposit guard',
    stat: 'Required',
    body: 'A deposit needs a fresh mark for the non-quote token, with pool spot near that mark.',
  },
  {
    n: '02', h: 'Add pool tokens', statLabel: 'one or both',
    stat: 'Flexible', hot: true,
    body: 'A single- or two-token deposit mints shares subject to the caller’s minimum-shares floor.',
  },
  {
    n: '03', h: 'Hold engine shares', statLabel: 'quote-asset value',
    stat: 'One token',
    body: 'The engine issues a single share token valued in the pool’s quote asset.',
  },
  {
    n: '04', h: 'Withdraw in kind', statLabel: 'both pool tokens',
    stat: 'Pro-rata',
    body: 'Withdrawals return both pool tokens pro-rata with minimum-output checks and still work if the mark is stale.',
  },
]

export function SwapWalkthrough() {
  return (
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">MarketEngine · current mechanics</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft rounded-full border border-hair px-2.5 py-1">Testnet · unaudited</span>
        </div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-4 max-w-[16ch] [text-wrap:balance]">
          One engine, <span className="text-peri">four steps.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-ink-mid max-w-[62ch] mt-4">
          Deposits are guarded by a fresh mark and spot check; withdrawals return both pool tokens pro-rata.
        </p>

        <div className="grid grid-cols-4 gap-3 mt-9 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
          {STEPS.map((s) => (
            <div key={s.n} className={`rounded-2xl border p-5 flex flex-col ${s.hot ? 'bg-[rgba(108,108,240,0.06)] border-[rgba(108,108,240,0.28)]' : 'bg-white border-hair'}`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-[12px] font-semibold tabular-nums ${s.hot ? 'text-peri-deep' : 'text-ink-soft'}`}>{s.n}</span>
                {s.hot && <span className="text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full bg-[rgba(108,108,240,0.14)] text-peri-deep px-2 py-0.5">Guard</span>}
              </div>
              <div className="font-atx-display text-[15px] font-medium tracking-[-0.01em] leading-[1.2] text-ink">{s.h}</div>
              <div className="mt-3 mb-0.5">
                <span className={`font-atx-display font-medium tracking-tight tabular-nums ${s.hot ? 'text-peri-deep' : 'text-ink'} text-[clamp(18px,2vw,22px)]`}>{s.stat}</span>
              </div>
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-soft">{s.statLabel}</div>
              <p className="text-[12.5px] leading-[1.5] text-ink-mid mt-3">{s.body}</p>
            </div>
          ))}
        </div>

        {/* the payoff */}
        <div className="rounded-2xl bg-white border border-hair px-5 py-4 flex items-center gap-3 flex-wrap mt-3">
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">The payoff</span>
          <span className="text-[13.5px] text-ink-mid leading-[1.5]">
            Robinhood testnet adapters hold allocated tokens ready and do not earn yield. External audit gates real value.
          </span>
        </div>
      </div>
    </section>
  )
}
