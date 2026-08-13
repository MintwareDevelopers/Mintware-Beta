// YieldPaymentNetworkSection — modular, self-contained band for embedding the
// Liquid Sovereign Account on the home landing (or anywhere). Server component;
// links out to the full /yield-payment-network page. Carries the
// "liquidity as a public good" ethos, which the LSA expresses directly.
// Design v2 (Privy-esque): signature GradientPanel, glass pill, soft flow.

import Link from 'next/link'
import { YPN_TEASER, YPN_FLOW } from '@/constants/ypn-landing'
import { GradientPanel } from '@/components/ui2/GradientPanel'

export function YieldPaymentNetworkSection() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 py-[88px] max-[800px]:px-4 max-[800px]:py-[56px]">
        <GradientPanel tone="periwinkle" className="p-10 max-[800px]:p-6">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 items-start max-[880px]:grid-cols-1 max-[880px]:gap-8">
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_TEASER.eyebrow}</div>
              <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(26px,4vw,48px)] mt-3.5 max-w-[16ch] [text-wrap:balance]">
                {YPN_TEASER.title}
              </h2>
              <p className="text-ink-mid text-[clamp(14px,1.6vw,17px)] leading-[1.55] mt-5 max-w-[52ch]">
                {YPN_TEASER.body}
              </p>
              <p className="text-[12px] text-ink-soft leading-[1.5] mt-4 max-w-[52ch]">
                ✴ Liquidity as a public good — never idle, never locked away, and its yield instantly yours to spend.
              </p>
              <Link href={YPN_TEASER.href} className="glass-pill mt-7">
                {YPN_TEASER.cta} →
              </Link>
            </div>

            {/* Mini flow — the 4 nodes, compact */}
            <div className="flex flex-col gap-2">
              {YPN_FLOW.steps.map((s, i) => (
                <div key={s.key} className="flex flex-col">
                  <div className="rounded-2xl border border-hair bg-white/70 backdrop-blur-[10px] px-4 py-3 flex items-center gap-3">
                    <span className="text-[12px] font-semibold text-peri-deep tabular-nums shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="font-atx-display font-medium text-[14px] tracking-[-0.01em] leading-[1.2] text-ink truncate">{s.label}</div>
                      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-soft truncate">{s.sub}</div>
                    </div>
                  </div>
                  {i < YPN_FLOW.steps.length - 1 && (
                    <span className="text-[13px] text-ink-soft pl-5 py-0.5">↓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </GradientPanel>
      </div>
    </section>
  )
}
