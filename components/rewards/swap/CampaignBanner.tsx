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
    <div className="flex items-center gap-[10px] px-[16px] py-[10px] rounded-[10px] bg-[rgba(0,82,255,0.06)] border border-[rgba(0,82,255,0.15)] mb-[12px] font-sans text-[13px] text-[#1A1A2E] flex-wrap gap-x-[8px] gap-y-[4px]">
      <span className="text-[16px] shrink-0">🎯</span>
      <div className="flex items-center gap-[6px] flex-wrap">
        <span className="inline-flex items-center px-[8px] py-[2px] rounded-[6px] bg-[rgba(0,82,255,0.10)] text-mw-brand font-semibold text-[12px]">
          {campaign.buyerRewardPct}% Buyer Reward
        </span>
        {referrerDisplay && (
          <>
            <span className="text-mw-ink-4">·</span>
            <span>Referred by <strong className="font-mono text-[11px]">{referrerDisplay}</strong></span>
          </>
        )}
        {campaign.campaignName && (
          <>
            <span className="text-mw-ink-4">·</span>
            <span className="text-[#3A3C52]">{campaign.campaignName}</span>
          </>
        )}
      </div>
    </div>
  )
}
