import type { ReactNode } from 'react'

// Page header for a V1 platform lane: eyebrow, two-tone title, lede, and an optional "Simulated" chip for
// screens that show illustrative data rather than live chain state.
export function LaneHeader({ eyebrow, title, accent, lede, simulated, actions }: {
  eyebrow: string; title: string; accent: string; lede: ReactNode; simulated?: boolean; actions?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap">
      <div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#4643D1' }}>{eyebrow}</span>
          {simulated && (
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: '#62626F', background: 'rgba(22,22,44,0.05)' }}>
              Simulated
            </span>
          )}
        </div>
        <h1 className="font-geist font-semibold tracking-[-0.04em] leading-[1.04] text-[clamp(2rem,4vw,3rem)] mt-2.5 max-w-[24ch]">
          {title}{' '}
          <span style={{ color: '#62626F' }}>{accent}</span>
        </h1>
        <p className="text-[15.5px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#454552' }}>{lede}</p>
      </div>
      {actions && <div className="flex gap-2.5 flex-wrap">{actions}</div>}
    </div>
  )
}

/** A raised white panel — the default V1 surface (Mineral). */
export const PLAIN = { background: '#FFFFFF', boxShadow: 'var(--mw-raise)' }

/** A pressed-in well — inputs and stats that sit inside a raised card. */
export const INSET = { background: '#F6F6FA', boxShadow: 'var(--mw-inset)' }

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[12px] font-medium" style={{ color: '#62626F' }}>{children}</div>
}
