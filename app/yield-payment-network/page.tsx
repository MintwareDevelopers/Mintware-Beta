import type { Metadata } from 'next'
import { MarketingNav } from '@/components/web2/MarketingNav'
import { YpnHero } from '@/components/marketing/ypn/YpnHero'
import { PillarArchitectureDiagram } from '@/components/marketing/ypn/PillarArchitectureDiagram'
import { PillarCardGrid } from '@/components/marketing/ypn/PillarCardGrid'
import { ValuePropMatrixTable } from '@/components/marketing/ypn/ValuePropMatrixTable'
import { YieldCalculatorWidget } from '@/components/marketing/ypn/YieldCalculatorWidget'
import { CircleTechBadge } from '@/components/marketing/ypn/CircleTechBadge'
import { AppConversionCTA } from '@/components/marketing/ypn/AppConversionCTA'
import { YPN_INTRO, YPN_ETHOS } from '@/constants/ypn-landing'

// =============================================================================
// /yield-payment-network — PUBLIC marketing surface for the Mintware Yield
// Payment Network (YPN). Top-of-funnel only; NOT the authenticated app.
//
// Honesty framing: the ULV + YPN are in testing ahead of launch; Circle CCTP is
// the designed settlement rail, not a shipped integration; Attribution is live.
// All copy lives in constants/ypn-landing.ts.
// =============================================================================

export const metadata: Metadata = {
  title: 'Yield Payment Network — Mintware',
  description:
    'Fund growth with yield, not your treasury. Park single-sided USDC in a Unified Liquidity Vault, keep your principal intact, and route the yield into attributed user acquisition and campaign payouts. In testing ahead of launch.',
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

export default function YieldPaymentNetworkPage() {
  return (
    <div className="min-h-screen font-atx-display bg-atx-bone text-atx-ink overflow-x-clip [&_*]:rounded-none">
      <MarketingNav active="ypn" />
      <YpnHero />

      {/* Intro */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
          <div className={LABEL}>{YPN_INTRO.eyebrow}</div>
          <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,40px)] mt-3 max-w-[22ch]">
            {YPN_INTRO.title}
          </h2>
          <div className="mt-5 grid gap-4 max-w-[70ch]">
            {YPN_INTRO.body.map((p, i) => (
              <p key={i} className="text-atx-ink/70 text-[16px] leading-[1.55]">{p}</p>
            ))}
          </div>
        </div>
      </section>

      <PillarArchitectureDiagram />
      <PillarCardGrid />

      {/* Ethos — liquidity as a public good */}
      <section className="border-b border-atx-ink bg-atx-blue/[0.05]">
        <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
          <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-blue">{YPN_ETHOS.eyebrow}</div>
          <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.8vw,44px)] mt-3.5 max-w-[20ch]">
            {YPN_ETHOS.title}
          </h2>
          <p className="text-atx-ink/70 text-[clamp(15px,1.7vw,18px)] leading-[1.55] mt-5 max-w-[64ch]">{YPN_ETHOS.body}</p>
          <p className="font-atx-display font-bold text-[clamp(18px,2.2vw,26px)] tracking-[-0.02em] text-atx-blue mt-6">
            “{YPN_ETHOS.quote}”
          </p>
        </div>
      </section>

      <ValuePropMatrixTable />
      <YieldCalculatorWidget />
      <CircleTechBadge />
      <AppConversionCTA />
    </div>
  )
}
