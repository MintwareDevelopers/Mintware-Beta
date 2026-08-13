// ValuePropMatrixTable — Audience × Pain × YPN Solution. Server component.
// Desktop: a 3-column matrix. Mobile: stacked cards (the matrix would overflow).

import { YPN_MATRIX } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

// Literal class map so Tailwind's static scanner generates these bg colors.
const DOT: Record<string, string> = {
  'text-atx-blue': 'bg-atx-blue',
  'text-atx-coral': 'bg-atx-coral',
  'text-atx-mesquite': 'bg-atx-mesquite',
}

export function ValuePropMatrixTable() {
  return (
    <section className="border-b border-atx-ink bg-atx-panel [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_MATRIX.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,40px)] mt-3">
          {YPN_MATRIX.title}
        </h2>

        {/* Desktop matrix */}
        <div className="mt-9 border border-atx-ink bg-atx-bone max-[820px]:hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)] border-b border-atx-ink bg-atx-panel">
            {YPN_MATRIX.columns.map((h) => (
              <div key={h} className={`${LABEL} text-[9.5px] px-5 py-3`}>{h}</div>
            ))}
          </div>
          {YPN_MATRIX.rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)] border-b border-atx-ink/15 last:border-b-0">
              <div className="px-5 py-5 flex items-start gap-2.5">
                <span className={`w-[8px] h-[8px] border border-atx-ink shrink-0 mt-[5px] ${DOT[r.accent]}`} />
                <span className="font-bold text-[14px] tracking-tight leading-[1.3]">{r.audience}</span>
              </div>
              <div className="px-5 py-5 text-[13px] text-atx-ink/60 leading-[1.45]">{r.pain}</div>
              <div className="px-5 py-5">
                <div className={`font-bold text-[14px] tracking-tight ${r.accent}`}>{r.solution}</div>
                <div className="text-[13px] text-atx-ink/65 leading-[1.45] mt-1">{r.solutionDetail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile stacked cards */}
        <div className="mt-8 hidden max-[820px]:flex flex-col gap-3">
          {YPN_MATRIX.rows.map((r) => (
            <div key={r.key} className="border border-atx-ink bg-atx-bone p-[18px]">
              <div className="flex items-center gap-2.5">
                <span className={`w-[8px] h-[8px] border border-atx-ink shrink-0 ${DOT[r.accent]}`} />
                <span className="font-bold text-[15px] tracking-tight">{r.audience}</span>
              </div>
              <div className="mt-3">
                <div className={`${LABEL} text-[9px] mb-1`}>Today’s pain</div>
                <p className="text-[13px] text-atx-ink/60 leading-[1.45]">{r.pain}</p>
              </div>
              <div className="mt-3 pt-3 border-t border-atx-ink/15">
                <div className={`${LABEL} text-[9px] mb-1`}>The YPN solution</div>
                <div className={`font-bold text-[14px] tracking-tight ${r.accent}`}>{r.solution}</div>
                <p className="text-[13px] text-atx-ink/65 leading-[1.45] mt-1">{r.solutionDetail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
