'use client'

import { shortAddr } from '@/lib/web2/api'
import type { CampaignReward } from '@/lib/rewards/calc'

interface CampaignBannerProps {
  campaignId: string | null
  referrer: string | null
  campaign: CampaignReward | null
}

export function CampaignBanner({ campaignId, referrer, campaign }: CampaignBannerProps) {
  if (!campaignId || !campaign || !campaign.isActive) return null

  const referrerDisplay = referrer
    ? shortAddr(referrer)
    : null

  return (
    <>
      <style>{`
        .mw-campaign-banner {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 16px;
          border-radius: 10px;
          background: rgba(0,82,255,0.06);
          border: 1px solid rgba(0,82,255,0.15);
          margin-bottom: 12px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; color: #1A1A2E;
          flex-wrap: wrap; gap: 4px 8px;
        }
        .mw-campaign-icon { font-size: 16px; flex-shrink: 0; }
        .mw-campaign-text { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .mw-campaign-pill {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 6px;
          background: rgba(0,82,255,0.10);
          color: #0052FF; font-weight: 600; font-size: 12px;
        }
        .mw-campaign-sep { color: #8A8C9E; }
      `}</style>

      <div className="mw-campaign-banner">
        <span className="mw-campaign-icon">🎯</span>
        <div className="mw-campaign-text">
          <span className="mw-campaign-pill">{campaign.buyerRewardPct}% Buyer Reward</span>
          {referrerDisplay && (
            <>
              <span className="mw-campaign-sep">·</span>
              <span>Referred by <strong style={{ fontFamily: "var(--font-mono), 'DM Mono', monospace", fontSize: 11 }}>{referrerDisplay}</strong></span>
            </>
          )}
          {campaign.campaignName && (
            <>
              <span className="mw-campaign-sep">·</span>
              <span style={{ color: '#3A3C52' }}>{campaign.campaignName}</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}
