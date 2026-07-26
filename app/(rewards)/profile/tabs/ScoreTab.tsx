'use client'

import { useEffect, useState } from 'react'
import { shortAddr } from '@/lib/web2/api'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import * as Progress from '@radix-ui/react-progress'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Share2, Copy, Check } from 'lucide-react'
import type { ReferralStats } from '@/lib/rewards/referral/types'
import type { ScoreResponse, Tab } from '../types'

interface Props {
  data: ScoreResponse | null
  loading: boolean
  wallet: string
  score: number
  maxScore: number
  tier: string
  refStats: ReferralStats | null
  inviteLink: string | null
  setActiveTab: (tab: Tab) => void
}

export function ScoreTab({
  data, loading, wallet, score, maxScore, tier,
  refStats, inviteLink, setActiveTab,
}: Props) {
  const [easAttestation, setEasAttestation] = useState<{
    uid: string
    eas_explorer_url: string
    attested_at?: string
  } | null>(null)
  const [easLoading, setEasLoading] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  // EAS fetch — fires once when this tab mounts (component only renders when active)
  useEffect(() => {
    if (!wallet || easAttestation || easLoading) return
    setEasLoading(true)
    fetch(`/api/eas/attest-score?address=${wallet}`)
      .then(r => r.json())
      .then(d => { if (d?.uid) setEasAttestation(d) })
      .catch(() => {})
      .finally(() => setEasLoading(false))
  }, [wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  function copyInviteLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink).catch(() => {})
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  function shareInviteOnX() {
    if (!inviteLink) return
    const scoreText = score > 0 ? ` I scored ${score}/${maxScore}.` : ''
    const text = encodeURIComponent(
      `I got my on-chain reputation score on @MintwareDev.${scoreText} Score your wallet and join my network: ${inviteLink}`
    )
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  return (
    <div className="mw-accent-card rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between mb-[22px]">
        <span className="text-[10px] font-bold text-mw-brand tracking-[1.5px] uppercase">Attribution score</span>
        <span className="text-[11px] text-white bg-mw-brand px-3 py-1 rounded-full font-semibold">{tier} tier</span>
      </div>

      {loading && <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>}

      {data && (
        <>
          <div className="flex items-start gap-5 mb-6">
            <div>
              <AnimatedScore
                value={score}
                className="text-[52px] font-bold text-mw-brand font-mono tracking-[-2px] leading-none block"
              />
              <div className="text-[11px] text-mw-ink-3 mt-1.5 font-mono">
                of {maxScore} max · {data.percentile}th percentile
              </div>
            </div>
            {data.character && (
              <div className="flex-1 mw-accent-card rounded-xl px-4 py-3.5">
                <div className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 mb-1.5">Wallet character</div>
                <div className="text-sm font-bold mb-[5px]" style={{ color: data.character.color }}>
                  {data.character.icon} {data.character.label}
                </div>
                <div className="text-xs text-mw-ink-2 leading-[1.55]">{data.character.desc}</div>
              </div>
            )}
          </div>

          <Tooltip.Provider delayDuration={200}>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {data.signals.map((sig, i) => (
                <Tooltip.Root key={sig.key}>
                  <Tooltip.Trigger asChild>
                    <div
                      className="mw-accent-card flex flex-col gap-2 px-3.5 py-3.5 rounded-[10px] cursor-default transition-all duration-150 hover:shadow-sm"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-mw-ink-2 font-medium">{sig.icon} {sig.name}</span>
                        <span className="text-xs font-bold font-mono" style={{ color: sig.color }}>
                          {sig.score}<span className="text-mw-ink-5 font-normal">/{sig.max}</span>
                        </span>
                      </div>
                      <Progress.Root
                        className="h-[7px] bg-[rgba(0,0,0,0.07)] rounded overflow-hidden relative"
                        value={sig.score}
                        max={sig.max}
                      >
                        <Progress.Indicator
                          className="h-full rounded transition-transform duration-[900ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                          style={{
                            background: sig.color,
                            transform: `translateX(-${100 - Math.round((sig.score / sig.max) * 100)}%)`,
                          }}
                        />
                      </Progress.Root>
                      {sig.insights?.length > 0 && (
                        <div className="text-[10px] text-mw-ink-3 leading-[1.5]">{sig.insights[0]}</div>
                      )}
                    </div>
                  </Tooltip.Trigger>
                  {sig.insights?.length > 1 && (
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="bg-[#1a1a2e] text-[rgba(255,255,255,0.88)] text-[11px] leading-[1.5] px-3 py-2 rounded-[8px] max-w-[220px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] font-sans z-[999] animate-[tooltipIn_0.15s_ease]"
                        side="top"
                        sideOffset={6}
                      >
                        {sig.insights.slice(1).map((insight, j) => (
                          <div key={j} className={j < sig.insights.length - 2 ? 'mb-1' : ''}>
                            · {insight}
                          </div>
                        ))}
                        <Tooltip.Arrow className="fill-[#1a1a2e]" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  )}
                </Tooltip.Root>
              ))}
            </div>
          </Tooltip.Provider>

          {/* EAS Attestation card */}
          <div className="mw-accent-card mt-4 rounded-md px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[rgba(58,92,232,0.1)] flex items-center justify-center text-lg shrink-0">
                🔗
              </div>
              <div>
                <div className="text-[12px] font-bold text-mw-ink font-sans mb-[3px]">Attested on Base</div>
                {easLoading ? (
                  <div className="w-[140px] h-3 rounded bg-[rgba(26,26,46,0.07)] animate-pulse" />
                ) : easAttestation ? (
                  <div className="text-[11px] text-mw-ink-3 font-mono">{shortAddr(easAttestation.uid)}</div>
                ) : (
                  <div className="text-[11px] text-mw-ink-4 font-sans">Your score is cryptographically signed</div>
                )}
              </div>
            </div>
            {easAttestation && (
              <a
                href={easAttestation.eas_explorer_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-mw-brand-deep no-underline whitespace-nowrap px-3 py-[6px] bg-[rgba(58,92,232,0.08)] rounded-sm border border-[rgba(58,92,232,0.15)] transition-colors duration-150 hover:bg-[rgba(58,92,232,0.14)] font-sans"
              >
                View on EAS ↗
              </a>
            )}
          </div>

          {/* Invite Friends card */}
          <div className="mw-accent-card mt-4 rounded-xl overflow-hidden">
            <div
              className="relative px-5 py-4 overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--color-mw-ink) 0%, #2A1A46 100%)' }}
            >
              <div
                className="absolute top-[-30px] right-[-30px] w-[140px] h-[140px] rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(79,126,247,0.22) 0%, transparent 70%)' }}
              />
              <div className="text-[10px] font-bold tracking-[1.4px] uppercase text-mw-brand mb-[5px] font-sans">Invite &amp; Earn</div>
              <div className="text-[16px] font-bold text-white leading-[1.3] mb-[4px] font-sans tracking-[-0.3px]">
                Invite friends, boost your score.
              </div>
              <div className="text-[12px] leading-[1.5] font-sans" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Active referrals raise your Sharing score and multiply your reward allocation.
              </div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <div>
                <div className="text-[10px] font-semibold text-mw-ink-3 uppercase tracking-[0.8px] mb-[7px] font-sans">Your referral link</div>
                {inviteLink ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 font-mono text-[12px] text-mw-ink-2 bg-mw-surface border border-mw-border rounded-md px-3 py-[9px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {inviteLink}
                    </div>
                    <button
                      onClick={copyInviteLink}
                      className="shrink-0 h-[38px] px-3 rounded-md border text-[12px] font-semibold font-sans transition-all duration-150 flex items-center gap-[5px] bg-white cursor-pointer"
                      style={{
                        borderColor: inviteCopied ? 'var(--color-mw-teal)' : 'var(--color-mw-border-strong)',
                        color: inviteCopied ? 'var(--color-mw-teal)' : 'var(--color-mw-ink)',
                      }}
                    >
                      {inviteCopied ? <Check size={13} /> : <Copy size={13} />}
                      {inviteCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <div className="h-[38px] w-full rounded-md bg-[rgba(26,26,46,0.06)] animate-pulse" />
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={shareInviteOnX}
                  disabled={!inviteLink}
                  className="flex-1 h-[38px] rounded-md bg-[#1DA1F2] text-white text-[12px] font-semibold font-sans flex items-center justify-center gap-[6px] transition-opacity duration-150 disabled:opacity-40 cursor-pointer border-none"
                >
                  <svg width="13" height="12" viewBox="0 0 15 13" fill="none">
                    <path d="M14.25 1.5C13.72 1.86 13.14 2.13 12.5 2.3C12.14 1.88 11.66 1.58 11.13 1.45C10.59 1.31 10.03 1.35 9.52 1.56C9.01 1.77 8.58 2.13 8.3 2.6C8.01 3.07 7.87 3.62 7.88 4.17V4.79C6.82 4.82 5.77 4.57 4.83 4.08C3.9 3.59 3.11 2.87 2.54 2C2.54 2 0.29 7 5.29 9.25C4.12 10.03 2.73 10.42 1.29 10.38C6.29 13.25 12.54 10.38 12.54 4.12C12.54 3.97 12.53 3.83 12.51 3.68C13.1 3.09 13.53 2.34 14.25 1.5Z" fill="white"/>
                  </svg>
                  Share on X
                </button>
                <button
                  onClick={() => setActiveTab('invite')}
                  className="h-[38px] px-4 rounded-md border border-mw-border text-[12px] font-semibold text-mw-ink-2 font-sans flex items-center gap-[5px] transition-all duration-150 hover:border-mw-border-strong hover:text-mw-ink bg-white cursor-pointer"
                >
                  <Share2 size={12} />
                  Full stats
                </button>
              </div>
              {refStats && (
                <div className="flex items-center gap-3 pt-[10px] border-t border-mw-border">
                  <div className="text-[11px] text-mw-ink-3 font-sans shrink-0">Sharing score</div>
                  <div className="flex-1 h-[3px] bg-[rgba(79,126,247,0.12)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-mw-brand rounded-full transition-[width] duration-700"
                      style={{ width: `${Math.round((refStats.sharing_score / 125) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[12px] font-bold font-mono text-mw-brand shrink-0">
                    {refStats.sharing_score}<span className="text-[10px] font-normal text-mw-ink-4">/125</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
