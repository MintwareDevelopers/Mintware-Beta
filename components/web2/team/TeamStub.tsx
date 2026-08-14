// TeamStub — a tasteful "coming" section placeholder for the Treasury Terminal.
// Design-forward preview scaffolding: title + framing + a "what's coming" list, so
// each section reads as a real, planned surface rather than an empty page. Honest:
// clearly a preview, nothing live.

import type { ReactNode } from 'react'

export function TeamStub({ title, blurb, coming, children }: { title: string; blurb: string; coming: string[]; children?: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-medium text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">{title}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Preview</span>
      </div>
      <p className="text-ink-mid text-[15px] leading-[1.55] max-w-[62ch] mt-3">{blurb}</p>

      {children}

      <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-6 mt-6 max-w-[720px]">
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-3.5">What’s coming</div>
        <ul className="flex flex-col gap-2.5">
          {coming.map((c) => (
            <li key={c} className="flex gap-2.5 items-start text-[14px] leading-[1.5] text-ink-mid">
              <span className="w-[7px] h-[7px] mt-1.5 rounded-full bg-peri inline-block shrink-0" />
              {c}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Design preview. The cards, settlement, and governance stack is in development — nothing here is live or an offer.</p>
    </>
  )
}
