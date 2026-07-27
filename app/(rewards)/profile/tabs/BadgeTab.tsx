'use client'

import type { Badge } from '@/lib/rewards/badges'
import type { ScoreResponse } from '../types'

interface Props {
  data: ScoreResponse | null
  loading: boolean
  score: number
  maxScore: number
  tier: string
  badges: Badge[]
  earnedBadges: Badge[]
}

export function BadgeTab({ data, loading, score, maxScore, tier, badges, earnedBadges }: Props) {
  return (
    <div>
      {loading && <div className="text-center py-12 text-atx-ink/60 text-[13px]">Loading…</div>}

      {!loading && !data && (
        <div className="text-center py-12 text-atx-ink/60 text-[13px]">Could not load badge data.</div>
      )}

      {data && (
        <>
          {/* Character card */}
          <div className="bg-atx-panel border border-atx-ink px-6 py-5 mb-4 flex items-start gap-4">
            <div className="w-14 h-14 border border-atx-ink bg-atx-bone flex items-center justify-center text-[28px] shrink-0">
              {data.character?.icon ?? '○'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-[3px] flex-wrap">
                <span
                  className="text-[18px] font-bold tracking-[-0.3px]"
                  style={{ color: data.character?.color ?? 'var(--color-atx-blue)' }}
                >
                  {data.character?.label ?? tier}
                </span>
                <span className="text-[11px] text-atx-ink/60 font-atx-mono">{tier} tier · top {100 - data.percentile}%</span>
              </div>
              <div className="text-[13px] leading-[1.6] text-atx-ink/60 max-w-[480px]">
                {data.character?.desc}
              </div>
            </div>
          </div>

          {/* Badge grid */}
          <div className="mb-3">
            <span className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-3 block">
              {earnedBadges.length} of {badges.length} badges earned
            </span>
            <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
              {badges.map(b => (
                <div
                  key={b.id}
                  className="bg-atx-panel border border-atx-ink/25 px-4 py-4 flex flex-col gap-2 transition-all duration-150"
                  style={{
                    opacity:     b.earned ? 1 : 0.45,
                    borderColor: b.earned ? b.color : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[22px]"
                      style={{ color: b.earned ? b.color : 'var(--color-atx-grey)' }}
                    >
                      {b.icon}
                    </span>
                    {b.earned && <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />}
                  </div>
                  <div>
                    <div
                      className="text-[13px] font-bold mb-[3px]"
                      style={{ color: b.earned ? b.color : 'var(--color-atx-ink)' }}
                    >
                      {b.label}
                    </div>
                    <div className="text-[11px] text-atx-ink/60 leading-[1.4]">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats strip */}
          <div className="bg-atx-panel border border-atx-ink overflow-hidden flex max-sm:flex-col">
            {[
              { label: 'Attribution score', value: `${score}/${maxScore}`, color: 'var(--color-atx-blue)' },
              { label: 'Chains active',     value: String(data.chains),    color: 'var(--color-atx-ink)' },
              { label: 'Network size',      value: `${data.treeSize} wallets`, color: 'var(--color-atx-ink)' },
            ].map(({ label, value, color }, i, arr) => (
              <div
                key={label}
                className="flex-1 px-6 py-4 text-center"
                style={{ borderRight: i < arr.length - 1 ? '1px solid rgba(17,17,17,0.15)' : undefined }}
              >
                <div className="text-[20px] font-bold font-atx-mono tracking-[-0.5px]" style={{ color }}>{value}</div>
                <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mt-[3px]">{label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
