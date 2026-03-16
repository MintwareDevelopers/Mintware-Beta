'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getCampaignRewards } from '@/lib/rewards'
import type { CampaignReward } from '@/lib/rewards'

interface CampaignState {
  campaignId: string | null
  referrer: string | null
  campaign: CampaignReward | null
  isLoading: boolean
}

export function useCampaign(): CampaignState {
  const searchParams = useSearchParams()
  const [state, setState] = useState<CampaignState>({
    campaignId: null,
    referrer: null,
    campaign: null,
    isLoading: false,
  })

  useEffect(() => {
    // Read from URL params first, then fall back to sessionStorage
    let cid = searchParams?.get('cid') ?? null
    let ref = searchParams?.get('ref') ?? null

    if (cid) {
      sessionStorage.setItem('mw_campaign_id', cid)
    } else {
      cid = sessionStorage.getItem('mw_campaign_id')
    }

    if (ref) {
      sessionStorage.setItem('mw_referrer', ref)
    } else {
      ref = sessionStorage.getItem('mw_referrer')
    }

    setState(prev => ({ ...prev, campaignId: cid, referrer: ref }))

    if (!cid) return

    setState(prev => ({ ...prev, isLoading: true }))
    getCampaignRewards(cid!)
      .then(campaign => {
        setState(prev => ({ ...prev, campaign, isLoading: false }))
      })
      .catch(() => {
        setState(prev => ({ ...prev, campaign: null, isLoading: false }))
      })
  }, [searchParams])

  return state
}
