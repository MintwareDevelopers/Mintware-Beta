'use client'

// A tiny 24h price-trend sparkline (Meteora standard). SVG polyline, green when the series ends up over
// the window and red when it ends down — the same at-a-glance read the reference dapps use. Pure display
// of real GeckoTerminal closes (from /api/gateway/sparklines); renders nothing when there's no series.

export function Sparkline({ series, width = 68, height = 26 }: { series?: number[]; width?: number; height?: number }) {
  if (!series || series.length < 3) {
    return <span className="inline-block" style={{ width, height }} aria-hidden />
  }
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const stepX = width / (series.length - 1)
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8) // 4px vertical padding
  const pts = series.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const up = series[series.length - 1] >= series[0]
  const color = up ? '#34D399' : '#F0736E'
  const id = `sg-${up ? 'u' : 'd'}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-label={`24h trend ${up ? 'up' : 'down'}`} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={pts} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
