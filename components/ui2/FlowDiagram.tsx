import { Fragment } from 'react'

// FlowDiagram — Aave-style horizontal flow: glass nodes joined by animated
// marching-dash connectors with an arrowhead. Collapses to a vertical stack on
// mobile. Pure CSS animation (reduced-motion safe via .flow-dash-*). Design v2.

export interface FlowStep {
  label: string
  sub?: string
  n?: string
}

export function FlowDiagram({ steps, className = '' }: { steps: FlowStep[]; className?: string }) {
  return (
    <div className={`flex items-stretch max-[860px]:flex-col ${className}`}>
      {steps.map((s, i) => (
        <Fragment key={i}>
          <div className="flex-1 rounded-2xl border border-hair bg-white/70 backdrop-blur-[10px] p-4 min-w-0">
            <div className="text-[11px] font-semibold text-peri-deep tabular-nums">{s.n ?? String(i + 1).padStart(2, '0')}</div>
            <div className="font-atx-display font-medium text-[14px] tracking-[-0.01em] leading-[1.2] text-ink mt-1.5">{s.label}</div>
            {s.sub && <div className="text-[11px] text-ink-soft leading-[1.4] mt-1">{s.sub}</div>}
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center px-2 shrink-0 max-[860px]:justify-start max-[860px]:pl-6 max-[860px]:py-1">
              {/* desktop: horizontal marching dash + arrowhead */}
              <span aria-hidden className="flow-dash-h h-[2px] w-8 rounded-full opacity-70 max-[860px]:hidden" />
              <span aria-hidden className="text-peri-deep text-[12px] -ml-[3px] max-[860px]:hidden">▸</span>
              {/* mobile: vertical marching dash */}
              <span aria-hidden className="flow-dash-v w-[2px] h-5 rounded-full opacity-70 hidden max-[860px]:inline-block" />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
