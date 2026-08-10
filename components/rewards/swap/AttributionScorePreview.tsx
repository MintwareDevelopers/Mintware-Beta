'use client'

import { useState, useEffect } from 'react'
import { scoreApiUrl } from '@/lib/web2/api'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface ScoreData {
  score: number
  tier: string
}

interface AttributionScorePreviewProps {
  estimatedScoreGain: number
}

export function AttributionScorePreview({ estimatedScoreGain }: AttributionScorePreviewProps) {
  const { address, isConnected } = useMintwareIdentity()
  const [data, setData] = useState<ScoreData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!address || !isConnected) { setData(null); return }
    setIsLoading(true)
    fetch(scoreApiUrl(address))
      .then(r => r.json())
      .then(d => {
        setData({ score: d.score ?? 0, tier: d.tier ?? '' })
        setIsLoading(false)
      })
      .catch(() => { setIsLoading(false) })
  }, [address, isConnected])

  if (!isConnected || (!data && !isLoading)) return null

  const projected = data ? data.score + estimatedScoreGain : null

  return (
    <div className="flex items-center gap-[10px] px-[14px] py-[9px] border border-atx-ink/25 bg-atx-bone my-[6px] font-atx-display text-[13px] text-atx-ink/60">
      <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-ink shrink-0" />
      <div>
        <div className="flex items-center gap-[6px] font-atx-mono text-[13px] font-semibold text-atx-ink">
          {isLoading ? (
            <span className="inline-block w-[32px] h-[13px] bg-[#e2e8f0]" />
          ) : (
            <>
              <span>{data?.score ?? 0}</span>
              {estimatedScoreGain > 0 && (
                <>
                  <span className="text-atx-blue">→</span>
                  <span className="text-atx-mesquite">{projected}</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="text-atx-ink/55 text-[12px] font-atx-mono">
          Attribution score{estimatedScoreGain > 0 ? ` · +${estimatedScoreGain} pts after this swap` : ''}
          {data?.tier ? ` · ${data.tier}` : ''}
        </div>
      </div>
    </div>
  )
}
