// YieldPaymentNetworkSection — modular, self-contained band for embedding the
// Yield Payment Network on the home landing (or anywhere). Server component;
// links out to the full /yield-payment-network page. Carries the
// "liquidity as a public good" ethos, which YPN expresses directly.

import Link from 'next/link'
import { YPN_TEASER, YPN_FLOW } from '@/constants/ypn-landing'

export function YieldPaymentNetworkSection() {
  return (
    <section className="border-b border-atx-ink bg-atx-ink text-atx-bone [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[56px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 items-start max-[880px]:grid-cols-1 max-[880px]:gap-8">
          <div>
            <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-acid">{YPN_TEASER.eyebrow}</div>
            <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(26px,4vw,48px)] mt-3.5 max-w-[16ch]">
              {YPN_TEASER.title}
            </h2>
            <p className="text-atx-bone/70 text-[clamp(14px,1.6vw,17px)] leading-[1.55] mt-5 max-w-[52ch]">
              {YPN_TEASER.body}
            </p>
            <p className="font-atx-mono text-[12px] text-atx-bone/50 leading-[1.5] mt-4 max-w-[52ch]">
              ✴ Liquidity should be a public good — pooled once, kept whole, its yield paying forward to the whole ecosystem.
            </p>
            <Link
              href={YPN_TEASER.href}
              className="inline-flex items-center gap-2 mt-7 font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3.5 border border-atx-acid bg-atx-acid text-atx-ink no-underline min-h-[48px] font-bold"
            >
              {YPN_TEASER.cta} →
            </Link>
          </div>

          {/* Mini flow — the 4 nodes, compact */}
          <div className="flex flex-col gap-2">
            {YPN_FLOW.steps.map((s, i) => (
              <div key={s.key} className="flex flex-col">
                <div className="border border-atx-bone/25 bg-atx-bone/[0.04] px-4 py-3 flex items-center gap-3">
                  <span className="font-atx-mono text-[11px] font-bold text-atx-acid shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-[13px] tracking-tight leading-[1.2] truncate">{s.label}</div>
                    <div className="font-atx-mono text-[9.5px] uppercase tracking-[0.08em] text-atx-bone/45 truncate">{s.sub}</div>
                  </div>
                </div>
                {i < YPN_FLOW.steps.length - 1 && (
                  <span className="font-atx-mono text-[13px] text-atx-bone/30 pl-4 py-0.5">↓</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
