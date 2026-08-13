// CircleTechBadge — settlement stack (Arc · Circle · Privy · Visa). v2
// Privy-esque: rendered inside a pastel GradientPanel (the elevated moment),
// framed honestly as the DESIGNED rail, not a shipped integration.

import { YPN_CIRCLE } from '@/constants/ypn-landing'
import { GradientPanel } from '@/components/ui2/GradientPanel'

export function CircleTechBadge() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[64px] max-[800px]:py-[48px]">
        <GradientPanel tone="balanced" className="p-10 max-[800px]:p-7">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-9 items-center max-[860px]:grid-cols-1">
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_CIRCLE.eyebrow}</div>
              <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.08] text-[clamp(1.6rem,3.2vw,2.4rem)] mt-3 max-w-[20ch] [text-wrap:balance]">
                {YPN_CIRCLE.title}
              </h2>
              <p className="text-ink-mid text-[14px] leading-[1.55] mt-4 max-w-[54ch]">{YPN_CIRCLE.body}</p>
            </div>

            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="flex flex-col gap-2.5 pb-4 border-b border-hair">
                {YPN_CIRCLE.stack.map((s) => (
                  <div key={s.name} className="flex items-center gap-2.5">
                    <span className="w-[9px] h-[9px] rounded-full bg-peri shrink-0" />
                    <span className="font-atx-display text-[13px] uppercase tracking-[0.06em] font-semibold text-ink shrink-0">{s.name}</span>
                    <span className="text-[10px] text-ink-soft truncate">{s.role}</span>
                  </div>
                ))}
              </div>
              {YPN_CIRCLE.points.map((p) => (
                <div key={p} className="flex items-start gap-2.5">
                  <span className="text-peri text-[13px] shrink-0 mt-[1px]">→</span>
                  <span className="text-[13px] text-ink-mid leading-[1.45]">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </GradientPanel>
      </div>
    </section>
  )
}
