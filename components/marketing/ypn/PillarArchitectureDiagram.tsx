// PillarArchitectureDiagram — the YPN flow, pure presentational (server component).
// Desktop: horizontal row of nodes joined by arrows. Mobile: vertical stack with
// down-arrows. All copy comes from constants/ypn-landing.

import { YPN_FLOW } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

export function PillarArchitectureDiagram() {
  const steps = YPN_FLOW.steps

  return (
    <section id="how-it-works" className="border-b border-atx-ink bg-atx-panel [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_FLOW.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,40px)] mt-3 max-w-[22ch]">
          {YPN_FLOW.title}
        </h2>

        <div className="mt-9 flex items-stretch gap-0 max-[900px]:flex-col">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-stretch max-[900px]:flex-col flex-1">
              <div className="flex-1 border border-atx-ink bg-atx-bone p-[18px] flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-atx-mono text-[11px] font-bold ${s.accent}`}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-atx-mono text-[9.5px] uppercase tracking-[0.08em] text-atx-ink/45 truncate">{s.sub}</span>
                </div>
                <div className="font-bold text-[15px] tracking-tight mt-2 leading-[1.15]">{s.label}</div>
                <div className="text-[12.5px] text-atx-ink/60 leading-[1.45] mt-2 flex-1">{s.desc}</div>
              </div>

              {/* Connector arrow — right on desktop, down on mobile */}
              {i < steps.length - 1 && (
                <div className="flex items-center justify-center px-1.5 shrink-0 text-atx-ink/40 max-[900px]:py-1.5">
                  <span className="font-atx-mono text-[18px] max-[900px]:hidden">→</span>
                  <span className="font-atx-mono text-[18px] hidden max-[900px]:inline">↓</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
