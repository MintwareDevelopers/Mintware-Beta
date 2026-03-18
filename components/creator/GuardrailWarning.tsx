'use client'

// =============================================================================
// GuardrailWarning.tsx — Advisory warning banner (never blocks submission)
// =============================================================================

interface GuardrailWarningProps {
  message: string
}

export function GuardrailWarning({ message }: GuardrailWarningProps) {
  return (
    <div style={{
      display:      'flex',
      alignItems:   'flex-start',
      gap:          10,
      background:   'rgba(194,122,0,0.08)',
      borderLeft:   '3px solid #C27A00',
      borderRadius: '0 8px 8px 0',
      padding:      '10px 14px',
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠</span>
      <span style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize:   13,
        color:      '#C27A00',
        lineHeight: 1.5,
      }}>
        {message}
      </span>
    </div>
  )
}
