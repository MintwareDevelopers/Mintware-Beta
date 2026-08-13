// CoreMechanismSection — "End the idle cash tax". The core thesis rendered as a
// liquidity-vs-yield comparison, with the Liquid Sovereign Account as the row
// that refuses the trade-off. Server component.

import { YPN_THESIS } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

export function CoreMechanismSection() {
  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_THESIS.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(26px,4.2vw,48px)] mt-3 max-w-[16ch]">
          {YPN_THESIS.title}
        </h2>
        <p className="text-atx-ink/70 text-[16px] leading-[1.55] mt-4 max-w-[64ch]">{YPN_THESIS.intro}</p>

        {/* Desktop comparison */}
        <div className="mt-9 border border-atx-ink bg-atx-bone max-[760px]:hidden">
          <div className="grid grid-cols-[minmax(0,1.2fr)_120px_140px_minmax(0,1.6fr)] border-b border-atx-ink bg-atx-panel">
            {['Product', 'Liquidity', 'Yield', 'The catch'].map((h) => (
              <div key={h} className={`${LABEL} text-[9.5px] px-5 py-3`}>{h}</div>
            ))}
          </div>
          {YPN_THESIS.rows.map((r) => (
            <div key={r.product} className={`grid grid-cols-[minmax(0,1.2fr)_120px_140px_minmax(0,1.6fr)] border-b border-atx-ink/15 last:border-b-0 ${r.us ? 'bg-atx-blue/[0.06]' : ''}`}>
              <div className="px-5 py-4 flex items-center gap-2.5">
                {r.us && <span className="w-[8px] h-[8px] bg-atx-blue border border-atx-ink shrink-0" />}
                <span className={`text-[14px] tracking-tight leading-[1.3] ${r.us ? 'font-bold text-atx-blue' : 'font-semibold'}`}>{r.product}</span>
              </div>
              <div className="px-5 py-4 font-atx-mono text-[12px] text-atx-ink/70 flex items-center">{r.liquidity}</div>
              <div className="px-5 py-4 font-atx-mono text-[12px] text-atx-ink/70 flex items-center">{r.yield}</div>
              <div className={`px-5 py-4 text-[13px] leading-[1.4] flex items-center ${r.us ? 'text-atx-ink/75' : 'text-atx-ink/55'}`}>{r.verdict}</div>
            </div>
          ))}
        </div>

        {/* Mobile stacked */}
        <div className="mt-8 hidden max-[760px]:flex flex-col gap-3">
          {YPN_THESIS.rows.map((r) => (
            <div key={r.product} className={`border border-atx-ink p-[16px] ${r.us ? 'bg-atx-blue/[0.06] border-l-[3px] border-l-atx-blue' : 'bg-atx-bone'}`}>
              <div className={`text-[15px] tracking-tight ${r.us ? 'font-bold text-atx-blue' : 'font-semibold'}`}>{r.product}</div>
              <div className="flex gap-2 mt-2">
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-atx-ink/25 text-atx-ink/60">{r.liquidity}</span>
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 border border-atx-ink/25 text-atx-ink/60">{r.yield}</span>
              </div>
              <p className="text-[13px] text-atx-ink/60 leading-[1.45] mt-2.5">{r.verdict}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
