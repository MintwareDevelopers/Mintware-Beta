// PillarArchitectureDiagram — the engine flow (Deposit → ULV → Privy card intent
// → instant spend). v2 Privy-esque. Server component. Horizontal on desktop,
// vertical on mobile.

import { YPN_FLOW } from '@/constants/ypn-landing'

export function PillarArchitectureDiagram() {
  const steps = YPN_FLOW.steps
  return (
    <section id="how-it-works" className="bg-ground-cool border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_FLOW.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.6vw,2.6rem)] mt-3 max-w-[24ch] [text-wrap:balance]">
          {YPN_FLOW.title}
        </h2>

        <div className="mt-10 flex items-stretch gap-0 max-[900px]:flex-col">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-stretch max-[900px]:flex-col flex-1">
              <div className="flex-1 rounded-2xl border border-hair bg-white p-5 flex flex-col min-w-0 shadow-[0_1px_2px_rgba(23,23,31,0.04)]">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-peri">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[9.5px] uppercase tracking-[0.08em] text-ink-soft truncate">{s.sub}</span>
                </div>
                <div className="font-medium text-[15px] tracking-[-0.01em] mt-2 leading-[1.15] text-ink">{s.label}</div>
                <div className="text-[12.5px] text-ink-mid leading-[1.45] mt-2 flex-1">{s.desc}</div>
              </div>
              {i < steps.length - 1 && (
                <div className="flex items-center justify-center px-2 shrink-0 text-[rgba(108,108,240,0.5)] max-[900px]:py-2">
                  <span className="text-[18px] max-[900px]:hidden">→</span>
                  <span className="text-[18px] hidden max-[900px]:inline">↓</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
