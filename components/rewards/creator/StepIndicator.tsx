'use client'

// =============================================================================
// StepIndicator.tsx — 5-step progress indicator
//
// ATX Settlemint — SQUARE step markers, hairline connectors.
// Active:   bg-atx-blue filled square + bold label
// Complete: bg-atx-ink filled square + number
// Future:   hairline square + muted label
// Connector: atx-ink/20 line between steps (atx-blue when passed)
// =============================================================================

interface StepIndicatorProps {
  currentStep: number          // 1-based
  labels:      string[]
}

export function StepIndicator({ currentStep, labels }: StepIndicatorProps) {
  return (
    <>
      <div className="flex items-start gap-0 w-full">
        {labels.map((label, i) => {
          const stepNum  = i + 1
          const isActive   = stepNum === currentStep
          const isComplete = stepNum < currentStep
          const isLast     = i === labels.length - 1

          return (
            <div
              key={stepNum}
              className="flex flex-col items-center flex-1 relative"
            >
              {/* Connector to the next step */}
              {!isLast && (
                <div
                  className={`absolute top-[13px] left-[calc(50%+14px)] right-[calc(-50%+14px)] h-[2px] z-0 ${isComplete ? 'bg-atx-blue' : 'bg-atx-ink/20'}`}
                />
              )}
              <div
                className={`w-7 h-7 flex items-center justify-center text-[11px] font-bold font-atx-mono relative z-[1] shrink-0 ${isComplete ? 'bg-atx-ink text-white border border-atx-ink' : isActive ? 'bg-atx-blue text-white border border-atx-ink' : 'bg-atx-panel text-atx-ink/45 border border-atx-ink/30'}`}
              >
                {String(stepNum).padStart(2, '0')}
              </div>
              <span
                className={`font-atx-mono text-[10px] uppercase tracking-[0.08em] mt-[6px] text-center whitespace-nowrap ${isActive ? 'font-bold text-atx-blue' : isComplete ? 'font-semibold text-atx-ink' : 'font-semibold text-atx-ink/45'}`}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
