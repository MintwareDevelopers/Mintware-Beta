'use client'

// TrustPosture — honest "where this stands" band for the Vaults education page.
// Deliberately conservative: states the testnet reality, the design approach, and
// the audit posture without claiming live TVL/yields or a finished security review.

const EY = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

const POINTS: { k: string; h: string; body: string }[] = [
  {
    k: 'Live state',
    h: 'In testing on Base Sepolia',
    body: 'Vaults run on a testnet contract today — deposit test USDC and try the full flow end-to-end. Every figure on this page illustrates the mechanism; no live TVL or yield is claimed.',
  },
  {
    k: 'Design',
    h: 'Enforced in a Uniswap V4 hook',
    body: 'A vault-only liquidity gate, the dynamic fee, and value capture live in the hook. Value-moving paths are reentrancy-guarded, with a guardian kill-switch that can pause instantly.',
  },
  {
    k: 'Audit posture',
    h: 'Internal audit done · external before mainnet',
    body: 'An internal adversarial audit has run and its findings are closed. An independent external audit gates any mainnet value — real funds don’t go on unaudited code.',
  },
]

export function TrustPosture() {
  return (
    <section className="border-b border-atx-ink bg-atx-panel">
      <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4 mw-reveal">
        <div className={EY}>Trust · where this stands</div>
        <h2 className="font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3vw,38px)] mt-3.5 max-w-[22ch]">
          We tell you what’s live and <span className="text-atx-blue">what’s still a mechanism.</span>
        </h2>
        <div className="grid grid-cols-3 border border-atx-ink mt-8 bg-atx-bone max-[760px]:grid-cols-1">
          {POINTS.map((p, i) => (
            <div key={p.k} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-[760px]:border-r-0 max-[760px]:border-b max-[760px]:border-atx-ink' : ''}`}>
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/45">{p.k}</div>
              <div className="text-[16px] font-bold tracking-[-0.01em] leading-[1.2] mt-2">{p.h}</div>
              <p className="text-[13px] leading-[1.55] text-atx-ink/65 mt-2.5">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
