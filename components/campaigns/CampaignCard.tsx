'use client'

// =============================================================================
// CampaignCard.tsx — Campaign list card for /dashboard
//
// Shows: protocol initial, name, chain badge, status badge, pool/daily payout,
//        days remaining, min_score requirement, action tags.
// Click → /campaign/[id]
// Design: white card, #E0DFFF border, 16px radius, hover shadow lift.
// =============================================================================

import { useRouter } from 'next/navigation'
import { fmtUSD, daysUntil, iconColor } from '@/lib/api'

export interface Campaign {
  id: string
  name: string
  protocol?: string
  chain: string
  status: 'live' | 'upcoming' | 'ended' | string
  end_date?: string
  start_date?: string
  pool_usd?: number
  daily_payout_usd?: number
  token_symbol?: string
  min_score?: number
  actions?: Record<string, {
    label: string
    points: number
    per_day?: boolean
    one_time?: boolean
    per_referral?: boolean
    per_referred_trade?: boolean
  }>
}

function actionTagStyle(key: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, fontWeight: 600,
    padding: '3px 10px', borderRadius: 20, border: '1px solid',
    whiteSpace: 'nowrap', fontFamily: 'Plus Jakarta Sans, sans-serif',
  }
  if (key.startsWith('referral')) return { ...base, color: '#7B6FCC', borderColor: 'rgba(123,111,204,0.25)', background: 'rgba(123,111,204,0.07)' }
  if (key === 'bridge')   return { ...base, color: '#3A5CE8', borderColor: 'rgba(58,92,232,0.2)',  background: 'rgba(58,92,232,0.07)' }
  if (key === 'trade')    return { ...base, color: '#2A9E8A', borderColor: 'rgba(42,158,138,0.2)', background: 'rgba(42,158,138,0.07)' }
  if (key === 'hold')     return { ...base, color: '#C27A00', borderColor: 'rgba(194,122,0,0.2)',  background: 'rgba(194,122,0,0.07)' }
  return { ...base, color: '#8A8C9E', borderColor: '#E0DFFF', background: '#F7F6FF' }
}

type ActionDef = NonNullable<Campaign['actions']>[string]

function actionSuffix(action: ActionDef): string {
  if (action.per_day)           return '/day'
  if (action.per_referral)      return '/ref'
  if (action.per_referred_trade) return '/trade'
  return ''
}

interface CampaignCardProps {
  campaign: Campaign
}

export function CampaignCard({ campaign: c }: CampaignCardProps) {
  const router  = useRouter()
  const col     = iconColor(c.name)
  const initial = (c.protocol ?? c.name).charAt(0).toUpperCase()
  const isLive     = c.status === 'live'
  const isUpcoming = c.status === 'upcoming'
  const isEnded    = c.status === 'ended'

  const daysLeft   = c.end_date ? daysUntil(c.end_date) : null
  const daysToStart = c.start_date ? daysUntil(c.start_date) : null

  return (
    <>
      <style>{`
        .cc-card {
          background: #fff;
          border: 1px solid #E0DFFF;
          border-radius: 16px;
          padding: 20px;
          cursor: pointer;
          transition: box-shadow 200ms ease, transform 200ms ease, border-color 200ms ease;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .cc-card:hover {
          box-shadow: 0 4px 24px rgba(58,92,232,0.10);
          transform: translateY(-2px);
          border-color: rgba(58,92,232,0.25);
        }
        .cc-card.ended { opacity: 0.65; }
      `}</style>

      <div
        className={`cc-card${isEnded ? ' ended' : ''}`}
        onClick={() => router.push(`/campaign/${c.id}`)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && router.push(`/campaign/${c.id}`)}
      >
        {/* ── Row 1: icon + name + badges ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: col.bg, color: col.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'DM Mono, monospace', fontSize: 17, fontWeight: 700,
          }}>
            {initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name + status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 700, color: '#1A1A2E' }}>
                {c.name}
              </span>

              {isLive && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 700,
                  background: 'rgba(42,158,138,0.10)', color: '#2A9E8A',
                  border: '1px solid rgba(42,158,138,0.2)',
                  borderRadius: 20, padding: '2px 8px',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#2A9E8A', animation: 'pulse 2s ease-in-out infinite', display: 'inline-block' }} />
                  Live
                </span>
              )}
              {isUpcoming && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 700,
                  background: 'rgba(194,122,0,0.10)', color: '#C27A00',
                  border: '1px solid rgba(194,122,0,0.2)',
                  borderRadius: 20, padding: '2px 8px',
                }}>
                  ◷ {daysToStart !== null ? `Starting in ${daysToStart}d` : 'Coming soon'}
                </span>
              )}
              {isEnded && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#8A8C9E',
                  background: 'rgba(138,140,158,0.1)', border: '1px solid rgba(138,140,158,0.2)',
                  borderRadius: 20, padding: '2px 8px',
                }}>
                  Ended
                </span>
              )}
            </div>

            {/* Chain + days */}
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#8A8C9E' }}>
              {c.chain}
              {isLive && daysLeft !== null && ` · Ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
              {isEnded && ' · Finished'}
            </div>
          </div>

          {/* Chain badge */}
          <span style={{
            flexShrink: 0,
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, fontWeight: 700,
            background: '#EEF1FF', color: '#3A5CE8',
            borderRadius: 6, padding: '3px 8px', letterSpacing: '0.3px',
          }}>
            {c.chain}
          </span>
        </div>

        {/* ── Row 2: pool stats ── */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {c.pool_usd != null && (
            <div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, color: '#1A1A2E' }}>
                {fmtUSD(c.pool_usd)}{c.token_symbol ? ` ${c.token_symbol}` : ''}
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>
                pool size
              </div>
            </div>
          )}
          {c.daily_payout_usd != null && (
            <div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, color: '#1A1A2E' }}>
                {fmtUSD(c.daily_payout_usd)}<span style={{ fontSize: 11, color: '#8A8C9E', fontWeight: 400 }}>/day</span>
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>
                daily payout
              </div>
            </div>
          )}
          {c.min_score != null && (
            <div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, color: '#8A8C9E' }}>
                {c.min_score}+
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>
                min score
              </div>
            </div>
          )}
        </div>

        {/* ── Row 3: action tags ── */}
        {c.actions && Object.keys(c.actions).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(c.actions).map(([key, action]) => (
              <span key={key} style={actionTagStyle(key)}>
                +{action.points} {action.label.split(' ')[0].toLowerCase()}{actionSuffix(action)}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
