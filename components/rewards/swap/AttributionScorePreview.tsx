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
    <div className="flex items-center gap-[10px] px-[14px] py-[9px] rounded-xl border border-[rgba(108,108,240,0.2)] bg-[rgba(108,108,240,0.06)] my-[6px] text-[13px] text-ink-mid">
      <span className="w-[8px] h-[8px] rounded-full bg-peri shrink-0" />
      <div>
        <div className="flex items-center gap-[6px] font-mono text-[13px] font-semibold text-ink">
          {isLoading ? (
            <span className="inline-block w-[32px] h-[13px] rounded bg-ground-cool mw-shimmer" />
          ) : (
            <>
              <span>{data?.score ?? 0}</span>
              {estimatedScoreGain > 0 && (
                <>
                  <span className="text-peri-deep">→</span>
                  <span className="text-coral2-deep">{projected}</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="text-ink-soft text-[12px] font-mono">
          Attribution score{estimatedScoreGain > 0 ? ` · +${estimatedScoreGain} pts after this swap` : ''}
          {data?.tier ? ` · ${data.tier}` : ''}
        </div>
      </div>
    </div>
  )
}
