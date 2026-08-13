'use client'

// SwapWalkthrough — "one swap, in numbers." Design v2. Makes the ULV mechanism
// concrete by walking a single trade through the vault: capital resting in Aave,
// JIT pull, fee + MEV capture, return. Illustrative figures (testnet framing).

const STEPS: { n: string; h: string; body: string; stat: string; statLabel: string; hot?: boolean }[] = [
  {
    n: '01', h: 'At rest', statLabel: 'in Aave, earning',
    stat: '~$1.9M',
    body: 'The vault holds $2.0M. About 95% sits in Aave earning lending yield — only a thin buffer waits in the pool. That capital is working every second, not idling.',
  },
  {
    n: '02', h: 'A $50k swap arrives', statLabel: 'pulled, just-in-time',
    stat: '~$60k', hot: true,
    body: 'The V4 hook sizes exactly how much liquidity this trade needs at the current range, and pulls only that from Aave — atomically, in the same transaction.',
  },
  {
    n: '03', h: 'The swap executes', statLabel: 'fees + MEV captured',
    stat: '$190',
    body: 'Against that just-in-time liquidity: a 0.30% fee ($150), plus ~$40 of MEV/arbitrage the hook captures that a bot would otherwise have taken.',
  },
  {
    n: '04', h: 'Back to work', statLabel: 'split 60 / 30 / 10',
    stat: '$114 / $57 / $19',
    body: 'The liquidity returns to Aave; it never stopped earning. The $190 captured is split by the vault’s template — LPs / treasury / buybacks.',
  },
]

export function SwapWalkthrough() {
  return (
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Worked example · illustrative</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft rounded-full border border-hair px-2.5 py-1">Numbers illustrate the mechanism</span>
        </div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(1.8rem,3.6vw,2.9rem)] mt-4 max-w-[16ch] [text-wrap:balance]">
          One swap, <span className="text-peri">in numbers.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-ink-mid max-w-[62ch] mt-4">
          Here’s a single $50k trade moving through a vault that holds $2M — and why the capital
          behind it earns in two places at once.
        </p>

        <div className="grid grid-cols-4 gap-3 mt-9 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
          {STEPS.map((s) => (
            <div key={s.n} className={`rounded-2xl border p-5 flex flex-col ${s.hot ? 'bg-[rgba(108,108,240,0.06)] border-[rgba(108,108,240,0.28)]' : 'bg-white border-hair'}`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-[12px] font-semibold tabular-nums ${s.hot ? 'text-peri-deep' : 'text-ink-soft'}`}>{s.n}</span>
                {s.hot && <span className="text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full bg-[rgba(108,108,240,0.14)] text-peri-deep px-2 py-0.5">JIT</span>}
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
            A normal pool would have left that <b className="text-ink">$1.9M idle</b> between trades. Here it earned Aave
            yield the <i>whole time</i> — <b className="text-ink">and</b> the swap fees + MEV on top. Two earning layers from one deposit.
          </span>
        </div>
      </div>
    </section>
  )
}
