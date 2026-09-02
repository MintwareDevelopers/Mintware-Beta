'use client'

// FeeSplitDonut — the 60/30/10 fee split as a donut with a center callout and
// a legend. Design v2 — hex literals mirror the v2 tokens (recharts needs
// concrete colors). Purely presentational; each project sets its own template,
// and LPs are paid pro-rata by their share of the pool.

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

const SLICES = [
  { name: 'LPs (pro-rata)',    value: 60, color: '#6C6CF0' },
  { name: 'Protocol treasury', value: 30, color: '#F4A183' },
  { name: 'Buybacks',          value: 10, color: '#9A9AA8' },
]

export function FeeSplitDonut() {
  return (
    <div className="flex items-center gap-6 max-[420px]:flex-col max-[420px]:gap-4">
      <div className="relative w-[168px] h-[168px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={SLICES}
              dataKey="value"
              innerRadius={54}
              outerRadius={78}
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              stroke="none"
              isAnimationActive
            >
              {SLICES.map((s) => <Cell key={s.name} fill={s.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-content-center text-center pointer-events-none">
          <div className="font-atx-display text-[30px] font-medium leading-none text-peri-deep tabular-nums">60%</div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft mt-1">to LPs</div>
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {SLICES.map((s) => (
          <div key={s.name} className="flex items-center gap-2.5">
            <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-[13px] text-ink-mid flex-1 truncate">{s.name}</span>
            <span className="text-[13px] font-semibold text-ink tabular-nums">{s.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
