'use client'

// =============================================================================
// StepIndicator.tsx — 5-step progress indicator
//
// Active:   #3A5CE8 filled circle + bold label
// Complete: #2A9E8A filled circle + checkmark
// Future:   #E0DFFF circle + muted label
// Connector: #E0DFFF line between steps
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

          return (
            <div
              key={stepNum}
              className={`si-item flex flex-col items-center flex-1 relative${isComplete ? ' complete' : ''}`}
            >
              <div
                className={`si-circle w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold font-mono relative z-[1] shrink-0 ${isComplete ? 'bg-mw-teal text-white border-none' : isActive ? 'bg-mw-brand-deep text-white border-none' : 'bg-white text-[#C4C3F0] border-2 border-[#E0DFFF]'}`}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className={`si-label font-sans text-[10px] mt-[6px] text-center whitespace-nowrap ${isActive ? 'font-bold text-mw-brand-deep' : isComplete ? 'font-semibold text-mw-teal' : 'font-semibold text-mw-ink-4'}`}
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
