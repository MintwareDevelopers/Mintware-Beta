// CoreMechanismSection — "End the idle cash tax" thesis, as a liquidity-vs-yield
// comparison. The Liquid Sovereign Account is the row that refuses the trade-off.
// v2 Privy-esque. Server component.

import { YPN_THESIS } from '@/constants/ypn-landing'

export function CoreMechanismSection() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_THESIS.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(1.9rem,4.2vw,3rem)] mt-3 max-w-[16ch] [text-wrap:balance]">
          {YPN_THESIS.title}
        </h2>
        <p className="text-ink-mid text-[16px] leading-[1.55] mt-4 max-w-[64ch]">{YPN_THESIS.intro}</p>

        {/* Desktop comparison */}
        <div className="mt-10 rounded-2xl border border-hair overflow-hidden bg-white max-[760px]:hidden">
          <div className="grid grid-cols-[minmax(0,1.2fr)_120px_140px_minmax(0,1.6fr)] bg-ground-cool border-b border-hair">
            {['Product', 'Liquidity', 'Yield', 'The catch'].map((h) => (
              <div key={h} className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-5 py-3.5">{h}</div>
            ))}
          </div>
          {YPN_THESIS.rows.map((r) => (
            <div key={r.product} className={`grid grid-cols-[minmax(0,1.2fr)_120px_140px_minmax(0,1.6fr)] border-b border-hair-soft last:border-b-0 ${r.us ? 'bg-[rgba(108,108,240,0.06)]' : ''}`}>
              <div className="px-5 py-[18px] flex items-center gap-2.5">
                {r.us && <span className="w-[8px] h-[8px] rounded-full bg-peri shrink-0" />}
                <span className={`text-[14px] tracking-[-0.01em] leading-[1.3] ${r.us ? 'font-semibold text-peri-deep' : 'font-medium text-ink'}`}>{r.product}</span>
              </div>
              <div className="px-5 py-[18px] text-[13px] text-ink-mid flex items-center">{r.liquidity}</div>
              <div className="px-5 py-[18px] text-[13px] text-ink-mid flex items-center">{r.yield}</div>
              <div className={`px-5 py-[18px] text-[13px] leading-[1.4] flex items-center ${r.us ? 'text-ink' : 'text-ink-soft'}`}>{r.verdict}</div>
            </div>
          ))}
        </div>

        {/* Mobile stacked */}
        <div className="mt-8 hidden max-[760px]:flex flex-col gap-3">
          {YPN_THESIS.rows.map((r) => (
            <div key={r.product} className={`rounded-2xl border p-[18px] ${r.us ? 'bg-[rgba(108,108,240,0.06)] border-[rgba(108,108,240,0.24)]' : 'bg-white border-hair'}`}>
              <div className={`text-[15px] tracking-[-0.01em] ${r.us ? 'font-semibold text-peri-deep' : 'font-medium text-ink'}`}>{r.product}</div>
              <div className="flex gap-2 mt-2.5">
                <span className="text-[10px] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-hair text-ink-mid">{r.liquidity}</span>
                <span className="text-[10px] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-hair text-ink-mid">{r.yield}</span>
              </div>
              <p className="text-[13px] text-ink-mid leading-[1.45] mt-3">{r.verdict}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
