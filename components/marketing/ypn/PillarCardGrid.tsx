// PillarCardGrid — the three structural moats. v2 Privy-esque, text-forward
// soft cards (no icons). Server component.

import { YPN_PILLARS } from '@/constants/ypn-landing'

export function PillarCardGrid() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_PILLARS.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,3.8vw,2.8rem)] mt-3 [text-wrap:balance]">
          {YPN_PILLARS.title}
        </h2>

        <div className="mt-10 grid grid-cols-3 gap-4 max-[860px]:grid-cols-1">
          {YPN_PILLARS.cards.map((c) => (
            <div key={c.key} className="soft-card p-7 flex flex-col">
              <div className="font-atx-display font-medium text-[1.15rem] tracking-[-0.02em] text-ink leading-[1.2]">{c.title}</div>
              <div className="text-[10.5px] uppercase tracking-[0.08em] mt-1.5 font-semibold text-peri-deep">{c.subtitle}</div>
              <div className="mt-5">
                <div className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-1.5">How it works</div>
                <p className="text-[13px] text-ink-mid leading-[1.5]">{c.how}</p>
              </div>
              <div className="mt-4 pt-4 border-t border-hair-soft">
                <div className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-1.5">Why it matters</div>
                <p className="text-[13px] text-ink-mid leading-[1.5]">{c.why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
