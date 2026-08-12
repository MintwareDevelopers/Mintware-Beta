'use client'

// SwapWalkthrough — "one swap, in numbers." Makes the ULV mechanism concrete by
// walking a single trade through the vault: capital resting in Aave, JIT pull,
// fee + MEV capture, return. Illustrative figures under the testnet framing.

const EY = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

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
    <section className="border-b border-atx-ink bg-atx-bone">
      <div className="max-w-[1100px] mx-auto px-7 py-[56px] max-[800px]:px-4 mw-reveal">
        <div className="flex items-baseline gap-3.5 flex-wrap">
          <span className={EY}>Worked example · illustrative</span>
          <span className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-ink/50 border border-atx-ink/20 px-2 py-1">Numbers illustrate the mechanism</span>
        </div>
        <h2 className="font-bold tracking-[-0.02em] leading-[1.03] text-[clamp(28px,3.6vw,46px)] mt-4 max-w-[16ch]">
          One swap, <span className="text-atx-blue">in numbers.</span>
        </h2>
        <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-4">
          Here’s a single $50k trade moving through a vault that holds $2M — and why the capital
          behind it earns in two places at once.
        </p>

        <div className="grid grid-cols-4 border border-atx-ink mt-9 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`p-5 flex flex-col mw-lift ${s.hot ? 'bg-atx-panel' : 'bg-atx-bone'} border-atx-ink
                ${i < 3 ? 'border-r max-[900px]:[&:nth-child(2)]:border-r-0 max-[520px]:border-r-0' : ''}
                ${i < 2 ? 'max-[900px]:border-b' : ''} ${i < 3 ? 'max-[520px]:border-b' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`font-atx-mono text-[12px] font-bold ${s.hot ? 'text-atx-blue' : 'text-atx-ink/45'}`}>{s.n}</span>
                {s.hot && <span className="font-atx-mono text-[9px] uppercase tracking-[0.08em] bg-atx-acid border border-atx-ink px-1.5 py-0.5">JIT</span>}
              </div>
              <div className="text-[15px] font-bold tracking-[-0.01em] leading-[1.2]">{s.h}</div>
              <div className="mt-3 mb-0.5">
                <span className={`font-atx-mono font-bold tracking-tight ${s.hot ? 'text-atx-blue' : 'text-atx-ink'} text-[clamp(18px,2vw,22px)]`}>{s.stat}</span>
              </div>
              <div className="font-atx-mono text-[9.5px] uppercase tracking-[0.1em] text-atx-ink/45">{s.statLabel}</div>
              <p className="text-[12.5px] leading-[1.5] text-atx-ink/60 mt-3">{s.body}</p>
            </div>
          ))}
        </div>

        {/* the payoff */}
        <div className="border border-atx-ink border-t-0 bg-atx-panel px-5 py-4 flex items-center gap-3 flex-wrap max-[900px]:border-t">
          <span className="font-atx-mono text-[11px] uppercase tracking-[0.12em] text-atx-mesquite">The payoff</span>
          <span className="text-[13.5px] text-atx-ink/75 leading-[1.5]">
            A normal pool would have left that <b className="text-atx-ink">$1.9M idle</b> between trades. Here it earned Aave
            yield the <i>whole time</i> — <b className="text-atx-ink">and</b> the swap fees + MEV on top. Two earning layers from one deposit.
          </span>
        </div>
      </div>
    </section>
  )
}
