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
      <style>{`
        .si-root {
          display: flex;
          align-items: flex-start;
          gap: 0;
          width: 100%;
        }
        .si-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
        }
        .si-item:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 14px;
          left: calc(50% + 14px);
          right: calc(-50% + 14px);
          height: 2px;
          background: #E0DFFF;
          z-index: 0;
        }
        .si-item:not(:last-child).complete::after {
          background: #2A9E8A;
        }
        .si-circle {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
          position: relative;
          z-index: 1;
          flex-shrink: 0;
        }
        .si-label {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          font-weight: 600;
          margin-top: 6px;
          text-align: center;
          white-space: nowrap;
        }
        @media (max-width: 500px) {
          .si-label { display: none; }
        }
      `}</style>

      <div className="si-root">
        {labels.map((label, i) => {
          const stepNum  = i + 1
          const isActive   = stepNum === currentStep
          const isComplete = stepNum < currentStep

          return (
            <div
              key={stepNum}
              className={`si-item${isComplete ? ' complete' : ''}`}
            >
              <div
                className="si-circle"
                style={{
                  background:  isComplete ? '#2A9E8A' : isActive ? '#3A5CE8' : '#fff',
                  border:      isComplete || isActive ? 'none' : '2px solid #E0DFFF',
                  color:       isComplete || isActive ? '#fff' : '#C4C3F0',
                }}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className="si-label"
                style={{
                  color: isActive ? '#3A5CE8' : isComplete ? '#2A9E8A' : '#8A8C9E',
                  fontWeight: isActive ? 700 : 600,
                }}
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
