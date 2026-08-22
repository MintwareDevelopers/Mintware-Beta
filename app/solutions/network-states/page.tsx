import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { AirbrushSplash } from '@/components/ui2/AirbrushSplash'
import {
  NS_META,
  NS_HERO,
  NS_PROBLEM,
  NS_TRENDS,
  NS_MOVEMENT,
  NS_MATH,
  NS_SOLUTION,
  NS_MECHANICS,
  NS_TRUST,
  NS_CTA,
  NS_SOURCES,
} from '@/constants/solutions-network-states'

// =============================================================================
// /solutions/network-states — PUBLIC marketing surface making Mintware's case
// for network states, charter cities, and online-first settlements with shared
// treasuries + members. Sibling of /teams and /yield-payment-network (v2
// Privy-esque design system). Copy lives in constants/solutions-network-states.ts.
//
// ANGLE: Mintware = the financial rail for a network state — a shared treasury
// that earns while staying spendable at par by members (YPN), non-custodial,
// reputation-weighted membership (Attribution), settled in native USDC (Circle /
// Arc). Leads with the yield story + the two macro trends + movement momentum,
// quantified. Honest: one concentrated testnet/unaudited note; illustrative
// yield only; no deposit / guaranteed / fixed-APY language.
// =============================================================================

export const metadata: Metadata = {
  title: NS_META.title,
  description: NS_META.description,
}

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'
const wrap = 'mx-auto max-w-[1100px] px-6 max-[800px]:px-4 mw-reveal'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 [text-wrap:balance]'
const lead = 'text-[16px] leading-[1.55] text-ink-mid max-w-[62ch] mt-4'

type Stat = { value: string; sub: string; label: string; src: string }

function StatTile({ s, tone = 'peri' }: { s: Stat; tone?: 'peri' | 'coral' }) {
  return (
    <div
      className="rounded-2xl bg-white border border-hair shadow-card p-5"
      style={{ borderTop: `3px solid ${tone === 'coral' ? 'var(--color-coral2)' : 'var(--color-peri)'}` }}
    >
      <div className="font-atx-display font-medium tracking-[-0.02em] leading-none tabular-nums text-[clamp(24px,3.4vw,34px)] text-ink">
        {s.value}
        <span className={`text-[13px] font-semibold ${tone === 'coral' ? 'text-coral2-deep' : 'text-peri-deep'}`}> {s.sub}</span>
      </div>
      <div className="text-[12.5px] text-ink-mid leading-[1.45] mt-2.5">{s.label}</div>
      <div className="text-[10.5px] text-ink-soft mt-2 font-mono">{s.src}</div>
    </div>
  )
}

export default function NetworkStatesSolutionPage() {
  return (
    <div className="font-atx-display bg-white text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-ground-cool border-b border-hair-soft">
        <AirbrushSplash tone="peri" />
        <div className="relative mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[96px] max-[800px]:py-[60px]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={ey}>{NS_HERO.eyebrow}</span>
            <span className="text-[11px] font-semibold px-3 py-1 rounded-full text-peri-deep bg-white border border-[rgba(108,108,240,0.22)] inline-flex items-center gap-2">
              <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" /> Vision · proven on testnet
            </span>
          </div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[17ch] [text-wrap:balance]">
            {NS_HERO.title} <span className="text-gradient-accent">{NS_HERO.titleAccent}</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[64ch]">{NS_HERO.lead}</p>
          <div className="flex flex-wrap gap-3 mt-9">
            <a href={NS_HERO.ctaPrimary.href} className="glass-pill glass-pill-primary">{NS_HERO.ctaPrimary.label}</a>
            <Link href={NS_HERO.ctaSecondary.href} className="glass-pill">{NS_HERO.ctaSecondary.label}</Link>
          </div>
        </div>
      </section>

      {/* ── The problem ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>The problem</div>
          <h2 className={h2}>{NS_PROBLEM.title} <span className="text-gradient-accent">{NS_PROBLEM.titleAccent}</span></h2>
          <p className={lead}>{NS_PROBLEM.lead}</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[760px]:grid-cols-1">
            {NS_PROBLEM.points.map(([k, d]) => (
              <div key={k} className="soft-card p-6">
                <div className="font-atx-display text-[15px] font-medium leading-tight text-ink">{k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-2.5">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 01 · The tailwind (LEAD: the two macro trends, quantified) ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>{NS_TRENDS.eyebrow}</div>
          <h2 className={h2}>{NS_TRENDS.title} <span className="text-gradient-accent">{NS_TRENDS.titleAccent}</span></h2>
          <p className={lead}>{NS_TRENDS.lead}</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            {NS_TRENDS.stats.map((s, i) => (
              <StatTile key={s.label} s={s} tone={i % 2 === 1 ? 'coral' : 'peri'} />
            ))}
          </div>
          <p className="text-[13px] text-ink-mid leading-[1.55] mt-6 max-w-[70ch]">
            <b className="text-peri-deep">↳</b> {NS_TRENDS.note}
          </p>
        </div>
      </section>

      {/* ── Movement momentum (vertical-specific trend) ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>{NS_MOVEMENT.eyebrow}</div>
          <h2 className={h2}>{NS_MOVEMENT.title} <span className="text-gradient-accent">{NS_MOVEMENT.titleAccent}</span></h2>
          <p className={lead}>{NS_MOVEMENT.lead}</p>
          <div className="grid grid-cols-3 gap-3 mt-8 max-[760px]:grid-cols-1">
            {NS_MOVEMENT.stats.map((s, i) => (
              <StatTile key={s.label} s={s} tone={i === 1 ? 'coral' : 'peri'} />
            ))}
          </div>
        </div>
      </section>

      {/* ── 02 · The cost of idle (worked, illustrative math) ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>{NS_MATH.eyebrow}</div>
          <h2 className={h2}>{NS_MATH.title} <span className="text-gradient-accent">{NS_MATH.titleAccent}</span></h2>
          <p className={lead}>{NS_MATH.lead}</p>
          <div className="soft-card mt-8 overflow-hidden">
            {NS_MATH.rows.map((r, i) => (
              <div
                key={r.k}
                className={`grid grid-cols-[1fr_auto] gap-4 items-center px-6 py-[18px] ${i < NS_MATH.rows.length - 1 ? 'border-b border-hair-soft' : ''} ${i === NS_MATH.rows.length - 2 ? 'bg-[rgba(108,108,240,0.06)]' : ''}`}
              >
                <span className={`text-[14px] leading-[1.4] ${i === NS_MATH.rows.length - 2 ? 'font-semibold text-peri-deep' : 'text-ink-mid'}`}>{r.k}</span>
                <span className={`font-mono text-[15px] tabular-nums text-right ${i === NS_MATH.rows.length - 2 ? 'font-bold text-peri-deep' : 'text-ink'}`}>{r.v}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft leading-[1.55] mt-4 max-w-[74ch]">{NS_MATH.footnote}</p>
        </div>
      </section>

      {/* ── 03 · How Mintware fits ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>{NS_SOLUTION.eyebrow}</div>
          <h2 className={h2}>{NS_SOLUTION.title} <span className="text-gradient-accent">{NS_SOLUTION.titleAccent}</span></h2>
          <p className={lead}>{NS_SOLUTION.lead}</p>
          <div className="grid grid-cols-2 gap-3 mt-8 max-[820px]:grid-cols-1">
            {NS_SOLUTION.cards.map((c) => (
              <div
                key={c.k}
                className="rounded-2xl bg-white border border-hair p-6"
                style={{ borderTop: `4px solid ${c.tone === 'coral' ? 'var(--color-coral2)' : 'var(--color-peri)'}` }}
              >
                <div className="font-atx-display text-[17px] font-medium text-ink">{c.k}</div>
                <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2.5">{c.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · The mechanics, honestly · dark pop ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className={`${wrap} py-[48px] max-[800px]:py-[36px]`}>
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 10% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
            <div className="grain absolute inset-0 opacity-40" aria-hidden />
            <div className="relative px-10 max-[800px]:px-6 py-[64px] max-[800px]:py-[48px]">
              <div className="flex items-baseline gap-3">
                <span className="text-[12px] uppercase tracking-[0.12em] font-semibold text-pas-peri">{NS_MECHANICS.eyebrow}</span>
              </div>
              <h2 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 text-white [text-wrap:balance]">
                {NS_MECHANICS.title} <span className="text-gradient-accent">{NS_MECHANICS.titleAccent}</span>
              </h2>
              <p className="text-[16px] leading-[1.55] text-white/70 max-w-[62ch] mt-4">{NS_MECHANICS.intro}</p>
              <div className="grid grid-cols-2 gap-3 mt-8 max-[760px]:grid-cols-1">
                {NS_MECHANICS.items.map(([k, d], i) => (
                  <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2">
                    <span className="text-[11px] text-pas-peri font-semibold tabular-nums">0{i + 1}</span>
                    <div className="font-atx-display text-[15px] font-medium leading-tight text-white">{k}</div>
                    <div className="text-[13px] text-white/65 leading-[1.5]">{d}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11.5px] text-white/45 leading-[1.55] mt-7 max-w-[76ch]">{NS_MECHANICS.note}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 05 · Why trust it ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${wrap} py-[72px] max-[800px]:py-[52px]`}>
          <div className={ey}>{NS_TRUST.eyebrow}</div>
          <h2 className={h2}>{NS_TRUST.title} <span className="text-gradient-accent">{NS_TRUST.titleAccent}</span></h2>
          <p className={lead}>{NS_TRUST.lead}</p>
          <div className="grid grid-cols-4 gap-3 mt-8 max-[720px]:grid-cols-2">
            {NS_TRUST.stats.map((m) => (
              <div key={m.label} className="rounded-2xl bg-white border border-hair shadow-card p-5">
                <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums text-ink">
                  {m.value}<span className="text-peri-deep text-[1.05rem]"> {m.sub}</span>
                </div>
                <div className="text-[12px] text-ink-mid mt-1.5 leading-[1.4]">{m.label}</div>
              </div>
            ))}
          </div>
          <div className="soft-card mt-6 overflow-hidden">
            {NS_TRUST.points.map(([k, d], i) => (
              <div key={k} className={`flex items-start gap-4 px-6 py-4 ${i < NS_TRUST.points.length - 1 ? 'border-b border-hair-soft' : ''}`}>
                <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
                  <div className="font-atx-display text-[15px] font-medium w-[190px] shrink-0 max-[640px]:w-auto text-ink">{k}</div>
                  <div className="text-[13px] text-ink-mid leading-[1.5]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href={NS_TRUST.proofCta.href} className="glass-pill glass-pill-primary">{NS_TRUST.proofCta.label}</Link>
            <Link href={NS_TRUST.mathCta.href} className="glass-pill">{NS_TRUST.mathCta.label}</Link>
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="coral" className="p-10 max-[800px]:p-6 flex items-center justify-between flex-wrap gap-5">
            <div className="font-atx-display font-medium text-ink text-[clamp(1.4rem,2.4vw,2rem)] tracking-[-0.02em] leading-[1.1] max-w-[30ch] [text-wrap:balance]">
              {NS_CTA.title}
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={NS_CTA.primary.href} target="_blank" rel="noopener noreferrer" className="glass-pill glass-pill-primary">{NS_CTA.primary.label}</a>
              <Link href={NS_CTA.secondary.href} className="glass-pill">{NS_CTA.secondary.label}</Link>
            </div>
          </GradientPanel>
          <p className="text-[10.5px] text-ink-soft leading-[1.6] mt-8 max-w-[92ch]">{NS_SOURCES}</p>
        </div>
      </section>
    </div>
  )
}
