import type { Metadata } from 'next'
import { Fragment, type ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { YieldCalculatorWidget } from '@/components/marketing/ypn/YieldCalculatorWidget'
import { CircleTechBadge } from '@/components/marketing/ypn/CircleTechBadge'
import { AppConversionCTA } from '@/components/marketing/ypn/AppConversionCTA'
import {
  YPN_STATUS,
  YPN_MODEL_HERO,
  YPN_ONE_IDEA,
  YPN_TWO_WAYS,
  YPN_RESERVE_FLOW,
  YPN_ROLES,
  YPN_SPLIT,
  YPN_SPENDABLE,
  YPN_SYNTHESIS,
  YPN_ECONOMICS,
} from '@/constants/ypn-landing'

// =============================================================================
// /yield-payment-network — PUBLIC marketing surface for the ULV × YPN model.
// Top-of-funnel only; NOT the authenticated app. Design v2 (Privy-esque).
//
// The rigorous two-sided model: a project/treasury locks a token reserve (junior
// / first-loss); the community pairs in single-sided USDC (senior / par-backed)
// that earns in Aave, provides JIT depth, and stays spendable. Honesty framing:
// COMING SOON / on Base Sepolia / deployed ≠ audited. Copy in constants/ypn-landing.ts.
// =============================================================================

export const metadata: Metadata = {
  title: 'Liquid Sovereign Account — Mintware',
  description:
    'Liquidity that earns, then gets spent. A project locks a token reserve; the community pairs in single-sided USDC that earns Aave yield, provides just-in-time depth, and stays spendable at Visa terminals — while the reserve absorbs the volatility. On Base Sepolia. Coming soon.',
}

// ── Section shell + header ──────────────────────────────────────────────────
function Section({ children, cool = false }: { children: ReactNode; cool?: boolean }) {
  return (
    <section className={`border-b border-hair-soft ${cool ? 'bg-ground-cool' : 'bg-white'}`}>
      <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[68px] max-[800px]:py-[48px]">
        {children}
      </div>
    </section>
  )
}

function Head({ n, label, title, accent }: { n: string; label: string; title: string; accent: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3.5">
        <span className="font-mono text-[14px] text-peri tabular-nums">{n}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">{label}</span>
      </div>
      <h2 className="font-atx-display font-medium text-ink tracking-[-0.025em] leading-[1.06] text-[clamp(1.45rem,3.4vw,2rem)] mt-2 [text-wrap:balance]">
        {title} <span className="text-ink-soft">{accent}</span>
      </h2>
    </div>
  )
}

const toneTint: Record<string, string> = {
  warm: 'bg-gradient-to-b from-coral2/10 to-transparent',
  cool: 'bg-gradient-to-b from-peri/[0.09] to-transparent',
  '': '',
}

export default function YieldPaymentNetworkPage() {
  // 60/30/10 donut arithmetic (circumference 100 via r = 15.915)
  let offset = 25
  const arcs = YPN_SPLIT.slices.map((s) => {
    const dash = `${s.pct} ${100 - s.pct}`
    const el = { dash, off: offset, color: s.color }
    offset -= s.pct
    return el
  })

  return (
    <div className="min-h-screen bg-white text-ink overflow-x-clip">
      <V2Nav active="ypn" />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 pt-8 pb-4 max-[800px]:pt-5">
        <GradientPanel tone="lavender" className="shadow-lift">
          <div className="px-10 py-12 max-[700px]:px-6 max-[700px]:py-9">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/60 backdrop-blur-[14px] border border-white/60 px-3 py-1.5 mb-5">
              <span className="w-[7px] h-[7px] rounded-full bg-coral2 shrink-0" />
              <span className="font-mono text-[11px] tracking-[0.04em] text-ink-mid">{YPN_STATUS.label} · payment core live on Base Sepolia</span>
            </div>
            <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-mid">{YPN_MODEL_HERO.eyebrow}</div>
            <h1 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.02] text-[clamp(2.1rem,6vw,3.75rem)] mt-3.5 [text-wrap:balance]">
              {YPN_MODEL_HERO.title}<br />
              <span className="text-ink-soft">{YPN_MODEL_HERO.titleAccent}</span>
            </h1>
            <p className="text-ink-mid text-[17px] leading-[1.6] mt-4 max-w-[56ch]">{YPN_MODEL_HERO.lede}</p>
            <div className="flex flex-wrap gap-2.5 mt-6">
              {YPN_MODEL_HERO.pills.map((p) => (
                <span key={p} className="font-mono text-[12px] text-ink-mid bg-white/55 backdrop-blur-[14px] border border-white/60 rounded-full px-3.5 py-2">{p}</span>
              ))}
            </div>
          </div>
        </GradientPanel>
      </div>

      {/* ── 01 · The one idea ───────────────────────────────────────────── */}
      <Section>
        <Head n={YPN_ONE_IDEA.n} label={YPN_ONE_IDEA.label} title={YPN_ONE_IDEA.title} accent={YPN_ONE_IDEA.titleAccent} />
        {YPN_ONE_IDEA.body.map((p, i) => (
          <p key={i} className="text-ink-mid text-[16.5px] leading-[1.62] max-w-[72ch] mt-3.5 first:mt-0">{p}</p>
        ))}
      </Section>

      {/* ── 02 · Two ways in ────────────────────────────────────────────── */}
      <Section cool>
        <Head n={YPN_TWO_WAYS.n} label={YPN_TWO_WAYS.label} title={YPN_TWO_WAYS.title} accent={YPN_TWO_WAYS.titleAccent} />
        <div className="grid grid-cols-2 max-[760px]:grid-cols-1 gap-4">
          {YPN_TWO_WAYS.cards.map((c) => (
            <div key={c.kicker} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6">
              <div className={`font-mono text-[11px] uppercase tracking-[0.1em] mb-2.5 ${c.tone === 'coral' ? 'text-coral2-deep' : 'text-peri-deep'}`}>{c.kicker}</div>
              <div className="font-atx-display font-semibold text-[17px] tracking-[-0.01em] text-ink mb-1.5">{c.title}</div>
              <p className="text-[14.5px] leading-[1.55] text-ink-mid">{c.body}</p>
              <span className="inline-block font-mono text-[11px] px-2.5 py-1 rounded-full mt-3.5" style={c.tone === 'coral' ? { background: 'var(--color-pas-peach)', color: 'var(--color-coral2-deep)' } : { background: 'var(--color-pas-lav)', color: 'var(--color-peri-deep)' }}>{c.tag}</span>
            </div>
          ))}
        </div>
        <p className="text-ink-mid text-[16px] leading-[1.6] max-w-[70ch] mt-5">{YPN_TWO_WAYS.footnote}</p>
      </Section>

      {/* ── 03 · How the reserve works ──────────────────────────────────── */}
      <Section>
        <Head n={YPN_RESERVE_FLOW.n} label={YPN_RESERVE_FLOW.label} title={YPN_RESERVE_FLOW.title} accent={YPN_RESERVE_FLOW.titleAccent} />
        <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-2.5 overflow-hidden">
          <div className="flex flex-wrap items-stretch">
            {YPN_RESERVE_FLOW.steps.map((s, i) => (
              <div key={s.n} className={`flex-1 min-w-[168px] p-5 relative ${toneTint[s.tone]} ${i > 0 ? 'border-l border-dashed border-hair max-[760px]:border-l-0 max-[760px]:border-t' : ''}`}>
                <div className="font-mono text-[11px] text-peri tracking-[0.08em]">{s.n}</div>
                <div className="font-atx-display font-semibold text-[15.5px] tracking-[-0.01em] text-ink mt-2 mb-1.5">{s.title}</div>
                <div className="text-[12.5px] text-ink-soft leading-[1.5]">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 04 · Who brings, earns, bears ───────────────────────────────── */}
      <Section cool>
        <Head n={YPN_ROLES.n} label={YPN_ROLES.label} title={YPN_ROLES.title} accent={YPN_ROLES.titleAccent} />
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hair bg-white shadow-card">
          <table className="w-full min-w-[680px] border-collapse text-[14px]">
            <thead>
              <tr>
                {YPN_ROLES.columns.map((c) => (
                  <th key={c} className="text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-soft bg-ground-cool px-4 py-3.5 border-b border-hair">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YPN_ROLES.rows.map((r) => (
                <tr key={r.role} className="align-top">
                  <td className="px-4 py-3.5 border-b border-hair last:border-0 whitespace-nowrap">
                    <span className="font-atx-display font-semibold text-[15px] text-ink">{r.role}</span>
                    <span className="block font-mono text-[10.5px] text-ink-soft mt-0.5">{r.sub}</span>
                  </td>
                  <td className="px-4 py-3.5 border-b border-hair text-ink-mid"><b className="text-ink font-semibold">{r.brings}</b></td>
                  <td className="px-4 py-3.5 border-b border-hair text-ink-mid">{r.earns}</td>
                  <td className="px-4 py-3.5 border-b border-hair text-ink-mid">{r.bears}</td>
                  <td className="px-4 py-3.5 border-b border-hair text-ink-mid">{r.liq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 05 · Where the value goes ───────────────────────────────────── */}
      <Section>
        <Head n={YPN_SPLIT.n} label={YPN_SPLIT.label} title={YPN_SPLIT.title} accent={YPN_SPLIT.titleAccent} />
        <div className="grid grid-cols-[auto_1fr] max-[640px]:grid-cols-1 gap-8 items-center rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-8 max-[640px]:text-center">
          <svg viewBox="0 0 42 42" className="w-[170px] h-[170px] shrink-0 max-[640px]:mx-auto" aria-label="60 percent LPs, 30 percent treasury, 10 percent buyback">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--color-ground-cool)" strokeWidth="6" />
            {arcs.map((a, i) => (
              <circle key={i} cx="21" cy="21" r="15.915" fill="none" stroke={a.color} strokeWidth="6" strokeDasharray={a.dash} strokeDashoffset={a.off} />
            ))}
            <text x="21" y="20.4" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontSize="6" fontWeight="600" fill="#17171F">60/30</text>
            <text x="21" y="25.6" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontSize="6" fontWeight="600" fill="#17171F">/10</text>
          </svg>
          <div className="flex flex-col gap-3.5 max-[640px]:text-left">
            {YPN_SPLIT.slices.map((s) => (
              <div key={s.name} className="flex gap-3 items-start">
                <span className="w-[13px] h-[13px] rounded-[4px] shrink-0 mt-1" style={{ background: s.color }} />
                <div>
                  <div className="font-atx-display font-semibold text-[16px] text-ink">{s.name}<span className="font-mono text-ink-soft font-normal text-[13px] ml-1.5">{s.pct}%</span></div>
                  <div className="text-[13px] text-ink-soft leading-[1.5] mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── The spendable layer · dark pop pill ─────────────────────────── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1080px] px-6 max-[800px]:px-4 py-[40px]">
          <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 88% 0%, rgba(108,108,240,0.55), transparent 55%), radial-gradient(50% 110% at 6% 100%, rgba(244,161,131,0.35), transparent 55%)' }} />
            <div aria-hidden className="grain pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative px-10 py-11 max-[700px]:px-6 max-[700px]:py-8">
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-pas-peri">{YPN_SPENDABLE.eyebrow}</div>
              <h2 className="font-atx-display font-medium text-white tracking-[-0.025em] leading-[1.1] text-[clamp(1.4rem,3.2vw,1.9rem)] mt-3 [text-wrap:balance]">
                {YPN_SPENDABLE.title} <span className="text-pas-peri">{YPN_SPENDABLE.titleAccent}</span>
              </h2>
              <p className="text-[15px] leading-[1.6] mt-3.5 max-w-[60ch]" style={{ color: '#C7C7DC' }}>{YPN_SPENDABLE.body}</p>
              <div className="flex flex-wrap mt-6 border-t border-white/15">
                {YPN_SPENDABLE.steps.map((s, i) => (
                  <div key={s.n} className={`flex-1 min-w-[150px] py-4 pr-4 ${i > 0 ? 'pl-[18px] border-l border-white/12 max-[560px]:border-l-0 max-[560px]:pl-0' : ''}`}>
                    <div className="font-mono text-[11px] text-pas-peri">{s.n}</div>
                    <div className="font-atx-display font-semibold text-[15px] text-white mt-1.5 mb-1">{s.title}</div>
                    <div className="text-[12.5px] leading-[1.5]" style={{ color: '#B9B9D0' }}>{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 06 · What we already hold (synthesis) ───────────────────────── */}
      <Section cool>
        <Head n={YPN_SYNTHESIS.n} label={YPN_SYNTHESIS.label} title={YPN_SYNTHESIS.title} accent={YPN_SYNTHESIS.titleAccent} />
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] max-[760px]:grid-cols-1 gap-3 items-center">
          {YPN_SYNTHESIS.parts.map((p, i) => (
            <Fragment key={p.title}>
              <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5 h-full">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-peri-deep">{p.kicker}</div>
                <div className="font-atx-display font-semibold text-[15px] tracking-[-0.01em] text-ink mt-1.5 mb-1.5">{p.title}</div>
                <div className="text-[12.5px] text-ink-soft leading-[1.5]">{p.desc}</div>
                <span className={`inline-block font-mono text-[10px] px-2 py-0.5 rounded-full mt-2.5 ${p.live ? 'text-[#2E9E6B]' : 'text-peri-deep'}`} style={{ background: p.live ? '#E3F5EC' : 'var(--color-pas-lav)' }}>{p.status}</span>
              </div>
              {i < YPN_SYNTHESIS.parts.length - 1 && (
                <span className="font-atx-display text-[22px] text-peri text-center max-[760px]:py-1">×</span>
              )}
            </Fragment>
          ))}
        </div>
        <p className="text-ink-mid text-[16px] leading-[1.6] max-w-[74ch] mt-5">{YPN_SYNTHESIS.footnote}</p>
      </Section>

      {/* ── Interactive: what your USDC could earn ──────────────────────── */}
      <YieldCalculatorWidget />

      {/* ── 07 · Economics — locked ─────────────────────────────────────── */}
      <Section cool>
        <Head n={YPN_ECONOMICS.n} label={YPN_ECONOMICS.label} title={YPN_ECONOMICS.title} accent={YPN_ECONOMICS.titleAccent} />
        <ol className="grid gap-3.5 list-none p-0 m-0">
          {YPN_ECONOMICS.decisions.map((d, i) => (
            <li key={i} className="rounded-[var(--radius-card)] border border-hair border-l-[3px] border-l-coral2 bg-white shadow-card p-5 flex gap-4">
              <span className="font-atx-display font-semibold text-[20px] text-peri leading-[1.2] shrink-0">{i + 1}</span>
              <div>
                <div className="font-atx-display font-semibold text-[16px] tracking-[-0.01em] text-ink">{d.title}</div>
                <p className="text-[14px] text-ink-mid leading-[1.55] mt-1">{d.body}</p>
                <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[#2E9E6B] bg-[#E3F5EC] rounded-full px-2.5 py-1 mt-2">
                  <span className="w-[7px] h-[7px] rounded-full bg-[#2E9E6B]" />{d.chip}
                </span>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-ink-mid text-[16px] leading-[1.6] max-w-[74ch] mt-5">{YPN_ECONOMICS.footnote}</p>
      </Section>

      {/* ── Settlement rails + coming-soon waitlist ─────────────────────── */}
      <CircleTechBadge />
      <AppConversionCTA />
    </div>
  )
}
