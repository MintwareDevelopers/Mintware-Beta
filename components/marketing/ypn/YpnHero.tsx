// YpnHero — Liquid Sovereign Account hero (v2 Privy-esque). COMING SOON: no
// "Launch app" CTA. Server component. Headline + four capability bullets.

import { YPN_HERO, YPN_STATUS } from '@/constants/ypn-landing'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'

export function YpnHero() {
  return (
    <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
      <AirbrushSplash tone="peri" />
      <div className="relative mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[104px] max-[800px]:py-[64px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-peri-deep">✴ {YPN_HERO.eyebrow}</span>
          <span className="text-[11px] font-semibold px-3 py-1 rounded-full text-peri-deep bg-white border border-[rgba(108,108,240,0.22)] inline-flex items-center gap-2">
            <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" /> {YPN_STATUS.label}
          </span>
        </div>

        <h1 className="font-atx-display font-medium text-ink mt-6 tracking-[-0.045em] leading-[1.0] text-[clamp(2.5rem,6.4vw,4.6rem)] max-w-[15ch] [text-wrap:balance]">
          {YPN_HERO.title} <span className="text-peri">{YPN_HERO.titleAccent}</span>
        </h1>

        {/* Four capabilities */}
        <div className="mt-10 grid grid-cols-2 gap-3 max-w-[860px] max-[680px]:grid-cols-1">
          {YPN_HERO.bullets.map((b) => (
            <div key={b.title} className="rounded-2xl bg-white/70 backdrop-blur-[10px] border border-hair px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="w-[7px] h-[7px] rounded-full bg-peri shrink-0" />
                <span className="font-atx-display font-medium text-[15px] tracking-[-0.01em] text-ink">{b.title}</span>
              </div>
              <p className="text-[13px] leading-[1.5] text-ink-mid mt-1.5 pl-[17px]">{b.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
