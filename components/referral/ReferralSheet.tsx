'use client'

import { useEffect, useState } from 'react'
import { RefCodeInput } from './RefCodeInput'
import type { ReferralStats } from '@/lib/referral/types'

interface ReferralSheetProps {
  stats:    ReferralStats | null
  trigger:  boolean   // isFirstConnect && scoreLoaded
}

const DISMISSED_KEY = 'mw_ref_sheet_dismissed'

export function ReferralSheet({ stats, trigger }: ReferralSheetProps) {
  const [visible, setVisible] = useState(false)
  const [animIn, setAnimIn]   = useState(false)

  useEffect(() => {
    if (!trigger || !stats) return
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISSED_KEY)) return

    const t = setTimeout(() => {
      setVisible(true)
      requestAnimationFrame(() => setAnimIn(true))
    }, 1500)

    return () => clearTimeout(t)
  }, [trigger, stats])

  function dismiss() {
    setAnimIn(false)
    setTimeout(() => setVisible(false), 300)
    localStorage.setItem(DISMISSED_KEY, 'true')
  }

  if (!visible || !stats) return null

  const pct = Math.round((stats.sharing_score / 125) * 100)

  return (
    <>
      <style>{`
        .rs-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.3);
          z-index: 999;
          opacity: 0;
          transition: opacity 0.3s ease-out;
        }
        .rs-backdrop.in { opacity: 1; }

        .rs-sheet {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #fff;
          border-radius: 20px 20px 0 0;
          box-shadow: 0 -4px 40px rgba(58,92,232,0.12);
          z-index: 1000;
          padding: 28px 24px 40px;
          max-width: 520px;
          margin: 0 auto;
          transform: translateY(100%);
          transition: transform 0.3s ease-out;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .rs-sheet.in { transform: translateY(0); }

        .rs-handle {
          width: 36px; height: 4px;
          background: rgba(26,26,46,0.12);
          border-radius: 2px;
          margin: 0 auto 22px;
        }
        .rs-headline {
          font-size: 18px;
          font-weight: 700;
          color: #1A1A2E;
          margin-bottom: 6px;
          text-align: center;
        }
        .rs-sub {
          font-size: 13px;
          color: #8A8C9E;
          text-align: center;
          margin-bottom: 20px;
        }
        .rs-score-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          background: #F7F6FF;
          border: 1.5px solid rgba(194,83,122,0.2);
          border-radius: 14px;
          padding: 14px 20px;
          margin-bottom: 20px;
        }
        .rs-score-num {
          font-size: 28px;
          font-weight: 700;
          color: #C2537A;
          font-family: var(--font-mono, 'DM Mono', monospace);
          line-height: 1;
        }
        .rs-score-label {
          font-size: 11px;
          color: #8A8C9E;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .rs-score-bar-wrap {
          flex: 1;
          height: 6px;
          background: rgba(194,83,122,0.12);
          border-radius: 3px;
          overflow: hidden;
        }
        .rs-score-bar-fill {
          height: 100%;
          background: #C2537A;
          border-radius: 3px;
          transition: width 0.6s cubic-bezier(0.22,1,0.36,1);
        }
        .rs-btn-later {
          width: 100%;
          padding: 10px;
          background: transparent;
          color: #8A8C9E;
          border: none;
          font-size: 13px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          cursor: pointer;
        }
      `}</style>

      <div className={`rs-backdrop${animIn ? ' in' : ''}`} onClick={dismiss} />

      <div className={`rs-sheet${animIn ? ' in' : ''}`}>
        <div className="rs-handle" />
        <div className="rs-headline">Your Mintware profile is live.</div>
        <div className="rs-sub">Share your link to grow your Sharing score.</div>

        <div className="rs-score-badge">
          <div>
            <div className="rs-score-label">Sharing score</div>
            <div className="rs-score-num">
              {stats.sharing_score}
              <span style={{ fontSize: 14, color: '#C2537A', opacity: 0.5 }}>/125</span>
            </div>
          </div>
          <div className="rs-score-bar-wrap">
            <div className="rs-score-bar-fill" style={{ width: pct + '%' }} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <RefCodeInput value={stats.ref_link} buttonLabel="Copy Link" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <RefCodeInput value={stats.ref_code} buttonLabel="Copy Code" ghost />
        </div>

        <button className="rs-btn-later" onClick={dismiss}>Maybe Later</button>
      </div>
    </>
  )
}
