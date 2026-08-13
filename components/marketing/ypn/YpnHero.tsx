// YpnHero — Liquid Sovereign Account hero (v2 Privy-esque). COMING SOON: no
// "Launch app" CTA. Server component (anchor scroll only).

import { YPN_HERO, YPN_STATUS } from '@/constants/ypn-landing'

export function YpnHero() {
  return (
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[104px] max-[800px]:py-[64px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-peri-deep">✴ {YPN_HERO.eyebrow}</span>
          <span className="text-[11px] font-semibold px-3 py-1 rounded-full text-peri-deep bg-white border border-[rgba(108,108,240,0.22)] inline-flex items-center gap-2">
            <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" /> {YPN_STATUS.label}
          </span>
        </div>

        <h1 className="font-atx-display font-medium text-ink mt-6 tracking-[-0.045em] leading-[1.0] text-[clamp(2.5rem,6.4vw,4.6rem)] max-w-[15ch] [text-wrap:balance]">
          {YPN_HERO.title} <span className="text-peri">{YPN_HERO.titleAccent}</span>
        </h1>

        <p className="text-ink-mid text-[clamp(1.05rem,1.7vw,1.3rem)] leading-[1.5] mt-7 max-w-[62ch]">
          {YPN_HERO.sub}
        </p>

        <div className="mt-9">
          <a href={YPN_HERO.secondaryHref} className="glass-pill">{YPN_HERO.secondaryCta} ↓</a>
        </div>

        {/* Honest status — coming soon */}
        <div className="mt-8 inline-flex items-start gap-2.5 rounded-2xl bg-white/70 backdrop-blur-[10px] border border-hair px-4 py-3 max-w-[700px]">
          <span className="w-[7px] h-[7px] rounded-full bg-peri shrink-0 mt-[5px]" />
          <span className="text-[12px] leading-[1.55] text-ink-mid">
            <b className="text-ink font-semibold uppercase tracking-[0.06em]">{YPN_STATUS.label}.</b> {YPN_STATUS.note}
          </span>
        </div>
      </div>
    </section>
  )
}
