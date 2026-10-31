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
          <span className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#5A57DE' }}>{eyebrow}</span>
          {simulated && (
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: '#8A8A9E', background: 'rgba(22,22,44,0.05)' }}>
              Simulated
            </span>
          )}
        </div>
        <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[26ch]">
          {title}{' '}
          <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{accent}</span>
        </h1>
        <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#494957' }}>{lede}</p>
      </div>
      {actions && <div className="flex gap-2.5 flex-wrap">{actions}</div>}
    </div>
  )
}

/** A plain white panel — the default V1 surface. */
export const PLAIN = { background: '#FFFFFF', border: '1px solid rgba(22,22,44,0.08)', boxShadow: '0 1px 2px rgba(20,20,50,0.04), 0 8px 24px -12px rgba(30,30,80,0.10)' }

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#8A8A9E' }}>{children}</div>
}
