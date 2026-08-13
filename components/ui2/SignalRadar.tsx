'use client'

// SignalRadar — the "anatomy of the 925-point score" as a radar. Factual: each
// axis is a signal's maximum point contribution (Sharing's 400 spike shows why
// it's weighted heaviest). Design v2 — hex literals mirror the periwinkle tokens
// (recharts needs concrete colors, not CSS vars).

import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts'

const PERI = '#6C6CF0'

const DATA = [
  { signal: 'Volume',     cap: 100 },
  { signal: 'Trading',    cap: 75 },
  { signal: 'Holding',    cap: 100 },
  { signal: 'Liquidity',  cap: 150 },
  { signal: 'Governance', cap: 100 },
  { signal: 'Sharing',    cap: 400 },
]

export function SignalRadar() {
  return (
    <div className="w-full h-[320px] max-[560px]:h-[280px]" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={DATA} outerRadius="72%" margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <defs>
            <radialGradient id="signalFill" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor={PERI} stopOpacity={0.05} />
              <stop offset="100%" stopColor={PERI} stopOpacity={0.28} />
            </radialGradient>
          </defs>
          <PolarGrid stroke="rgba(23,23,31,0.10)" />
          <PolarAngleAxis dataKey="signal" tick={{ fill: '#55555F', fontSize: 12, fontWeight: 600 }} />
          <Radar dataKey="cap" stroke={PERI} strokeWidth={2} fill="url(#signalFill)" isAnimationActive dot={{ r: 3, fill: PERI, strokeWidth: 0 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
