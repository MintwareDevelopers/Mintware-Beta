// TeamKit — the Mineral building blocks for the Team workspace (/app/team/* previews and the real
// /app/org/* treasury), so every screen there opens the same way: back link, icon tile + title + status
// chip, one framing line, then raised cards for things you act on and inset wells for inputs.

import Link from 'next/link'
import type { ReactNode } from 'react'

/** Inset input/select/textarea — the Mineral "place you put something". */
export const FIELD =
  'w-full min-h-[46px] rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] px-3.5 text-[15px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6]'

export type Status = 'live' | 'building' | 'planned' | 'preview' | 'warn' | 'bad' | 'muted'

// Status chips are plain fills (the dotted/hatched textures read as noise behind text); the textures stay on
// non-text fills like allocation bars.
const CHIP: Record<Status, { cls: string; bg?: string; dot?: string }> = {
  live: { cls: 'bg-[#E3F4EA] text-[#0F7A43]', dot: '#22A45D' },
  building: { cls: 'text-[#4B2FA0]', bg: '#EDE9FB' },
  preview: { cls: 'text-[#4B2FA0]', bg: '#EDE9FB' },
  planned: { cls: 'text-ink-mid', bg: '#F2F2F5' },
  warn: { cls: 'bg-[#FDF1DE] text-[#8A5300]' },
  bad: { cls: 'bg-[#FBE9E7] text-[#B42318]' },
  muted: { cls: 'text-ink-mid', bg: '#EEEEF4' },
}

export function StatusChip({ tone, children, className = '' }: { tone: Status; children: ReactNode; className?: string }) {
  const c = CHIP[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap ${c.cls} ${className}`} style={c.bg ? { backgroundColor: c.bg } : undefined}>
      {c.dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} aria-hidden />}
      {children}
    </span>
  )
}

/** An icon on a tinted, recessed tile (the landing's feature-icon treatment). */
export function IconTile({ children, size = 44 }: { children: ReactNode; size?: number }) {
  return (
    <span className="flex-none rounded-[12px] grid place-items-center" style={{ width: size, height: size, color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>
      {children}
    </span>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-mid no-underline hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      {children}
    </Link>
  )
}

/** Page header: icon tile, title, optional status chip, one framing line, actions on the right. */
export function PageHead({ icon, title, status, lede, actions, back }: {
  icon?: ReactNode; title: ReactNode; status?: { tone: Status; label: ReactNode }; lede?: ReactNode; actions?: ReactNode; back?: { href: string; label: ReactNode }
}) {
  return (
    <div>
      {back && <div className="mb-4"><BackLink href={back.href}>{back.label}</BackLink></div>}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          {icon && <span className="max-[520px]:hidden"><IconTile size={48}>{icon}</IconTile></span>}
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="m-0 font-semibold text-[clamp(26px,3.2vw,34px)] tracking-[-0.035em] leading-[1.1] text-ink">{title}</h1>
              {status && <StatusChip tone={status.tone}>{status.label}</StatusChip>}
            </div>
            {lede && <p className="m-0 mt-2 text-[15px] leading-[1.55] text-ink-mid max-w-[64ch]">{lede}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

/** Section label above a card or list. */
export function SLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mt-9 mb-3">
      <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">{children}</div>
      {right}
    </div>
  )
}

/** A KPI tile: label, a Geist Mono figure, a short sub-line. */
export function Kpi({ k, v, s }: { k: ReactNode; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="mw-raise-sm rounded-[18px] p-4">
      <div className="text-[12.5px] text-ink-soft">{k}</div>
      <div className="font-geist-mono text-[24px] tracking-[-0.03em] text-ink mt-1.5">{v}</div>
      {s && <div className="text-[12px] text-ink-soft mt-0.5">{s}</div>}
    </div>
  )
}

export function KpiRow({ items }: { items: { k: ReactNode; v: ReactNode; s?: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-4 max-[880px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-6">
      {items.map((x, i) => <Kpi key={i} {...x} />)}
    </div>
  )
}

/** A raised card with an optional title row. */
export function Panel({ title, right, children, className = '', pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <div className={`mw-raise rounded-[22px] overflow-hidden ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <span className="font-semibold text-[15px] text-ink">{title}</span>
          {right}
        </div>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </div>
  )
}

/** Small footnote under a page. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-ink-soft mt-6 max-w-[80ch] leading-[1.5]">{children}</p>
}

// ── Local disc-style icons for the treasury area (24px grid, 1.7 stroke, currentColor) ──────────────
function I({ size = 22, children }: { size?: number; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
}
/** Treasury: a disc stack in a vault frame. */
export const IconVault = ({ size }: { size?: number }) => <I size={size}><rect x="3" y="4" width="18" height="16" rx="3.5" /><ellipse cx="12" cy="10" rx="5" ry="2" /><path d="M7 10v3c0 1.1 2.2 2 5 2s5-.9 5-2v-3" /></I>
/** Pay: a disc sliding out along an arrow. */
export const IconSend = ({ size }: { size?: number }) => <I size={size}><ellipse cx="8" cy="12" rx="4.5" ry="2" /><path d="M3.5 12v2c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-2" /><path d="M14 12h7M18 9l3 3-3 3" /></I>
/** Payroll: three small stacks in a row. */
export const IconBatch = ({ size }: { size?: number }) => <I size={size}><ellipse cx="5" cy="15" rx="2.6" ry="1.2" /><ellipse cx="12" cy="12" rx="2.6" ry="1.2" /><ellipse cx="19" cy="9" rx="2.6" ry="1.2" /><path d="M2.4 15v2c0 .7 1.2 1.2 2.6 1.2s2.6-.5 2.6-1.2v-2M9.4 12v5c0 .7 1.2 1.2 2.6 1.2s2.6-.5 2.6-1.2v-5M16.4 9v8c0 .7 1.2 1.2 2.6 1.2s2.6-.5 2.6-1.2V9" /></I>
/** Activity: a ledger with a rising line. */
export const IconLedger = ({ size }: { size?: number }) => <I size={size}><rect x="4" y="3.5" width="16" height="17" rx="3" /><path d="M8 8h8M8 12h5M8 16h3" /><path d="m13.5 16.5 2-2 1.5 1.2" /></I>
/** Members: two people drawn as discs. */
export const IconPeople = ({ size }: { size?: number }) => <I size={size}><circle cx="8.5" cy="8" r="3" /><path d="M3 19c.6-3 2.8-4.8 5.5-4.8S13.4 16 14 19" /><circle cx="16.5" cy="9" r="2.5" /><path d="M15.4 14.4c.4-.1.7-.2 1.1-.2 2.3 0 4.2 1.6 4.5 4.3" /></I>
/** Control: a shield with a key notch. */
export const IconShield = ({ size }: { size?: number }) => <I size={size}><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8 7.5 9.5 4.4-1.5 7.5-5.1 7.5-9.5V6z" /><circle cx="12" cy="11" r="2" /><path d="M12 13v3" /></I>
/** Card: a card with a disc chip. */
export const IconCard = ({ size }: { size?: number }) => <I size={size}><rect x="2.5" y="5" width="19" height="14" rx="3" /><ellipse cx="7.5" cy="10" rx="2.2" ry="1.2" /><path d="M5.3 10v1.2c0 .6 1 1.2 2.2 1.2s2.2-.6 2.2-1.2V10M14 15h4" /></I>
/** Yield: a disc stack with a small rising arrow. */
export const IconGrow = ({ size }: { size?: number }) => <I size={size}><ellipse cx="9" cy="17" rx="6" ry="2.2" /><path d="M3 17v1.8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V17" /><ellipse cx="9" cy="12.6" rx="6" ry="2.2" opacity=".55" /><path d="M14.5 9.5 18 6l3 3M18 6v8" /></I>
/** Swap: two discs trading places. */
export const IconSwap = ({ size }: { size?: number }) => <I size={size}><ellipse cx="7" cy="7.5" rx="4.5" ry="2" /><path d="M2.5 7.5v2.5c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V7.5" /><ellipse cx="17" cy="15.5" rx="4.5" ry="2" /><path d="M12.5 15.5V18c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-2.5" /><path d="M14 5.5h4.5V10M10 18.5H5.5V14" /></I>
/** Developers: angle brackets around a disc. */
export const IconCode = ({ size }: { size?: number }) => <I size={size}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /><ellipse cx="12" cy="12" rx="2.6" ry="1.2" /></I>
/** Allocation: a disc split into slices. */
export const IconPie = ({ size }: { size?: number }) => <I size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6M12 12H3.5" /></I>
/** Org: a building of stacked discs. */
export const IconOrg = ({ size }: { size?: number }) => <I size={size}><path d="M4 20h16M6 20V9l6-4 6 4v11" /><path d="M10 20v-4h4v4M9.5 11h5" /></I>
