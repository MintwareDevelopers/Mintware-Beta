import type { ReactNode } from 'react'
import { GradientPanel, type PanelTone } from '@/components/ui2/GradientPanel'

// Shared building blocks for the long-form marketing pages, in the v2 (Privy-esque) system:
// two-tone grotesque headlines, mesh-gradient panels, soft/glass cards, glass-pill buttons.
export const wrap = 'mx-auto max-w-[1160px] px-6 max-[800px]:px-4'
export const body = 'text-ink-mid text-[16.5px] leading-[1.7] max-w-[62ch]'
const display = 'font-atx-display tracking-[-0.04em] leading-[1.02]'

/** Headline with an optional grey trailing phrase (the system's two-tone heading). */
function TwoTone({ main, soft }: { main: ReactNode; soft?: ReactNode }) {
  return <>{main}{soft && <> <span className="text-ink-soft">{soft}</span></>}</>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="inline-flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.16em] text-peri-deep"><span className="w-1.5 h-1.5 rounded-full bg-peri" />{children}</p>
}

export function H2({ children, soft }: { children: ReactNode; soft?: ReactNode }) {
  return <h2 className={`${display} font-medium text-ink text-[clamp(2rem,4.4vw,3.3rem)] max-w-[20ch] mt-4`}><TwoTone main={children} soft={soft} /></h2>
}

export function P({ children }: { children: ReactNode }) {
  return <p className={`${body} mt-5`}>{children}</p>
}

export function Section({ id, tint, children }: { id?: string; tint?: boolean; children: ReactNode }) {
  return <section id={id} className={`${tint ? 'bg-ground-cool' : 'bg-white'} scroll-mt-20`}><div className={`${wrap} py-24 max-[800px]:py-16`}>{children}</div></section>
}

/** Page hero: copy on the left, an elevated gradient panel on the right. */
export function Hero({ eyebrow, title, soft, lede, actions, aside, tone = 'periwinkle' }: {
  eyebrow: ReactNode; title: ReactNode; soft?: ReactNode; lede: ReactNode; actions?: ReactNode; aside: ReactNode; tone?: PanelTone
}) {
  return <section className="bg-white">
    <div className={`${wrap} pt-16 pb-24 max-[800px]:pt-10 max-[800px]:pb-16 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center`}>
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className={`${display} font-medium text-[clamp(2.8rem,6.4vw,5.2rem)] max-w-[14ch] mt-5`}><TwoTone main={title} soft={soft} /></h1>
        <p className={`${body} mt-7`}>{lede}</p>
        {actions && <div className="flex flex-wrap gap-3 mt-9">{actions}</div>}
      </div>
      <GradientPanel tone={tone} className="p-8 max-[800px]:p-5 min-h-[440px] flex items-center justify-center">
        <div className="w-full flex justify-center">{aside}</div>
      </GradientPanel>
    </div>
  </section>
}

/** A frosted card for hero asides: a title and a short list of outcomes. */
export function GlassList({ title, items }: { title: string; items: string[] }) {
  return <div className="glass-card p-7 max-w-[420px] w-full">
    <div className="text-[13px] font-semibold text-ink">{title}</div>
    <ul className="mt-5 space-y-3.5">
      {items.map(x => <li key={x} className="flex gap-3 text-[15px] leading-[1.45] text-ink"><span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-peri-deep shrink-0" />{x}</li>)}
    </ul>
  </div>
}

/** Outcome cards: the main "what you get" grid. */
export function Rows({ items }: { items: [string, string][] }) {
  const cols = items.length % 3 === 0 ? 'md:grid-cols-3' : 'md:grid-cols-2'
  return <div className={`grid ${cols} gap-5 mt-12`}>
    {items.map(([t, d]) => <div key={t} className="soft-card p-8 flex flex-col">
      <h3 className={`${display} font-medium text-[clamp(1.35rem,2.2vw,1.65rem)] tracking-[-0.025em] leading-[1.15]`}>{t}</h3>
      <p className="text-[15px] text-ink-mid leading-[1.65] mt-4">{d}</p>
    </div>)}
  </div>
}

/** Numbered step cards with gradient numerals. */
export function Steps({ items }: { items: [string, string][] }) {
  return <div className={`grid gap-5 mt-12 ${items.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
    {items.map(([t, d], i) => <div key={t} className="soft-card p-8">
      <span className={`${display} font-medium text-[56px] leading-none bg-clip-text text-transparent`} style={{ backgroundImage: 'linear-gradient(135deg, var(--color-peri-deep), var(--color-coral2))' }}>{i + 1}</span>
      <h3 className="font-semibold text-[18px] mt-6">{t}</h3>
      <p className="text-[14.5px] text-ink-mid leading-[1.6] mt-2">{d}</p>
    </div>)}
  </div>
}

/** Big numbers on a gradient panel. */
export function Stats({ items, tone = 'periwinkle' }: { items: [string, string][]; tone?: PanelTone }) {
  return <GradientPanel tone={tone} className="p-6 max-[800px]:p-4 mt-12">
    <div className="grid md:grid-cols-4 gap-4">
      {items.map(([n, t]) => <div key={n} className="glass-card p-6">
        <div className={`${display} font-medium text-[clamp(2.2rem,4vw,3.2rem)]`}>{n}</div>
        <p className="text-[14px] text-ink-mid leading-[1.55] mt-3">{t}</p>
      </div>)}
    </div>
  </GradientPanel>
}

/** A key line, set large on a soft gradient band. */
export function Kicker({ children, tone = 'lavender' }: { children: ReactNode; tone?: PanelTone }) {
  return <GradientPanel tone={tone} className="px-10 py-14 max-[800px]:px-6 max-[800px]:py-10 mt-14">
    <p className={`${display} font-medium text-[clamp(1.6rem,3.4vw,2.6rem)] max-w-[26ch]`}>{children}</p>
  </GradientPanel>
}

/** Closing call to action on a gradient panel. */
export function CTA({ title, soft, children, tone = 'balanced' }: { title: ReactNode; soft?: ReactNode; children: ReactNode; tone?: PanelTone }) {
  return <section className="bg-white"><div className={`${wrap} py-24 max-[800px]:py-16`}>
    <GradientPanel tone={tone} className="px-12 py-20 max-[800px]:px-6 max-[800px]:py-12 text-center">
      <h2 className={`${display} font-medium text-[clamp(2.2rem,5vw,4rem)] max-w-[18ch] mx-auto`}><TwoTone main={title} soft={soft} /></h2>
      <div className="flex flex-wrap justify-center gap-3 mt-10">{children}</div>
    </GradientPanel>
  </div></section>
}
