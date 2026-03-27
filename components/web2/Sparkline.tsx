'use client'

// components/web2/Sparkline.tsx
// Lightweight SVG sparkline — no charting library.
// Accepts timeline data from /score response.

interface SparkPoint {
  date:  string
  score: number
}

interface SparklineProps {
  data:    SparkPoint[]
  width?:  number
  height?: number
}

export function Sparkline({ data, width = 120, height = 36 }: SparklineProps) {
  if (!data || data.length < 2) return null

  const points = data.slice(-10)  // last 10 months
  const scores = points.map(p => p.score)
  const minS   = Math.min(...scores)
  const maxS   = Math.max(...scores)
  const range  = maxS - minS || 1

  const xs = points.map((_, i) => (i / (points.length - 1)) * width)
  const ys = points.map(p => height - ((p.score - minS) / range) * (height - 4) - 2)

  const linePath = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`)
    .join(' ')

  // Fill path — close down to baseline
  const fillPath =
    linePath +
    ` L${xs[xs.length - 1].toFixed(1)},${height} L${xs[0].toFixed(1)},${height} Z`

  const trend     = scores[scores.length - 1] - scores[0]
  const lineColor = trend >= 0 ? '#22c55e' : '#ef4444'
  const fillColor = trend >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)'

  const lastX = xs[xs.length - 1]
  const lastY = ys[ys.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Fill */}
      <path d={fillPath} fill={fillColor} />
      {/* Line */}
      <path d={linePath} stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx={lastX} cy={lastY} r="2.5" fill={lineColor} />
    </svg>
  )
}
