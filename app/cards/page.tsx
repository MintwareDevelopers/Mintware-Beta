import type { Metadata } from 'next'
import { V2Nav } from '@/components/ui2/V2Nav'
import { CardsCTA } from '@/components/marketing/cards/CardsCTA'
import {
  CARDS_STATUS,
  CARDS_HERO,
  CARDS_FLOW,
  CARDS_STANDING,
  CARDS_WHY,
} from '@/constants/cards-landing'

// =============================================================================
// /cards — PUBLIC marketing surface for the Liquid Sovereign Account's card/spend
// side. Top-of-funnel only; NOT the authenticated app. Companion to
// /yield-payment-network (the fuller yield thesis) — this page goes deep on the
// spend experience specifically, including the Standing service-tier mechanic.
//
// v2 Privy-esque design system (same as /yield-payment-network) — periwinkle
// pastel + translucent glass, V2Nav, GradientPanel. All copy lives in
// constants/cards-landing.ts. Honesty framing: COMING SOON / sandbox-only card
// issuance (see /legal). No "Launch app" CTA, no guarantee-of-limit language.
// =============================================================================

export const metadata: Metadata = {
  title: 'Cards — Mintware',
  description:
    'A card backed by a balance that never idles. Spend straight from a position that stays deployed, and get faster settlement, more headroom, and earlier access the more you actually use it. Coming soon.',
}

export default function CardsPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="cards" />

      {/* hero */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 pt-[64px] pb-[56px] max-[800px]:pt-[40px] max-[800px]:pb-[40px]">
          <div className="glass-pill inline-flex text-[11px] font-semibold tracking-[0.02em]">{CARDS_STATUS.label}</div>
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mt-5">{CARDS_HERO.eyebrow}</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.6vw,3.6rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {CARDS_HERO.title} <span className="text-gradient-accent">{CARDS_HERO.titleAccent}</span>
          </h1>
          <p className="text-ink-mid text-[clamp(15px,2vw,18px)] leading-[1.6] mt-5 max-w-[62ch]">{CARDS_HERO.body}</p>
          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[70ch] leading-[1.5]">{CARDS_STATUS.note}</p>
        </div>
      </section>

      {/* how it works — spend, hold, settle */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{CARDS_FLOW.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {CARDS_FLOW.title}
          </h2>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-9">
            {CARDS_FLOW.steps.map((s, i) => (
              <div key={s.key} className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-6">
                <div className="text-[11px] font-semibold text-peri-deep tabular-nums">{String(i + 1).padStart(2, '0')}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mt-1.5">{s.label}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid mt-2">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Standing — the flagship mechanic */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{CARDS_STANDING.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {CARDS_STANDING.title} <span className="text-gradient-accent">{CARDS_STANDING.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[64ch]">{CARDS_STANDING.body}</p>

          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {CARDS_STANDING.tiers.map((t, i) => (
              <div key={t.name} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="text-[11px] font-semibold text-peri-deep tabular-nums">{String(i + 1).padStart(2, '0')}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mt-1.5">{t.name}</div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-soft mt-2">{t.unlock}</div>
                <div className="font-atx-display font-semibold text-[14px] text-peri-deep mt-3">{t.perk}</div>
                <p className="text-[13.5px] leading-[1.5] text-ink-mid mt-1.5">{t.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 mt-8 max-w-[70ch]">
            {CARDS_STANDING.guardrails.map((g) => (
              <div key={g} className="flex items-start gap-2.5 text-[13.5px] text-ink-mid leading-[1.5]">
                <span className="text-peri-deep mt-[2px] shrink-0" aria-hidden>✓</span>
                <span>{g}</span>
              </div>
            ))}
          </div>

          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[74ch] leading-[1.5]">{CARDS_STANDING.note}</p>
        </div>
      </section>

      {/* why this isn't a generic crypto card */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{CARDS_WHY.eyebrow}</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {CARDS_WHY.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[64ch]">{CARDS_WHY.intro}</p>
          <div className="flex flex-col gap-3 mt-8">
            {CARDS_WHY.rows.map((r) => (
              <div
                key={r.product}
                className={`rounded-[var(--radius-card)] border p-5 ${r.us ? 'border-[rgba(108,108,240,0.3)] bg-ground-cool' : 'border-hair bg-white'}`}
              >
                <div className="font-atx-display font-semibold text-[15px] tracking-[-0.01em] text-ink">{r.product}</div>
                <p className="text-[13.5px] leading-[1.5] text-ink-mid mt-1.5">{r.tradeoff}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CardsCTA />
    </div>
  )
}
