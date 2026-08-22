import type { Metadata } from 'next'
import { Fragment } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { YpnHero } from '@/components/marketing/ypn/YpnHero'
import { PillarArchitectureDiagram } from '@/components/marketing/ypn/PillarArchitectureDiagram'
import { PillarCardGrid } from '@/components/marketing/ypn/PillarCardGrid'
import { ValuePropMatrixTable } from '@/components/marketing/ypn/ValuePropMatrixTable'
import { YieldCalculatorWidget } from '@/components/marketing/ypn/YieldCalculatorWidget'
import { CircleTechBadge } from '@/components/marketing/ypn/CircleTechBadge'
import { CoreMechanismSection } from '@/components/marketing/ypn/CoreMechanismSection'
import { AppConversionCTA } from '@/components/marketing/ypn/AppConversionCTA'
import { YPN_ETHOS, YPN_LIQUIDITY, YPN_TECH, YPN_ETH_SENIOR, YPN_STANDING } from '@/constants/ypn-landing'

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
    'Cash that earns while you spend it. USDC in a Uniswap v4 Unified Liquidity Vault earns institutional yield (Aave v3 + v4 MEV) and stays 100% spendable at Visa terminals in sub-400ms — you spend from yield, not your position. Coming soon.',
}

export default function YieldPaymentNetworkPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="ypn" />
      <YpnHero />

      <CoreMechanismSection />
      <PillarArchitectureDiagram />
      <PillarCardGrid />

      {/* How the liquidity works — the blended model + dual doors */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_LIQUIDITY.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[16ch] [text-wrap:balance]">
            {YPN_LIQUIDITY.title} <span className="text-gradient-accent">{YPN_LIQUIDITY.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">{YPN_LIQUIDITY.body}</p>

          {/* mini flow */}
          <div className="flex items-stretch max-[820px]:flex-col mt-8">
            {YPN_LIQUIDITY.flow.map((s, i) => (
              <Fragment key={s.label}>
                <div className="flex-1 rounded-2xl border border-hair bg-white shadow-card p-4 min-w-0">
                  <div className="text-[11px] font-semibold text-peri-deep tabular-nums">{String(i + 1).padStart(2, '0')}</div>
                  <div className="font-atx-display font-semibold text-[14.5px] tracking-[-0.01em] text-ink mt-1.5">{s.label}</div>
                  <div className="text-[11.5px] text-ink-soft leading-[1.45] mt-1">{s.sub}</div>
                </div>
                {i < YPN_LIQUIDITY.flow.length - 1 && (
                  <div className="flex items-center justify-center px-2 shrink-0 max-[820px]:justify-start max-[820px]:pl-6 max-[820px]:py-1">
                    <span aria-hidden className="text-peri-deep text-[13px] max-[820px]:hidden">→</span>
                    <span aria-hidden className="text-peri-deep text-[13px] hidden max-[820px]:inline">↓</span>
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {/* dual doors */}
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-5">
            {YPN_LIQUIDITY.doors.map((d) => (
              <div key={d.kicker} className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-6">
                <div className={`font-mono text-[11px] uppercase tracking-[0.1em] mb-2 ${d.tone === 'coral' ? 'text-coral2-deep' : 'text-peri-deep'}`}>{d.kicker}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mb-1.5">{d.title}</div>
                <p className="text-[14.5px] leading-[1.55] text-ink-mid">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The senior tranche — the headline value prop (counsel-safe framing) */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_ETH_SENIOR.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {YPN_ETH_SENIOR.title} <span className="text-gradient-accent">{YPN_ETH_SENIOR.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[70ch]">{YPN_ETH_SENIOR.body}</p>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {YPN_ETH_SENIOR.cards.map((c) => (
              <div key={c.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{c.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{c.v}</p>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[74ch] leading-[1.5]">{YPN_ETH_SENIOR.note}</p>
        </div>
      </section>

      {/* Standing — spend-based service tiers (counsel-safe framing) */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_STANDING.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {YPN_STANDING.title} <span className="text-gradient-accent">{YPN_STANDING.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[64ch]">{YPN_STANDING.body}</p>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {YPN_STANDING.tiers.map((t, i) => (
              <div key={t.name} className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-6">
                <div className="text-[11px] font-semibold text-peri-deep tabular-nums">{String(i + 1).padStart(2, '0')}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mt-1.5">{t.name}</div>
                <div className="text-[11.5px] uppercase tracking-[0.08em] text-ink-soft mt-2">{t.unlock}</div>
                <p className="text-[14px] leading-[1.5] text-ink-mid mt-2">{t.perk}</p>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[74ch] leading-[1.5]">{YPN_STANDING.note}</p>
        </div>
      </section>

      {/* The epic tech — a single bold dark moment, proof of the model above.
          Flanked by light sections so no two colored panels ever stack. */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[40px]">
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 85% 0%, rgba(108,108,240,0.55), transparent 55%), radial-gradient(50% 110% at 8% 100%, rgba(244,161,131,0.35), transparent 55%)' }} />
            <div aria-hidden className="grain pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative px-10 py-11 max-[700px]:px-6 max-[700px]:py-8">
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-pas-peri">{YPN_TECH.eyebrow}</div>
              <h2 className="font-atx-display font-semibold text-white tracking-[-0.03em] leading-[1.06] text-[clamp(1.7rem,3.6vw,2.4rem)] mt-3 [text-wrap:balance]">
                {YPN_TECH.title} <span className="text-gradient-accent">{YPN_TECH.titleAccent}</span>
              </h2>
              <p className="text-[15px] leading-[1.6] mt-3.5 max-w-[56ch]" style={{ color: '#C7C7DC' }}>{YPN_TECH.intro}</p>
              <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-8 gap-y-5 mt-7">
                {YPN_TECH.items.map((it) => (
                  <div key={it.k} className="border-t border-white/15 pt-4">
                    <div className="font-atx-display font-semibold text-[15.5px] text-white">{it.k}</div>
                    <div className="text-[13px] leading-[1.5] mt-1" style={{ color: '#B9B9D0' }}>{it.v}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[11px] text-white/45 mt-7">{YPN_TECH.note}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Ethos — liquidity as a public good */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_ETHOS.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3.5 max-w-[20ch] [text-wrap:balance]">
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
