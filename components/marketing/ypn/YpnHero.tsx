'use client'

// YpnHero — high-impact public header for the Yield Payment Network.
// Client component only because the CTA opens the shared onboarding modal
// (useLaunch). It never reads authenticated wallet state to render.

import { useLaunch } from '@/components/web2/LaunchModal'
import { YPN_HERO, YPN_STATUS } from '@/constants/ypn-landing'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

export function YpnHero() {
  const { launch } = useLaunch()

  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none" style={{ backgroundImage: GRID_BG }}>
      <div className="mx-auto max-w-[1180px] px-6 py-[64px] max-[800px]:px-4 max-[800px]:py-[44px]">
        <div className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55">
          ✴ {YPN_HERO.eyebrow}
        </div>

        <h1 className="font-atx-display font-bold mt-4 tracking-[-0.03em] leading-[0.98] text-[clamp(30px,6.4vw,74px)] max-w-[15ch] break-words [overflow-wrap:anywhere]">
          {YPN_HERO.title} <span className="text-atx-blue">{YPN_HERO.titleAccent}</span>
        </h1>

        <p className="text-atx-ink/70 text-[clamp(15px,1.9vw,20px)] leading-[1.5] mt-6 max-w-[60ch]">
          {YPN_HERO.sub}
        </p>

        <div className="flex flex-wrap items-center gap-3 mt-8">
          <button
            onClick={() => launch()}
            className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3.5 border border-atx-blue bg-atx-blue text-white min-h-[48px]"
          >
            {YPN_HERO.primaryCta} →
          </button>
          <a
            href={YPN_HERO.secondaryHref}
            className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3.5 border border-atx-ink bg-atx-bone text-atx-ink no-underline min-h-[48px] inline-flex items-center"
          >
            {YPN_HERO.secondaryCta}
          </a>
        </div>

        {/* Honest status — consistent with the rest of the marketing surface */}
        <div className="mt-7 inline-flex items-start gap-2.5 border border-atx-ink/25 bg-atx-panel px-3.5 py-2.5 max-w-[640px]">
          <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink shrink-0 mt-[3px]" />
          <span className="font-atx-mono text-[11px] leading-[1.5] text-atx-ink/60">
            <b className="text-atx-ink/80 uppercase tracking-[0.08em]">{YPN_STATUS.label}.</b> {YPN_STATUS.note}
          </span>
        </div>
      </div>
    </section>
  )
}
