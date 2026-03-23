'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { API } from '@/lib/web2/api'

interface ScoreData {
  score: number
  tier: string
}

interface AttributionScorePreviewProps {
  estimatedScoreGain: number
}

export function AttributionScorePreview({ estimatedScoreGain }: AttributionScorePreviewProps) {
  const { address, isConnected } = useAccount()
  const [data, setData] = useState<ScoreData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!address || !isConnected) { setData(null); return }
    setIsLoading(true)
    fetch(`${API}/score?address=${address}`)
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
    <div className="flex items-center gap-[10px] px-[14px] py-[9px] rounded-[10px] border border-[rgba(0,82,255,0.13)] bg-[rgba(0,82,255,0.04)] my-[6px] font-sans text-[13px] text-[#3A3C52]">
      <span className="text-[16px] shrink-0">⚡</span>
      <div>
        <div className="flex items-center gap-[6px] font-mono text-[13px] font-semibold text-[#1A1A2E]">
          {isLoading ? (
            <span className="inline-block w-[32px] h-[13px] bg-[#e2e8f0] rounded-[4px]" />
          ) : (
            <>
              <span>{data?.score ?? 0}</span>
              {estimatedScoreGain > 0 && (
                <>
                  <span className="text-mw-brand">→</span>
                  <span className="text-mw-green">{projected}</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="text-mw-ink-4 text-[12px]">
          Attribution score{estimatedScoreGain > 0 ? ` · +${estimatedScoreGain} pts after this swap` : ''}
          {data?.tier ? ` · ${data.tier}` : ''}
        </div>
      </div>
    </div>
  )
}
