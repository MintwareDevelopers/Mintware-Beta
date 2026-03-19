'use client'

// =============================================================================
// ActionsPanel.tsx — Generic campaign actions renderer for Overview tab
//
// Accepts campaign.actions (Record<string, ActionDef>) and renders each
// action with an appropriate icon, label, points description, and one-liner.
// Works generically — no hardcoded action types.
//
// For token_pool campaigns: renders referral mechanic cards (green = earn,
// teal = buyer rebate). For points campaigns: renders action cards.
// =============================================================================

export interface ActionDef {
  label: string
  points: number
  per_day?: boolean
  one_time?: boolean
  per_referral?: boolean
  per_referred_trade?: boolean
}

interface ActionsPanelProps {
  actions: Record<string, ActionDef>
  startDate?: string
  endDate?: string
  campaignType?: 'token_pool' | 'points'
  referralRewardPct?: number
  buyerRewardPct?: number
  tokenSymbol?: string
}

// Icon + description per action key
function actionMeta(key: string): { icon: string; color: string; bg: string; desc: string } {
  if (key === 'bridge')           return { icon: '🌉', color: '#3A5CE8', bg: 'rgba(58,92,232,0.08)',   desc: 'Bridge assets to this chain.' }
  if (key === 'trade')            return { icon: '📈', color: '#2A9E8A', bg: 'rgba(42,158,138,0.08)',  desc: 'Trade each day to accumulate daily points.' }
  if (key === 'referral_bridge')  return { icon: '🔗', color: '#7B6FCC', bg: 'rgba(123,111,204,0.08)', desc: 'Refer wallets who bridge — earn per successful bridge.' }
  if (key === 'referral_trade')   return { icon: '↗',  color: '#C2537A', bg: 'rgba(194,83,122,0.08)',  desc: 'Earn every time a wallet you referred trades.' }
  if (key === 'hold')             return { icon: '💎', color: '#C27A00', bg: 'rgba(194,122,0,0.08)',   desc: 'Hold assets for bonus multiplier.' }
  return { icon: '⚡', color: '#8A8C9E', bg: '#F7F6FF', desc: '' }
}

function pointsLabel(action: ActionDef): string {
  if (action.per_day)            return `${action.points} pts/day`
  if (action.per_referral)       return `${action.points} pts/referral`
  if (action.per_referred_trade) return `${action.points} pts/referred trade`
  if (action.one_time)           return `${action.points} pts (one-time)`
  return `${action.points} pts`
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

function ScheduleBlock({ startDate, endDate }: { startDate?: string; endDate?: string }) {
  if (!startDate && !endDate) return null
  return (
    <div style={{
      marginTop: 16,
      background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px',
        textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 8,
      }}>
        Schedule
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {startDate && (
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{fmtDate(startDate)}</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>Start date</div>
          </div>
        )}
        {endDate && (
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{fmtDate(endDate)}</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>End date</div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ActionsPanel({ actions, startDate, endDate, campaignType, referralRewardPct, buyerRewardPct }: ActionsPanelProps) {
  const entries = Object.entries(actions)
  const isTokenPool = campaignType === 'token_pool'

  // Token Reward Pool: show referral mechanic, not points actions
  if (isTokenPool) {
    return (
      <div>
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 10, fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 12,
        }}>
          How you earn
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Referral earn — main mechanic (GREEN) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(42,158,138,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>◉</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                Share your referral link
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E', lineHeight: 1.4 }}>
                Earn {referralRewardPct ?? 0}% of every swap your referrals make — automatically, with no cap.
              </div>
            </div>
            <div style={{
              flexShrink: 0, fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
              color: '#2A9E8A', background: 'rgba(42,158,138,0.08)',
              borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {referralRewardPct ?? 0}% per swap
            </div>
          </div>

          {/* Buyer rebate — secondary */}
          {(buyerRewardPct ?? 0) > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12,
              padding: '14px 16px',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'rgba(58,92,232,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>⇄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                  Swap via a referral link
                </div>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E', lineHeight: 1.4 }}>
                  Get a small rebate on your own swap when you use someone&apos;s referral link.
                </div>
              </div>
              <div style={{
                flexShrink: 0, fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
                color: '#3A5CE8', background: 'rgba(58,92,232,0.08)',
                borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap',
              }}>
                {buyerRewardPct ?? 0}% rebate
              </div>
            </div>
          )}
        </div>

        <ScheduleBlock startDate={startDate} endDate={endDate} />
      </div>
    )
  }

  // Points Campaign: show action cards
  if (entries.length === 0) return null

  return (
    <div>
      {/* Section label */}
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px',
        textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 12,
      }}>
        Campaign Actions
      </div>

      {/* Action cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(([key, action]) => {
          const meta = actionMeta(key)
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12,
              padding: '14px 16px',
            }}>
              {/* Icon */}
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: meta.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}>
                {meta.icon}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2,
                }}>
                  {action.label}
                </div>
                {meta.desc && (
                  <div style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontSize: 11, color: '#8A8C9E', lineHeight: 1.4,
                  }}>
                    {meta.desc}
                  </div>
                )}
              </div>

              {/* Points badge */}
              <div style={{
                flexShrink: 0,
                fontFamily: 'DM Mono, monospace',
                fontSize: 12, fontWeight: 700,
                color: meta.color,
                background: meta.bg,
                borderRadius: 8, padding: '4px 10px',
                whiteSpace: 'nowrap',
              }}>
                +{pointsLabel(action)}
              </div>
            </div>
          )
        })}
      </div>

      <ScheduleBlock startDate={startDate} endDate={endDate} />
    </div>
  )
}
