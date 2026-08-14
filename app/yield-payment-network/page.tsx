import type { Metadata } from 'next'
import { V2Nav } from '@/components/ui2/V2Nav'
import { YpnHero } from '@/components/marketing/ypn/YpnHero'
import { PillarArchitectureDiagram } from '@/components/marketing/ypn/PillarArchitectureDiagram'
import { PillarCardGrid } from '@/components/marketing/ypn/PillarCardGrid'
import { ValuePropMatrixTable } from '@/components/marketing/ypn/ValuePropMatrixTable'
import { YieldCalculatorWidget } from '@/components/marketing/ypn/YieldCalculatorWidget'
import { CircleTechBadge } from '@/components/marketing/ypn/CircleTechBadge'
import { CoreMechanismSection } from '@/components/marketing/ypn/CoreMechanismSection'
import { BuiltProofSection } from '@/components/marketing/ypn/BuiltProofSection'
import { AppConversionCTA } from '@/components/marketing/ypn/AppConversionCTA'
import { YPN_ETHOS } from '@/constants/ypn-landing'

// =============================================================================
// /yield-payment-network — PUBLIC marketing surface for the Liquid Sovereign
// Account. Top-of-funnel only; NOT the authenticated app.
//
// First page converted to the Privy-esque v2 design system (periwinkle pastel +
// translucent glass; see components/ui2 + globals.css v2 tokens). Honesty
// framing: COMING SOON / in testing. All copy lives in constants/ypn-landing.ts.
// =============================================================================

export const metadata: Metadata = {
  title: 'Liquid Sovereign Account — Mintware',
  description:
    'Cash that earns while you spend it. USDC in a Uniswap v4 Unified Liquidity Vault earns institutional yield (Aave v3 + v4 MEV) and stays 100% spendable at Visa terminals in sub-400ms — principal never moves. Coming soon.',
}

export default function YieldPaymentNetworkPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="ypn" />
      <YpnHero />

      <CoreMechanismSection />
      <PillarArchitectureDiagram />
      <PillarCardGrid />
      <BuiltProofSection />

      {/* Ethos — liquidity as a public good */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_ETHOS.eyebrow}</div>
          <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3.5 max-w-[20ch] [text-wrap:balance]">
            {YPN_ETHOS.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,18px)] leading-[1.55] mt-5 max-w-[64ch]">{YPN_ETHOS.body}</p>
          <p className="font-atx-display font-medium text-[clamp(18px,2.2vw,26px)] tracking-[-0.02em] text-peri mt-6">
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
