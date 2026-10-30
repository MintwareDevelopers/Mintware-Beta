import { Fragment } from 'react'

// FlowDiagram — a row of raised step cards joined by arrows (Mineral). Wraps to a single column on
// narrow screens, where the arrows turn downward.

export interface FlowStep {
  label: string
  sub?: string
  n?: string
}

function Arrow({ down }: { down?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {down ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  )
}

export function FlowDiagram({ steps, className = '' }: { steps: FlowStep[]; className?: string }) {
  return (
    <div className={`flex items-stretch max-[860px]:flex-col ${className}`}>
      {steps.map((s, i) => (
        <Fragment key={i}>
          <div className="mw-raise-sm flex-1 rounded-2xl px-5 py-[18px] min-w-0">
            <div className="font-geist-mono text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>{s.n ?? String(i + 1).padStart(2, '0')}</div>
            <div className="font-semibold text-[15px] tracking-[-0.01em] leading-[1.25] mt-1.5" style={{ color: 'var(--mw-ink)' }}>{s.label}</div>
            {s.sub && <div className="text-[13px] leading-[1.45] mt-1" style={{ color: 'var(--mw-ink-3)' }}>{s.sub}</div>}
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center px-2 shrink-0 max-[860px]:py-1.5" style={{ color: 'var(--mw-ink-3)' }}>
              <span className="max-[860px]:hidden"><Arrow /></span>
              <span className="hidden max-[860px]:inline"><Arrow down /></span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
