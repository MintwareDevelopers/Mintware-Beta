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
    <div className="bg-atx-panel border border-atx-ink p-6">
      <div className="flex items-center justify-between mb-[22px]">
        <span className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-blue">Attribution score</span>
        <span className="text-[11px] text-white bg-atx-blue border border-atx-ink px-3 py-1 font-semibold font-atx-mono uppercase tracking-[0.06em]">{tier} tier</span>
      </div>

      {loading && <div className="text-center py-12 text-atx-ink/60 text-[13px]">Loading…</div>}

      {data && (
        <>
          <div className="flex items-start gap-5 mb-6">
            <div>
              <AnimatedScore
                value={score}
                className="text-[52px] font-bold text-atx-blue font-atx-mono tracking-[-2px] leading-none block"
              />
              <div className="text-[11px] text-atx-ink/60 mt-1.5 font-atx-mono">
                of {maxScore} max · {data.percentile}th percentile
              </div>
            </div>
            {data.character && (
              <div className="flex-1 bg-atx-panel border border-atx-ink/25 px-4 py-3.5">
                <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-1.5">Wallet character</div>
                <div className="text-sm font-bold mb-[5px]" style={{ color: data.character.color }}>
                  {data.character.icon} {data.character.label}
                </div>
                <div className="text-xs text-atx-ink/60 leading-[1.55]">{data.character.desc}</div>
              </div>
            )}
          </div>

          <Tooltip.Provider delayDuration={200}>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {data.signals.map((sig, i) => (
                <Tooltip.Root key={sig.key}>
                  <Tooltip.Trigger asChild>
                    <div
                      className="bg-atx-panel border border-atx-ink/25 flex flex-col gap-2 px-3.5 py-3.5 cursor-default transition-shadow duration-150 hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-atx-ink/60 font-medium">{sig.icon} {sig.name}</span>
                        <span className="text-xs font-bold font-atx-mono" style={{ color: sig.color }}>
                          {sig.score}<span className="text-atx-ink/45 font-normal">/{sig.max}</span>
                        </span>
                      </div>
                      <Progress.Root
                        className="h-[8px] border border-atx-ink overflow-hidden relative"
                        value={sig.score}
                        max={sig.max}
                      >
                        <Progress.Indicator
                          className="h-full transition-transform duration-[900ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                          style={{
                            background: sig.color,
                            transform: `translateX(-${100 - Math.round((sig.score / sig.max) * 100)}%)`,
                          }}
                        />
                      </Progress.Root>
                      {sig.insights?.length > 0 && (
                        <div className="text-[10px] text-atx-ink/60 leading-[1.5]">{sig.insights[0]}</div>
                      )}
                    </div>
                  </Tooltip.Trigger>
                  {sig.insights?.length > 1 && (
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="bg-atx-ink text-white/85 text-[11px] leading-[1.5] px-3 py-2 max-w-[220px] border border-atx-ink font-atx-display z-[999] animate-[tooltipIn_0.15s_ease]"
                        side="top"
                        sideOffset={6}
                      >
                        {sig.insights.slice(1).map((insight, j) => (
                          <div key={j} className={j < sig.insights.length - 2 ? 'mb-1' : ''}>
                            · {insight}
                          </div>
                        ))}
                        <Tooltip.Arrow className="fill-[#111111]" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  )}
                </Tooltip.Root>
              ))}
            </div>
          </Tooltip.Provider>

          {/* EAS Attestation card */}
          <div className="bg-atx-panel border border-atx-ink/25 mt-4 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 border border-atx-ink bg-atx-bone flex items-center justify-center shrink-0">
                <svg viewBox="0 0 100 100" className="w-4 h-4 text-atx-coral" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
              </div>
              <div>
                <div className="text-[12px] font-bold text-atx-ink mb-[3px]">Attested on Base</div>
                {easLoading ? (
                  <div className="w-[140px] h-3 bg-atx-bone border border-atx-ink/20 animate-pulse" />
                ) : easAttestation ? (
                  <div className="text-[11px] text-atx-ink/60 font-atx-mono">{shortAddr(easAttestation.uid)}</div>
                ) : (
                  <div className="text-[11px] text-atx-ink/55">Your score is cryptographically signed</div>
                )}
              </div>
            </div>
            {easAttestation && (
              <a
                href={easAttestation.eas_explorer_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-atx-blue no-underline whitespace-nowrap px-3 py-[6px] bg-atx-bone border border-atx-ink/25 transition-colors duration-150 hover:border-atx-blue font-atx-mono uppercase tracking-[0.06em]"
              >
                View on EAS ↗
              </a>
            )}
          </div>

          {/* Invite Friends card */}
          <div className="bg-atx-panel border border-atx-ink mt-4 overflow-hidden">
            <div className="relative px-5 py-4 overflow-hidden bg-atx-blue">
              <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-acid mb-[5px]">Invite &amp; Earn</div>
              <div className="text-[16px] font-bold text-white leading-[1.3] mb-[4px] tracking-[-0.3px]">
                Invite friends, boost your score.
              </div>
              <div className="text-[12px] leading-[1.5] text-white/60">
                Active referrals raise your Sharing score and multiply your reward allocation.
              </div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <div>
                <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-[7px]">Your referral link</div>
                {inviteLink ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 font-atx-mono text-[12px] text-atx-ink/60 bg-atx-bone border border-atx-ink/25 px-3 py-[9px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {inviteLink}
                    </div>
                    <button
                      onClick={copyInviteLink}
                      className="shrink-0 h-[38px] px-3 border text-[12px] font-semibold font-atx-mono transition-all duration-150 flex items-center gap-[5px] bg-atx-panel cursor-pointer"
                      style={{
                        borderColor: inviteCopied ? 'var(--color-atx-mesquite)' : 'var(--color-atx-ink)',
                        color: inviteCopied ? 'var(--color-atx-mesquite)' : 'var(--color-atx-ink)',
                      }}
                    >
                      {inviteCopied ? <Check size={13} /> : <Copy size={13} />}
                      {inviteCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <div className="h-[38px] w-full bg-atx-bone border border-atx-ink/20 animate-pulse" />
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={shareInviteOnX}
                  disabled={!inviteLink}
                  className="flex-1 h-[38px] bg-atx-blue border border-atx-ink text-white text-[12px] font-semibold font-atx-mono uppercase tracking-[0.05em] flex items-center justify-center gap-[6px] transition-opacity duration-150 disabled:opacity-40 cursor-pointer"
                >
                  <svg width="13" height="12" viewBox="0 0 15 13" fill="none">
                    <path d="M14.25 1.5C13.72 1.86 13.14 2.13 12.5 2.3C12.14 1.88 11.66 1.58 11.13 1.45C10.59 1.31 10.03 1.35 9.52 1.56C9.01 1.77 8.58 2.13 8.3 2.6C8.01 3.07 7.87 3.62 7.88 4.17V4.79C6.82 4.82 5.77 4.57 4.83 4.08C3.9 3.59 3.11 2.87 2.54 2C2.54 2 0.29 7 5.29 9.25C4.12 10.03 2.73 10.42 1.29 10.38C6.29 13.25 12.54 10.38 12.54 4.12C12.54 3.97 12.53 3.83 12.51 3.68C13.1 3.09 13.53 2.34 14.25 1.5Z" fill="white"/>
                  </svg>
                  Share on X
                </button>
                <button
                  onClick={() => setActiveTab('invite')}
                  className="h-[38px] px-4 border border-atx-ink/25 text-[12px] font-semibold text-atx-ink/60 font-atx-mono flex items-center gap-[5px] transition-all duration-150 hover:border-atx-ink hover:text-atx-ink bg-atx-panel cursor-pointer"
                >
                  <Share2 size={12} />
                  Full stats
                </button>
              </div>
              {refStats && (
                <div className="flex items-center gap-3 pt-[10px] border-t border-atx-ink/20">
                  <div className="text-[11px] text-atx-ink/60 shrink-0">Sharing score</div>
                  <div className="flex-1 h-[8px] border border-atx-ink overflow-hidden relative">
                    <div
                      className="h-full bg-atx-blue absolute inset-y-0 left-0 transition-[width] duration-700"
                      style={{ width: `${Math.round((refStats.sharing_score / 125) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[12px] font-bold font-atx-mono text-atx-blue shrink-0">
                    {refStats.sharing_score}<span className="text-[10px] font-normal text-atx-ink/55">/125</span>
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
