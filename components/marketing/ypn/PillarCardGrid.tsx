// PillarCardGrid — the three YPN pillars (ULV · AI Attribution · Automated
// distribution) with "How it works" + "Why it matters". Server component.

import { YPN_PILLARS } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

export function PillarCardGrid() {
  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_PILLARS.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,40px)] mt-3">
          {YPN_PILLARS.title}
        </h2>

        <div className="mt-9 grid grid-cols-3 gap-4 max-[860px]:grid-cols-1">
          {YPN_PILLARS.cards.map((c) => (
            <div key={c.key} className="border border-atx-ink bg-atx-panel p-6 flex flex-col">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 border border-atx-ink flex items-center justify-center text-[18px] font-atx-mono shrink-0 ${c.accent}`}>
                  {c.icon}
                </div>
                <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">{c.index}</span>
              </div>

              <div className="font-bold text-[17px] tracking-tight mt-4 leading-[1.2]">{c.title}</div>
              <div className={`font-atx-mono text-[10.5px] uppercase tracking-[0.08em] mt-1.5 ${c.accent}`}>{c.subtitle}</div>

              <div className="mt-4">
                <div className={`${LABEL} text-[9.5px] mb-1.5`}>How it works</div>
                <p className="text-[13px] text-atx-ink/65 leading-[1.5]">{c.how}</p>
              </div>
              <div className="mt-4 pt-4 border-t border-atx-ink/15">
                <div className={`${LABEL} text-[9.5px] mb-1.5`}>Why it matters</div>
                <p className="text-[13px] text-atx-ink/65 leading-[1.5]">{c.why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
