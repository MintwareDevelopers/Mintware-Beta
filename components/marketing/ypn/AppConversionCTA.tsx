'use client'

// AppConversionCTA — bottom conversion banner. Client only for the launch-modal
// CTA (useLaunch); does not read authenticated wallet state to render.

import Link from 'next/link'
import { useLaunch } from '@/components/web2/LaunchModal'
import { YPN_CTA } from '@/constants/ypn-landing'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

export function AppConversionCTA() {
  const { launch } = useLaunch()

  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none" style={{ backgroundImage: GRID_BG }}>
      <div className="mx-auto max-w-[1180px] px-6 py-[56px] max-[800px]:px-4 max-[800px]:py-[40px] flex items-center justify-between gap-8 flex-wrap">
        <div className="max-w-[640px]">
          <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55">{YPN_CTA.eyebrow}</div>
          <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,42px)] mt-3">
            {YPN_CTA.title}
          </h2>
          <p className="text-atx-ink/65 text-[15px] leading-[1.5] mt-3 max-w-[54ch]">{YPN_CTA.body}</p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <button
            onClick={() => launch()}
            className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3.5 border border-atx-blue bg-atx-blue text-white whitespace-nowrap min-h-[48px]"
          >
            {YPN_CTA.primaryCta} →
          </button>
          <Link
            href={YPN_CTA.secondaryHref}
            className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3.5 border border-atx-ink bg-atx-bone text-atx-ink no-underline whitespace-nowrap min-h-[48px] inline-flex items-center"
          >
            {YPN_CTA.secondaryCta}
          </Link>
        </div>
      </div>
    </section>
  )
}
