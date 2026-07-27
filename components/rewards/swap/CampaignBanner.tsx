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
    <div className="flex items-center gap-[10px] px-[16px] py-[10px] bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-coral mb-[12px] font-atx-display text-[13px] text-atx-ink flex-wrap gap-x-[8px] gap-y-[4px]">
      <svg viewBox="0 0 100 100" className="w-[16px] h-[16px] text-atx-coral shrink-0" aria-hidden="true">
        <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
      </svg>
      <div className="flex items-center gap-[6px] flex-wrap">
        <span className="inline-flex items-center px-[8px] py-[2px] border border-atx-ink text-atx-blue font-semibold text-[11px] font-atx-mono uppercase tracking-[0.04em]">
          {campaign.buyerRewardPct}% Buyer Reward
        </span>
        {referrerDisplay && (
          <>
            <span className="text-atx-ink/45">·</span>
            <span>Referred by <strong className="font-atx-mono text-[11px]">{referrerDisplay}</strong></span>
          </>
        )}
        {campaign.campaignName && (
          <>
            <span className="text-atx-ink/45">·</span>
            <span className="text-atx-ink/60">{campaign.campaignName}</span>
          </>
        )}
      </div>
    </div>
  )
}
