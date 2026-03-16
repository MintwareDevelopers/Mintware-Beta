'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { API } from '@/lib/api'

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
    <>
      <style>{`
        .mw-score-preview {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 14px;
          border-radius: 10px;
          border: 1px solid rgba(0,82,255,0.13);
          background: rgba(0,82,255,0.04);
          margin: 6px 0;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; color: #3A3C52;
        }
        .mw-score-icon { font-size: 16px; flex-shrink: 0; }
        .mw-score-nums {
          display: flex; align-items: center; gap: 6px;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 13px; font-weight: 600; color: #1A1A2E;
        }
        .mw-score-arrow { color: #0052FF; }
        .mw-score-projected { color: #16a34a; }
        .mw-score-label { color: #8A8C9E; font-size: 12px; }
        .mw-score-skel { display: inline-block; width: 32px; height: 13px; background: #e2e8f0; border-radius: 4px; }
      `}</style>

      <div className="mw-score-preview">
        <span className="mw-score-icon">⚡</span>
        <div>
          <div className="mw-score-nums">
            {isLoading ? (
              <span className="mw-score-skel" />
            ) : (
              <>
                <span>{data?.score ?? 0}</span>
                {estimatedScoreGain > 0 && (
                  <>
                    <span className="mw-score-arrow">→</span>
                    <span className="mw-score-projected">{projected}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="mw-score-label">
            Attribution score{estimatedScoreGain > 0 ? ` · +${estimatedScoreGain} pts after this swap` : ''}
            {data?.tier ? ` · ${data.tier}` : ''}
          </div>
        </div>
      </div>
    </>
  )
}
