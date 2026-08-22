import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import {
  TREASURY_META,
  TREASURY_HERO,
  TREASURY_STATUS,
  TREASURY_STATS,
  TREASURY_PROBLEM,
  TREASURY_MATH,
  TREASURY_SOLUTION,
  TREASURY_MECHANICS,
  TREASURY_TRUST,
  TREASURY_TREND,
  TREASURY_CTA,
  TREASURY_SOURCES,
} from '@/constants/solutions-treasuries'

// =============================================================================
// /solutions/treasuries — PUBLIC marketing surface making Mintware's case for
// on-chain TREASURIES (DAO / protocol / foundation treasuries holding stablecoins).
//
// House design system (matches /yield-payment-network + /proof): light-only,
// V2Nav, periwinkle pastel + one coral accent, one deliberate dark band, platform
// tokens. Copy lives in constants/solutions-treasuries.ts. ONE concentrated
// testnet honesty note carries the legal weight; the rest is confident + present.
// =============================================================================

export const metadata: Metadata = {
  title: TREASURY_META.title,
  description: TREASURY_META.description,
}

export default function TreasuriesSolutionPage() {
  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 pt-[72px] pb-[56px] max-[800px]:pt-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_HERO.eyebrow}
          </div>
          <h1 className="font-atx-display font-bold text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(2.3rem,6vw,4rem)] mt-4 max-w-[16ch] [text-wrap:balance]">
            {TREASURY_HERO.title} <span className="text-gradient-accent">{TREASURY_HERO.titleAccent}</span>
          </h1>
          <p className="text-ink-mid text-[clamp(16px,2vw,20px)] leading-[1.55] mt-6 max-w-[62ch]">
            {TREASURY_HERO.sub}
          </p>
          <div className="mt-8 flex items-center gap-3.5 flex-wrap">
            <Link href={TREASURY_HERO.ctaPrimary.href} className="glass-pill glass-pill-primary no-underline">
              {TREASURY_HERO.ctaPrimary.label} →
            </Link>
            <Link href={TREASURY_HERO.ctaSecondary.href} className="glass-pill no-underline">
              {TREASURY_HERO.ctaSecondary.label}
            </Link>
          </div>

          {/* The one concentrated honesty note */}
          <div
            className="rounded-[16px] border border-hair p-4 mt-8 text-[13px] text-ink-mid leading-[1.55] max-w-[74ch]"
            style={{ background: 'linear-gradient(120deg, rgba(196,122,0,0.09), var(--color-ground-deep, #EEEEF7))' }}
          >
            <b className="text-ink">{TREASURY_STATUS.label}.</b> {TREASURY_STATUS.body}
          </div>
        </div>
      </section>

      {/* ── Landscape stat tiles ────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            The landscape
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.08] text-[clamp(1.5rem,3vw,2.1rem)] mt-3 max-w-[24ch] [text-wrap:balance]">
            Billions are on-chain, in stablecoins, waiting to be spent.
          </h2>
          <div className="grid grid-cols-4 max-[820px]:grid-cols-2 gap-3 mt-8">
            {TREASURY_STATS.map((s) => (
              <div key={s.label} className="rounded-[16px] border border-hair bg-white shadow-card p-5">
                <div className="font-atx-display font-bold text-[clamp(1.6rem,2.6vw,2rem)] tracking-[-0.02em] tabular-nums">
                  {s.value}
                  <sup className="text-peri-deep text-[0.6em] ml-0.5">{s.src}</sup>
                </div>
                <div className="text-[12.5px] text-ink-mid mt-1.5 leading-[1.4]">{s.label}</div>
                <div className="text-[11px] text-ink-soft font-mono mt-2">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The problem ─────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_PROBLEM.eyebrow}
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[20ch] [text-wrap:balance]">
            {TREASURY_PROBLEM.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[70ch]">
            {TREASURY_PROBLEM.body}
          </p>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {TREASURY_PROBLEM.points.map((p) => (
              <div key={p.k} className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-6">
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">{p.k}</div>
                <p className="text-[14px] leading-[1.55] text-ink-mid">{p.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The worked math ─────────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_MATH.eyebrow}
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[20ch] [text-wrap:balance]">
            {TREASURY_MATH.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[66ch]">
            {TREASURY_MATH.intro}
          </p>

          <div className="grid grid-cols-[1fr_320px] max-[820px]:grid-cols-1 gap-5 mt-8 items-stretch">
            {/* the two rows */}
            <div className="flex flex-col gap-3">
              {TREASURY_MATH.rows.map((r) => (
                <div
                  key={r.label}
                  className={`rounded-[var(--radius-card)] border p-5 flex items-center justify-between gap-4 flex-wrap ${
                    r.tone === 'accent' ? 'border-peri/40 bg-white shadow-card' : 'border-hair bg-white'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em] text-ink">{r.label}</div>
                    <div className="text-[12.5px] text-ink-soft font-mono mt-1">Rate {r.rate}</div>
                  </div>
                  <div
                    className={`font-atx-display font-bold text-[clamp(1.3rem,2.4vw,1.7rem)] tabular-nums tracking-[-0.02em] ${
                      r.tone === 'accent' ? 'text-gradient-accent' : 'text-ink-soft'
                    }`}
                  >
                    {r.earns}
                  </div>
                </div>
              ))}
            </div>

            {/* punch card */}
            <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6 flex flex-col justify-center">
              <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft font-atx-display">The gap</div>
              <div className="font-atx-display font-bold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-gradient-accent mt-2 leading-[1.05]">
                {TREASURY_MATH.punch}
              </div>
              <p className="text-[13px] text-ink-mid leading-[1.5] mt-3">{TREASURY_MATH.punchSub}</p>
            </div>
          </div>

          <p className="font-mono text-[11px] text-ink-soft mt-6 max-w-[76ch] leading-[1.5]">{TREASURY_MATH.note}</p>
        </div>
      </section>

      {/* ── How Mintware solves it ──────────────────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_SOLUTION.eyebrow}
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {TREASURY_SOLUTION.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[68ch]">
            {TREASURY_SOLUTION.body}
          </p>
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-8">
            {TREASURY_SOLUTION.cards.map((c) => (
              <div key={c.index} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-mono text-[12px] text-peri-deep tabular-nums mb-2">{c.index}</div>
                <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mb-2">{c.title}</div>
                <p className="text-[14.5px] leading-[1.55] text-ink-mid">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The mechanics, honestly ─────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_MECHANICS.eyebrow}
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {TREASURY_MECHANICS.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[64ch]">
            {TREASURY_MECHANICS.intro}
          </p>
          <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-8 gap-y-5 mt-8">
            {TREASURY_MECHANICS.items.map((it) => (
              <div key={it.k} className="border-t border-hair pt-4">
                <div className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em] text-ink">{it.k}</div>
                <div className="text-[14px] leading-[1.55] text-ink-mid mt-1.5">{it.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why us / trust — the single deliberate dark band ────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[40px]">
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(60% 120% at 85% 0%, rgba(108,108,240,0.55), transparent 55%), radial-gradient(50% 110% at 8% 100%, rgba(244,161,131,0.35), transparent 55%)',
              }}
            />
            <div aria-hidden className="grain pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative px-10 py-11 max-[700px]:px-6 max-[700px]:py-8">
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-pas-peri">{TREASURY_TRUST.eyebrow}</div>
              <h2 className="font-atx-display font-semibold text-white tracking-[-0.03em] leading-[1.06] text-[clamp(1.7rem,3.6vw,2.4rem)] mt-3 max-w-[22ch] [text-wrap:balance]">
                {TREASURY_TRUST.title} <span className="text-gradient-accent">{TREASURY_TRUST.titleAccent}</span>
              </h2>
              <p className="text-[15px] leading-[1.6] mt-3.5 max-w-[58ch]" style={{ color: '#C7C7DC' }}>
                {TREASURY_TRUST.intro}
              </p>
              <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-8 gap-y-5 mt-7">
                {TREASURY_TRUST.items.map((it) => (
                  <div key={it.k} className="border-t border-white/15 pt-4">
                    <div className="font-atx-display font-semibold text-[15.5px] text-white">{it.k}</div>
                    <div className="text-[13px] leading-[1.5] mt-1" style={{ color: '#B9B9D0' }}>
                      {it.v}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex items-center gap-4 flex-wrap">
                <Link href={TREASURY_TRUST.proofCta.href} className="glass-pill glass-pill-primary glass-pill-sm no-underline">
                  {TREASURY_TRUST.proofCta.label}
                </Link>
                <span className="font-mono text-[11px] text-white/45 max-w-[52ch] leading-[1.5]">{TREASURY_TRUST.note}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why now — trends ────────────────────────────────────────────── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_TREND.eyebrow}
          </div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
            {TREASURY_TREND.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.7vw,17px)] leading-[1.6] mt-5 max-w-[70ch]">
            {TREASURY_TREND.body}
          </p>
          <div className="grid grid-cols-3 max-[820px]:grid-cols-1 gap-4 mt-8">
            {TREASURY_TREND.pills.map((p) => (
              <div key={p.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
                <div className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em] text-ink mb-2">{p.k}</div>
                <p className="text-[13.5px] leading-[1.5] text-ink-mid">{p.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep font-atx-display">
            {TREASURY_CTA.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-ink tracking-[-0.035em] leading-[1.03] text-[clamp(2rem,4.6vw,3.2rem)] mt-3 max-w-[16ch] [text-wrap:balance]">
            {TREASURY_CTA.title}
          </h2>
          <p className="text-ink-mid text-[clamp(15px,1.8vw,18px)] leading-[1.55] mt-5 max-w-[62ch]">
            {TREASURY_CTA.body}
          </p>
          <div className="mt-8 flex items-center gap-3.5 flex-wrap">
            <Link href={TREASURY_CTA.primary.href} className="glass-pill glass-pill-primary no-underline">
              {TREASURY_CTA.primary.label} →
            </Link>
            <Link href={TREASURY_CTA.secondary.href} className="glass-pill no-underline">
              {TREASURY_CTA.secondary.label}
            </Link>
            <Link href={TREASURY_CTA.tertiary.href} className="text-[14px] font-medium text-ink-mid hover:text-ink no-underline">
              {TREASURY_CTA.tertiary.label} →
            </Link>
          </div>

          {/* Sources */}
          <div className="mt-14 pt-6 border-t border-hair">
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-soft font-atx-display mb-3">Sources</div>
            <div className="flex flex-col gap-1.5">
              {TREASURY_SOURCES.map((s) => (
                <p key={s.n} className="text-[11.5px] text-ink-soft leading-[1.5] font-mono">
                  <span className="text-peri-deep">{s.n}.</span> {s.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
