import type { ReactNode } from 'react'
import { GradientPanel, type PanelTone } from '@/components/ui2/GradientPanel'

// Shared building blocks for the long-form marketing pages, in Mineral (the landing's system): porcelain
// ground, raised white cards for things you read or act on, inset wells for stages, solid periwinkle
// buttons, two-tone semibold headlines, the pastel sheen only as soft light.
export const wrap = 'mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)]'
export const body = 'text-[17px] leading-[1.6] max-w-[62ch] text-ink-mid'
const display = 'font-semibold tracking-[-0.04em] leading-[1.04]'

/** Headline with an optional muted trailing phrase (the system's two-tone heading). */
function TwoTone({ main, soft }: { main: ReactNode; soft?: ReactNode }) {
  return <>{main}{soft && <> <span className="text-ink-soft">{soft}</span></>}</>
}

/** The page shell every marketing page sits in: porcelain ground, Geist, no sideways scroll. */
export function Page({ children }: { children: ReactNode }) {
  return <main className="font-geist min-h-screen overflow-x-hidden antialiased text-ink" style={{ background: 'var(--mw-ground)' }}>{children}</main>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>{children}</p>
}

export function H2({ children, soft }: { children: ReactNode; soft?: ReactNode }) {
  return <h2 className={`${display} text-ink text-[clamp(34px,4.4vw,54px)] max-w-[20ch] mt-3`}><TwoTone main={children} soft={soft} /></h2>
}

/** The landing's section header: eyebrow + headline on the left, a short framing paragraph on the right. */
export function SectionHead({ eyebrow, title, soft, aside }: { eyebrow: ReactNode; title: ReactNode; soft?: ReactNode; aside?: ReactNode }) {
  return <div className="flex flex-wrap justify-between items-end gap-6">
    <div className="max-w-[640px]"><Eyebrow>{eyebrow}</Eyebrow><H2 soft={soft}>{title}</H2></div>
    {aside && <p className="m-0 max-w-[420px] text-[17px] leading-[1.55] text-ink-mid">{aside}</p>}
  </div>
}

/** Small arrow used in links and flows. */
export function Arrow({ size = 18, down }: { size?: number; down?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{down ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}</svg>
}

export function P({ children }: { children: ReactNode }) {
  return <p className={`${body} mt-5`}>{children}</p>
}

/** A page band. `tint` gives the white band with hairlines that alternates with the porcelain ground. */
export function Section({ id, tint, children }: { id?: string; tint?: boolean; children: ReactNode }) {
  return <section id={id} className="scroll-mt-20" style={tint ? { background: '#fff', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' } : undefined}>
    <div className={`${wrap} py-[clamp(64px,8vw,120px)]`}>{children}</div>
  </section>
}

/** Soft concentric rings and a halo of sheen behind a hero object — the landing hero's backdrop. */
function Halo() {
  return <svg aria-hidden="true" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-x-0 -top-10 w-full h-[900px] pointer-events-none">
    <defs><radialGradient id="story-halo" cx="72%" cy="52%" r="40%"><stop offset="0" stopColor="#C9C0F4" stopOpacity=".55" /><stop offset=".55" stopColor="#F2CBC2" stopOpacity=".18" /><stop offset="1" stopColor="#F6F6FA" stopOpacity="0" /></radialGradient></defs>
    <rect width="1400" height="900" fill="url(#story-halo)" />
    <g fill="none" stroke="#5B5BE6" strokeOpacity="0.07">
      {[[160, 48], [260, 80], [370, 114], [490, 152], [620, 192], [760, 236], [910, 282]].map(([rx, ry]) => <ellipse key={rx} cx="1000" cy="560" rx={rx} ry={ry} />)}
    </g>
  </svg>
}

/** Page hero: copy on the left, a raised object on soft light to the right. */
export function Hero({ eyebrow, title, soft, lede, actions, aside }: {
  eyebrow: ReactNode; title: ReactNode; soft?: ReactNode; lede: ReactNode; actions?: ReactNode; aside: ReactNode; tone?: PanelTone
}) {
  return <section className="relative">
    <Halo />
    <div className={`${wrap} relative pt-[clamp(40px,6vw,88px)] pb-[clamp(56px,7vw,104px)] flex flex-wrap items-center gap-12`}>
      <div className="flex-[1_1_460px] min-w-0">
        <div className="mw-raise-sm inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-[13px] text-ink-mid">
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--mw-btn)', boxShadow: '0 0 0 4px rgba(91,91,230,.15)' }} />
          {eyebrow}
        </div>
        <h1 className="m-0 mt-6 font-semibold text-[clamp(46px,6.6vw,84px)] leading-[0.98] tracking-[-0.05em] max-w-[14ch]"><TwoTone main={title} soft={soft} /></h1>
        <p className="mt-6 mb-0 max-w-[520px] text-[clamp(17px,1.6vw,20px)] leading-[1.55] text-ink-mid">{lede}</p>
        {actions && <div className="flex flex-wrap gap-3 mt-8">{actions}</div>}
      </div>
      <div className="flex-[1_1_420px] min-w-0 flex justify-center">{aside}</div>
    </div>
  </section>
}

/** A raised card for hero asides: a title and a short checked list of outcomes. */
export function GlassList({ title, items }: { title: string; items: string[] }) {
  return <div className="mw-raise-lg rounded-[26px] p-7 max-w-[440px] w-full">
    <div className="text-[14px] font-semibold">{title}</div>
    <ul className="mt-5 p-0 list-none flex flex-col gap-3">
      {items.map(x => <li key={x} className="flex items-center gap-3 rounded-[14px] px-4 py-3 text-[15px] leading-[1.4]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F7A43" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="m5 12 4 4 10-10" /></svg>{x}
      </li>)}
    </ul>
  </div>
}

/** An icon on a tinted, recessed tile — the landing's feature-icon treatment. */
export function IconTile({ children }: { children: ReactNode }) {
  return <span className="flex-none w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{children}</span>
}

/** Outcome cards: the main "what you get" grid. An optional third element is the card's icon. */
export function Rows({ items }: { items: [string, string, ReactNode?][] }) {
  const cols = items.length % 3 === 0 ? 'md:grid-cols-3' : 'md:grid-cols-2'
  return <div className={`grid ${cols} gap-5 mt-12`}>
    {items.map(([t, d, icon]) => <div key={t} className="mw-raise mw-lift rounded-[24px] p-8 flex flex-col">
      {icon && <div className="mb-6"><IconTile>{icon}</IconTile></div>}
      <h3 className="m-0 text-[22px] font-semibold tracking-[-0.02em] leading-[1.2]">{t}</h3>
      <p className="text-[15px] text-ink-mid leading-[1.6] mt-3 mb-0">{d}</p>
    </div>)}
  </div>
}

/** Numbered step cards. */
export function Steps({ items }: { items: [string, string][] }) {
  return <div className={`grid gap-5 mt-12 ${items.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
    {items.map(([t, d], i) => <div key={t} className="mw-raise rounded-[24px] p-8">
      <span className="w-9 h-9 rounded-full grid place-items-center text-[15px] font-semibold text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>{i + 1}</span>
      <h3 className="font-semibold text-[18px] mt-6 mb-0">{t}</h3>
      <p className="text-[15px] text-ink-mid leading-[1.6] mt-2 mb-0">{d}</p>
    </div>)}
  </div>
}

/** Big numbers: raised tiles sitting in a lit well. */
export function Stats({ items, tone = 'periwinkle' }: { items: [string, string][]; tone?: PanelTone }) {
  return <GradientPanel tone={tone} className="p-[clamp(16px,2.4vw,28px)] mt-12">
    <div className="grid md:grid-cols-4 gap-4">
      {items.map(([n, t]) => <div key={n} className="mw-raise-sm rounded-[20px] p-6">
        <div className="font-geist-mono text-[clamp(30px,3.4vw,42px)] tracking-[-0.03em]">{n}</div>
        <p className="text-[14px] text-ink-mid leading-[1.55] mt-3 mb-0">{t}</p>
      </div>)}
    </div>
  </GradientPanel>
}

/** A key line, set large on a raised card with a patch of soft light. */
export function Kicker({ children }: { children: ReactNode; tone?: PanelTone }) {
  return <div className="mw-raise-lg relative overflow-hidden rounded-[28px] px-[clamp(24px,4vw,56px)] py-[clamp(36px,5vw,64px)] mt-14">
    <div aria-hidden="true" className="absolute -right-[120px] -top-[140px] w-[420px] h-[420px] rounded-full opacity-30 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
    <p className={`relative m-0 ${display} text-[clamp(26px,3.4vw,40px)] max-w-[28ch]`}>{children}</p>
  </div>
}

/** Closing call to action: the landing's raised CTA card. */
export function CTA({ title, soft, children }: { title: ReactNode; soft?: ReactNode; children: ReactNode; tone?: PanelTone }) {
  return <section className="px-[clamp(16px,4vw,40px)] py-[clamp(56px,7vw,96px)]">
    <div className="mw-raise-lg mx-auto max-w-[1200px] relative overflow-hidden rounded-[28px] px-[clamp(24px,5vw,64px)] py-[clamp(40px,6vw,80px)] text-center">
      <div aria-hidden="true" className="absolute -right-[120px] -top-[120px] w-[420px] h-[420px] rounded-full opacity-35 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
      <div aria-hidden="true" className="absolute -left-[140px] -bottom-[160px] w-[380px] h-[380px] rounded-full opacity-25 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
      <h2 className={`relative m-0 ${display} text-[clamp(34px,4.6vw,58px)] max-w-[18ch] mx-auto`}><TwoTone main={title} soft={soft} /></h2>
      <div className="relative flex flex-wrap justify-center gap-3 mt-10">{children}</div>
    </div>
  </section>
}
