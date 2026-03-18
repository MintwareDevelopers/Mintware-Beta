'use client'

// =============================================================================
// LivePreview.tsx — Live reward preview card for token reward mode
//
// Shows "On a $1,000 purchase: Buyer earns $X, Referrer earns $X, Fee $20"
// Updates live as sliders move.
// =============================================================================

interface LivePreviewProps {
  buyerRewardPct:    number   // e.g. 0.5 → 0.5%
  referralRewardPct: number   // e.g. 3   → 3%
  sampleUsd?:        number   // default 1000
}

function fmtDollar(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}k`
  return `$${n.toFixed(2)}`
}

export function LivePreview({
  buyerRewardPct,
  referralRewardPct,
  sampleUsd = 1000,
}: LivePreviewProps) {
  const buyerEarns   = (buyerRewardPct / 100) * sampleUsd
  const referrerEarns = (referralRewardPct / 100) * sampleUsd
  const fee          = sampleUsd * 0.02

  const rows: { label: string; value: string; color?: string }[] = [
    { label: `Buyer earns`,    value: fmtDollar(buyerEarns),    color: '#2A9E8A' },
    { label: `Referrer earns`, value: fmtDollar(referrerEarns), color: '#7B6FCC' },
    { label: `Mintware fee`,   value: fmtDollar(fee),           color: '#8A8C9E' },
  ]

  return (
    <div style={{
      background:   '#F7F6FF',
      border:       '1px solid #E0DFFF',
      borderRadius: 12,
      padding:      '14px 16px',
    }}>
      <div style={{
        fontFamily:    'Plus Jakarta Sans, sans-serif',
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '1px',
        textTransform: 'uppercase',
        color:         '#8A8C9E',
        marginBottom:  10,
      }}>
        On a {fmtDollar(sampleUsd)} purchase
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#8A8C9E' }}>
              {r.label}
            </span>
            <span style={{
              fontFamily: 'DM Mono, monospace',
              fontSize:   13,
              fontWeight: 700,
              color:      r.color ?? '#1A1A2E',
            }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
