// CircleTechBadge — settlement-rail callout. Server component. Framed honestly:
// the network is DESIGNED FOR Circle's programmable USDC rails (not a shipped,
// live integration) — consistent with the in-testing status.

import { YPN_CIRCLE } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-bone/55'

export function CircleTechBadge() {
  return (
    <section className="border-b border-atx-ink bg-atx-ink text-atx-bone [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px] grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-8 items-center max-[860px]:grid-cols-1">
        <div>
          <div className={LABEL}>{YPN_CIRCLE.eyebrow}</div>
          <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.08] text-[clamp(22px,3.2vw,36px)] mt-3 max-w-[20ch]">
            {YPN_CIRCLE.title}
          </h2>
          <p className="text-atx-bone/65 text-[14px] leading-[1.55] mt-4 max-w-[54ch]">{YPN_CIRCLE.body}</p>
        </div>

        <div className="border border-atx-bone/25 bg-atx-bone/[0.04] p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2.5 pb-3 border-b border-atx-bone/15">
            <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-bone shrink-0" />
            <span className="font-atx-mono text-[12px] uppercase tracking-[0.1em] font-bold">Circle · Programmable USDC · CCTP</span>
          </div>
          {YPN_CIRCLE.points.map((p) => (
            <div key={p} className="flex items-start gap-2.5">
              <span className="font-atx-mono text-atx-acid text-[13px] shrink-0 mt-[1px]">→</span>
              <span className="text-[13px] text-atx-bone/75 leading-[1.45]">{p}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
