import type { ReactNode } from 'react'

// Shared building blocks for the long-form marketing pages (Home, Markets, Issuers, Earn).
export const wrap = 'mx-auto max-w-[1080px] px-6 max-[800px]:px-4'
export const body = 'text-ink-mid text-[16px] leading-[1.7] max-w-[68ch]'

export function Section({ id, tint, children }: { id?: string; tint?: boolean; children: ReactNode }) {
  return <section id={id} className={`${tint ? 'bg-ground-cool' : ''} border-b border-hair-soft scroll-mt-20`}><div className={`${wrap} py-20 max-[800px]:py-14`}>{children}</div></section>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-peri-deep">{children}</p>
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="font-atx-display font-semibold tracking-[-0.045em] leading-[1.02] text-[clamp(2.5rem,6vw,4.4rem)] max-w-[15ch] mt-4">{children}</h1>
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4.2vw,2.9rem)] max-w-[22ch] mt-4">{children}</h2>
}

export function P({ children }: { children: ReactNode }) {
  return <p className={`${body} mt-5`}>{children}</p>
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="font-atx-display font-semibold text-[clamp(1.2rem,2.4vw,1.6rem)] tracking-[-0.015em] leading-[1.3] mt-10 max-w-[42ch]">{children}</p>
}

/** Numbered cards, e.g. the steps of a flow. */
export function Steps({ items }: { items: [string, string][] }) {
  return <div className={`grid gap-6 mt-10 ${items.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
    {items.map(([t, d], i) => <div key={t} className="rounded-[var(--radius-card)] border border-hair bg-white p-6"><span className="font-mono text-[13px] text-peri-deep">0{i + 1}</span><h3 className="font-semibold text-[17px] mt-2">{t}</h3><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{d}</p></div>)}
  </div>
}

/** Title-left, text-right rows for the denser arguments. */
export function Rows({ items }: { items: [string, string][] }) {
  return <div className="mt-8 divide-y divide-hair-soft">
    {items.map(([t, d]) => <div key={t} className="py-6 grid md:grid-cols-[1fr_1.5fr] gap-4"><h3 className="font-semibold text-[17px] leading-[1.35]">{t}</h3><p className="text-[15px] text-ink-mid leading-[1.7]">{d}</p></div>)}
  </div>
}
