'use client'

// =============================================================================
// CampaignCard.tsx — Campaign list card for /dashboard
// Design: white card, 0.5px border, 12px radius, thin hover highlight.
// Structure: header → 3-col stats → reward pills → progress bar
// =============================================================================

import { useRouter } from 'next/navigation'
import { fmtUSD, daysUntil } from '@/lib/api'
import { TokenIcon } from '@/components/TokenIcon'

export interface Campaign {
  id: string
  name: string
  protocol?: string
  chain: string
  status: 'live' | 'upcoming' | 'ended' | string
  campaign_type?: 'token_pool' | 'points'
  end_date?: string
  start_date?: string
  pool_usd?: number
  pool_remaining_usd?: number
  daily_payout_usd?: number
  token_symbol?: string
  token_address?: string
  token_contract?: string   // API field name — same as token_address
  logo_uri?: string
  chain_id?: number
  min_score?: number
  buyer_reward_pct?: number
  referral_reward_pct?: number
  actions?: Record<string, {
    label: string
    points: number
    per_day?: boolean
    one_time?: boolean
    per_referral?: boolean
    per_referred_trade?: boolean
  }>
}

type ActionItem = NonNullable<Campaign['actions']>[string]

function actionSuffix(action: ActionItem): string {
  if (action.per_day)            return '/day'
  if (action.per_referral)       return '/ref'
  if (action.per_referred_trade) return '/trade'
  return ''
}

function actionPillStyle(key: string): React.CSSProperties {
  if (key.startsWith('referral')) return { background: 'rgba(123,111,204,0.08)', color: '#7B6FCC', border: '0.5px solid rgba(123,111,204,0.2)' }
  if (key === 'bridge')           return { background: 'rgba(79,126,247,0.08)',   color: '#4f7ef7', border: '0.5px solid rgba(79,126,247,0.2)' }
  if (key === 'trade')            return { background: 'rgba(42,158,138,0.08)',   color: '#2A9E8A', border: '0.5px solid rgba(42,158,138,0.2)' }
  if (key === 'hold')             return { background: 'rgba(194,122,0,0.08)',    color: '#C27A00', border: '0.5px solid rgba(194,122,0,0.2)' }
  return                                 { background: 'rgba(79,126,247,0.08)',   color: '#4f7ef7', border: '0.5px solid rgba(79,126,247,0.2)' }
}

interface CampaignCardProps {
  campaign: Campaign
}

export function CampaignCard({ campaign: c }: CampaignCardProps) {
  const router = useRouter()
  const iconName = c.protocol ?? c.name

  const isLive     = c.status === 'live'
  const isUpcoming = c.status === 'upcoming'
  const isEnded    = c.status === 'ended'

  const daysLeft    = c.end_date   ? daysUntil(c.end_date)   : null
  const daysToStart = c.start_date ? daysUntil(c.start_date) : null

  // Progress bar calculation
  let progressPct = 0
  let totalDays: number | null = null
  let elapsedDays: number | null = null
  if (c.start_date && c.end_date) {
    const now = Date.now()
    const s = new Date(c.start_date).getTime()
    const e = new Date(c.end_date).getTime()
    if (e > s) {
      progressPct = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100))
      totalDays   = Math.round((e - s) / 86400000)
      elapsedDays = Math.max(0, totalDays - (daysLeft ?? 0))
    }
  }

  const isTokenPool = c.campaign_type === 'token_pool'
  const hasStats   = c.pool_usd != null || c.pool_remaining_usd != null || c.daily_payout_usd != null || c.min_score != null || c.referral_reward_pct != null
  const hasActions = c.actions && Object.keys(c.actions).length > 0
  const showBar    = isLive && (totalDays !== null || daysLeft !== null)

  return (
    <>
      <style>{`
        .cc-card {
          background: #fff;
          border: 0.5px solid rgba(0,0,0,0.09);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s;
          display: flex;
          flex-direction: column;
        }
        .cc-card:hover { border-color: rgba(79,126,247,0.4); }
        .cc-card.ended { opacity: 0.6; }
        .cc-header {
          padding: 16px 18px 14px;
          border-bottom: 0.5px solid rgba(0,0,0,0.06);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        .cc-identity { display: flex; align-items: center; gap: 12px; }
        .cc-icon {
          width: 36px; height: 36px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 700; flex-shrink: 0;
          border: 0.5px solid rgba(0,0,0,0.07);
          font-family: 'DM Mono', monospace;
        }
        .cc-name {
          font-size: 14px; font-weight: 600; color: #1a1a1a;
          font-family: 'Plus Jakarta Sans', sans-serif; margin-bottom: 4px;
        }
        .cc-meta {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: #6b7280; flex-wrap: wrap;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .cc-live-badge {
          display: inline-flex; align-items: center; gap: 4px;
          background: rgba(34,197,94,0.1); color: #16a34a;
          border: 0.5px solid rgba(34,197,94,0.3);
          border-radius: 20px; padding: 2px 7px;
          font-size: 11px; font-weight: 500;
        }
        .cc-upcoming-badge {
          background: rgba(245,158,11,0.1); color: #d97706;
          border: 0.5px solid rgba(245,158,11,0.3);
          border-radius: 20px; padding: 2px 7px;
          font-size: 11px; font-weight: 500;
        }
        .cc-ended-badge {
          background: rgba(107,114,128,0.08); color: #9ca3af;
          border: 0.5px solid rgba(107,114,128,0.2);
          border-radius: 20px; padding: 2px 7px;
          font-size: 11px;
        }
        .cc-chain-tag {
          flex-shrink: 0; padding: 3px 8px; border-radius: 6px;
          font-size: 11px; font-weight: 500;
          background: #f5f5f7; color: #6b7280;
          border: 0.5px solid rgba(0,0,0,0.07);
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .cc-stats {
          display: grid; grid-template-columns: repeat(3, 1fr);
          padding: 14px 18px; gap: 12px;
          border-bottom: 0.5px solid rgba(0,0,0,0.06);
        }
        .cc-stat-val {
          font-size: 17px; font-weight: 600; color: #1a1a1a;
          font-family: 'DM Mono', monospace; letter-spacing: -0.3px;
        }
        .cc-stat-val span {
          font-size: 11px; font-weight: 400; color: #9ca3af; margin-left: 2px;
        }
        .cc-stat-label {
          font-size: 11px; color: #9ca3af; margin-top: 2px;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .cc-rewards {
          padding: 12px 18px; display: flex; flex-wrap: wrap; gap: 6px;
          border-bottom: 0.5px solid rgba(0,0,0,0.06);
        }
        .cc-reward-pill {
          padding: 4px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 500;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .cc-progress { padding: 12px 18px; }
        .cc-prog-header {
          display: flex; justify-content: space-between;
          font-size: 11px; color: #9ca3af; margin-bottom: 6px;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .cc-prog-bar {
          height: 4px; background: rgba(0,0,0,0.07);
          border-radius: 4px; overflow: hidden;
        }
        .cc-prog-fill {
          height: 100%; background: #4f7ef7; border-radius: 4px;
          transition: width 0.6s ease;
        }
      `}</style>

      <div
        className={`cc-card${isEnded ? ' ended' : ''}`}
        onClick={() => router.push(`/campaign/${c.id}`)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && router.push(`/campaign/${c.id}`)}
      >
        {/* ── Header ── */}
        <div className="cc-header">
          <div className="cc-identity">
            <TokenIcon
              logoUri={c.logo_uri}
              tokenAddress={c.token_address ?? c.token_contract}
              chain={c.chain_id ?? c.chain}
              name={iconName}
              size={36}
              borderRadius={9}
            />
            <div>
              <div className="cc-name">{c.name}</div>
              <div className="cc-meta">
                {isLive && (
                  <span className="cc-live-badge">
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                    Live
                  </span>
                )}
                {isUpcoming && (
                  <span className="cc-upcoming-badge">
                    ◷ {daysToStart !== null ? `In ${daysToStart}d` : 'Soon'}
                  </span>
                )}
                {isEnded && <span className="cc-ended-badge">Ended</span>}
                <span>{c.chain}</span>
                {isLive && daysLeft !== null && <span>· {daysLeft}d left</span>}
              </div>
            </div>
          </div>
          <span className="cc-chain-tag">{c.chain}</span>
        </div>

        {/* ── Stats ── */}
        {hasStats && (
          <div className="cc-stats">
            {/* Pool size — shown for both types */}
            {(c.pool_remaining_usd != null || c.pool_usd != null) && (
              <div>
                <div className="cc-stat-val">
                  {fmtUSD(c.pool_remaining_usd ?? c.pool_usd ?? 0)}
                  {c.token_symbol && <span>{c.token_symbol}</span>}
                </div>
                <div className="cc-stat-label">{isTokenPool ? 'pool remaining' : 'pool size'}</div>
              </div>
            )}

            {/* Token Reward Pool: referral earn % is the headline stat */}
            {isTokenPool && c.referral_reward_pct != null && (
              <div>
                <div className="cc-stat-val" style={{ color: '#2A9E8A' }}>
                  {c.referral_reward_pct}%
                </div>
                <div className="cc-stat-label">referral earn</div>
              </div>
            )}
            {isTokenPool && c.buyer_reward_pct != null && (
              <div>
                <div className="cc-stat-val">{c.buyer_reward_pct}%</div>
                <div className="cc-stat-label">buyer rebate</div>
              </div>
            )}

            {/* Points Campaign: daily payout + min score */}
            {!isTokenPool && c.daily_payout_usd != null && (
              <div>
                <div className="cc-stat-val">{fmtUSD(c.daily_payout_usd)}</div>
                <div className="cc-stat-label">daily payout</div>
              </div>
            )}
            {!isTokenPool && c.min_score != null && (
              <div>
                <div className="cc-stat-val">{c.min_score}+</div>
                <div className="cc-stat-label">min score</div>
              </div>
            )}
          </div>
        )}

        {/* ── Reward pills ── */}
        {isTokenPool ? (
          /* Token Reward Pool: show referral mechanic clearly */
          <div className="cc-rewards">
            <span className="cc-reward-pill" style={{ background: 'rgba(42,158,138,0.08)', color: '#2A9E8A', border: '0.5px solid rgba(42,158,138,0.2)' }}>
              ◉ {c.referral_reward_pct ?? 0}% per swap you refer
            </span>
            {(c.buyer_reward_pct ?? 0) > 0 && (
              <span className="cc-reward-pill" style={{ background: 'rgba(58,92,232,0.08)', color: '#3A5CE8', border: '0.5px solid rgba(58,92,232,0.2)' }}>
                + {c.buyer_reward_pct}% buyer rebate
              </span>
            )}
          </div>
        ) : hasActions ? (
          /* Points Campaign: show action pills */
          <div className="cc-rewards">
            {Object.entries(c.actions!).map(([key, action]) => (
              <span
                key={key}
                className="cc-reward-pill"
                style={actionPillStyle(key)}
              >
                +{action.points} {action.label.split(' ')[0].toLowerCase()}{actionSuffix(action)}
              </span>
            ))}
          </div>
        ) : null}

        {/* ── Progress bar ── */}
        {showBar && (
          <div className="cc-progress">
            <div className="cc-prog-header">
              <span>Campaign progress</span>
              {totalDays !== null && elapsedDays !== null
                ? <span>{elapsedDays} of {totalDays} days</span>
                : daysLeft !== null
                  ? <span>{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
                  : null
              }
            </div>
            <div className="cc-prog-bar">
              <div
                className="cc-prog-fill"
                style={{ width: `${totalDays !== null ? progressPct : Math.max(5, 100 - (daysLeft! / 30) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
