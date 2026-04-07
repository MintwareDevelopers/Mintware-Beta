'use client'

import { CheckCircle2 } from 'lucide-react'
import type { computeBadges } from '@/lib/rewards/badges'
import type { ScoreResponse } from '../types'

type Badge = ReturnType<typeof computeBadges>[number]

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
      {loading && <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>}

      {!loading && !data && (
        <div className="text-center py-12 text-mw-ink-3 text-[13px]">Could not load badge data.</div>
      )}

      {data && (
        <>
          {/* Character card */}
          <div className="mw-accent-card rounded-xl px-6 py-5 mb-4 flex items-start gap-4 shadow-[var(--shadow-card)]">
            <div
              className="w-14 h-14 rounded-[14px] flex items-center justify-center text-[28px] shrink-0"
              style={{ background: (data.character?.color ?? '#0052FF') + '18' }}
            >
              {data.character?.icon ?? '○'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-[3px] flex-wrap">
                <span
                  className="text-[18px] font-bold tracking-[-0.3px]"
                  style={{ color: data.character?.color ?? '#0052FF' }}
                >
                  {data.character?.label ?? tier}
                </span>
                <span className="text-[11px] text-mw-ink-3">{tier} tier · top {100 - data.percentile}%</span>
              </div>
              <div className="text-[13px] leading-[1.6] text-mw-ink-2 max-w-[480px]">
                {data.character?.desc}
              </div>
            </div>
          </div>

          {/* Badge grid */}
          <div className="mb-3">
            <span className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-ink-3 mb-3 block">
              {earnedBadges.length} of {badges.length} badges earned
            </span>
            <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
              {badges.map(b => (
                <div
                  key={b.id}
                  className="mw-accent-card rounded-[14px] px-4 py-4 flex flex-col gap-2 transition-all duration-150"
                  style={{
                    opacity:     b.earned ? 1 : 0.45,
                    borderColor: b.earned ? b.color + '40' : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[22px]"
                      style={{ color: b.earned ? b.color : 'var(--color-mw-ink-3)' }}
                    >
                      {b.icon}
                    </span>
                    {b.earned && <CheckCircle2 size={14} style={{ color: b.color }} />}
                  </div>
                  <div>
                    <div
                      className="text-[13px] font-bold mb-[3px]"
                      style={{ color: b.earned ? b.color : 'var(--color-mw-ink)' }}
                    >
                      {b.label}
                    </div>
                    <div className="text-[11px] text-mw-ink-3 leading-[1.4]">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats strip */}
          <div className="mw-accent-card rounded-[14px] overflow-hidden flex max-sm:flex-col">
            {[
              { label: 'Attribution score', value: `${score}/${maxScore}`, color: 'var(--color-mw-brand)' },
              { label: 'Chains active',     value: String(data.chains),    color: 'var(--color-mw-ink)' },
              { label: 'Network size',      value: `${data.treeSize} wallets`, color: 'var(--color-mw-ink)' },
            ].map(({ label, value, color }, i, arr) => (
              <div
                key={label}
                className="flex-1 px-6 py-4 text-center"
                style={{ borderRight: i < arr.length - 1 ? '1px solid var(--color-mw-border)' : undefined }}
              >
                <div className="text-[20px] font-bold font-mono tracking-[-0.5px]" style={{ color }}>{value}</div>
                <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">{label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
