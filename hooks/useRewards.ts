'use client'

import { useState, useEffect } from 'react'
import { getCampaignRewards } from '@/lib/rewards'
import type { CampaignReward } from '@/lib/rewards'

export function useRewards(campaignId: string | null): {
  campaign: CampaignReward | null
  isLoading: boolean
  error: string | null
} {
  const [campaign, setCampaign] = useState<CampaignReward | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!campaignId) {
      setCampaign(null)
      return
    }

    setIsLoading(true)
    setError(null)

    getCampaignRewards(campaignId)
      .then(data => {
        setCampaign(data)
        setIsLoading(false)
      })
      .catch(err => {
        setError(err?.message ?? 'Failed to load campaign')
        setCampaign(null)
        setIsLoading(false)
      })
  }, [campaignId])

  return { campaign, isLoading, error }
}
