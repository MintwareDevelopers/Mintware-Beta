// ValuePropMatrixTable — the three enterprise verticals. v2 Privy-esque.
// Server component. Matrix on desktop, stacked cards on mobile.

import { YPN_MATRIX } from '@/constants/ypn-landing'

export function ValuePropMatrixTable() {
  return (
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_MATRIX.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,3.8vw,2.8rem)] mt-3 [text-wrap:balance]">
          {YPN_MATRIX.title}
        </h2>

        {/* Desktop */}
        <div className="mt-10 rounded-2xl border border-hair overflow-hidden bg-white max-[820px]:hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)] bg-ground-cool border-b border-hair">
            {YPN_MATRIX.columns.map((h) => (
              <div key={h} className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-5 py-3.5">{h}</div>
            ))}
          </div>
          {YPN_MATRIX.rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)] border-b border-hair-soft last:border-b-0">
              <div className="px-5 py-6 flex items-start gap-2.5">
                <span className="w-[8px] h-[8px] rounded-full bg-peri shrink-0 mt-[6px]" />
                <span className="font-medium text-[14px] tracking-[-0.01em] leading-[1.3] text-ink">{r.audience}</span>
              </div>
              <div className="px-5 py-6 text-[13px] text-ink-mid leading-[1.45]">{r.pain}</div>
              <div className="px-5 py-6">
                <div className="font-semibold text-[14px] tracking-[-0.01em] text-peri-deep">{r.solution}</div>
                <div className="text-[13px] text-ink-mid leading-[1.45] mt-1">{r.solutionDetail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile */}
        <div className="mt-8 hidden max-[820px]:flex flex-col gap-3">
          {YPN_MATRIX.rows.map((r) => (
            <div key={r.key} className="rounded-2xl border border-hair bg-white p-[18px]">
              <div className="flex items-center gap-2.5">
                <span className="w-[8px] h-[8px] rounded-full bg-peri shrink-0" />
                <span className="font-medium text-[15px] tracking-[-0.01em] text-ink">{r.audience}</span>
              </div>
              <p className="text-[13px] text-ink-mid leading-[1.45] mt-3">{r.pain}</p>
              <div className="mt-3 pt-3 border-t border-hair-soft">
                <div className="font-semibold text-[14px] tracking-[-0.01em] text-peri-deep">{r.solution}</div>
                <p className="text-[13px] text-ink-mid leading-[1.45] mt-1">{r.solutionDetail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
