'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr } from '@/lib/web2/api'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { ClaimCard } from '@/components/rewards/campaigns/ClaimCard'
import { toast } from 'sonner'
import * as Progress from '@radix-ui/react-progress'
import * as Tooltip from '@radix-ui/react-tooltip'
import { BarChart2, Zap, Award, Share2, Coins, Calendar, Link2, Activity, CheckCircle2, Clock, ChevronRight, Copy, Check } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RechartsTooltip } from 'recharts'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Signal {
  key: string
  name: string
  icon: string
  max: number
  color: string
  score: number
  insights: string[]
}

interface ScoreResponse {
  address: string
  score: number
  tier: string
  percentile: number
  signals: Signal[]
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  character: { label: string; color: string; desc: string; icon: string }
  uvOpportunities: {
    name: string; cat: string; icon: string
    type: string; typeColor: string; accentColor: string
    mechanic: string; lo: number; hi: number; reason: string
  }[]
  totalLo: number
  totalHi: number
  timeline?: { date: string; score: number; events: unknown[] }[]
}

type Tab = 'portfolio' | 'score' | 'badge' | 'invite' | 'rewards'

// ─── Profile content ──────────────────────────────────────────────────────────
function ProfileContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData] = useState<ScoreResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [easAttestation, setEasAttestation] = useState<{ uid: string; eas_explorer_url: string; attested_at?: string } | null>(null)
  const [easLoading, setEasLoading]         = useState(false)

  const {
    stats: refStats,
    referralRecords,
    refCode,
    isFirstConnect,
    isLoading: refLoading,
  } = useReferral(wallet || undefined)

  useEffect(() => { window.scrollTo(0, 0) }, [])

  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [wallet])

  // Fetch (or create) EAS attestation when the Score tab becomes active
  useEffect(() => {
    if (activeTab !== 'score' || !wallet || easAttestation || easLoading) return
    setEasLoading(true)
    fetch(`/api/eas/attest-score?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        if (d?.uid) setEasAttestation(d)
      })
      .catch(() => {})
      .finally(() => setEasLoading(false))
  }, [activeTab, wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Address copied')
  }

  const score = data?.score ?? 0
  const tier = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const maxScore = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925

  return (
    <div className="page-profile min-h-screen bg-mw-surface">
      <ReferralSheet
        stats={refStats}
        trigger={isFirstConnect && !loading && !!data}
      />
      {/* Dark hero header */}
      <div className="max-w-[960px] mx-auto px-8 pt-6 max-sm:px-5">
      <div className="mw-grid-overlay mw-hero-gradient relative overflow-hidden rounded-lg mb-7 animate-fade-up pt-9 max-sm:pt-6">
        <div className="absolute top-[-60px] right-[10%] w-[320px] h-[320px] rounded-full bg-[radial-gradient(circle,rgba(0,82,255,0.08)_0%,transparent_65%)] pointer-events-none" />
        <div className="px-8 max-sm:px-5">
          <div className="flex items-start gap-[22px] pb-7 relative max-sm:flex-wrap">
            <div className="w-[82px] h-[82px] rounded-[20px] bg-[rgba(15,23,42,0.07)] border-[1.5px] border-[rgba(15,23,42,0.12)] flex items-center justify-center text-[36px] font-bold text-mw-ink shrink-0 relative font-mono">
              {avatarLetter}
              {score > 0 && (
                <div className="absolute bottom-[-1px] right-[-1px] bg-mw-brand text-white font-mono text-[10px] font-semibold px-2 py-[3px] rounded-[8px_0_8px_0] whitespace-nowrap">
                  {score}
                </div>
              )}
            </div>
            <div className="flex-1 pt-1">
              <div className="text-[22px] font-bold text-mw-ink tracking-[-0.5px] flex items-center gap-2 flex-wrap mb-1.5">
                <WalletDisplay address={wallet} mono className="text-mw-ink text-[22px] font-bold tracking-[-0.5px]" />
                {data && (
                  <span className="text-[10px] font-semibold bg-[rgba(79,126,247,0.12)] text-mw-brand px-2.5 py-[3px] rounded-full border border-[rgba(79,126,247,0.28)] tracking-[0.3px] whitespace-nowrap">
                    {tier} tier
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-mw-ink-3 mb-3 flex items-center gap-2 flex-wrap break-all">
                {wallet}
                <button
                  className="inline-flex items-center justify-center w-6 h-6 rounded-[6px] bg-[rgba(15,23,42,0.06)] border border-[rgba(15,23,42,0.10)] cursor-pointer shrink-0 transition-all duration-150 hover:bg-[rgba(0,82,255,0.12)] hover:border-[rgba(0,82,255,0.4)] text-mw-ink-3 hover:text-mw-brand"
                  onClick={copyAddress}
                  title={copied ? 'Copied!' : 'Copy address'}
                >
                  {copied ? <Check size={11} className="text-mw-live" /> : <Copy size={11} />}
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {data?.walletAge && (
                  <span className="bg-[rgba(15,23,42,0.06)] border border-[rgba(15,23,42,0.08)] rounded-full px-3 py-1 text-[11px] text-mw-ink-3 flex items-center gap-[5px]">
                    <Calendar size={10} />{data.walletAge} old
                  </span>
                )}
                {data?.chains != null && (
                  <span className="bg-[rgba(15,23,42,0.06)] border border-[rgba(15,23,42,0.08)] rounded-full px-3 py-1 text-[11px] text-mw-ink-3 flex items-center gap-[5px]">
                    <Link2 size={10} />{data.chains} chains
                  </span>
                )}
                {data?.totalTxCount != null && (
                  <span className="bg-[rgba(15,23,42,0.06)] border border-[rgba(15,23,42,0.08)] rounded-full px-3 py-1 text-[11px] text-mw-ink-3 flex items-center gap-[5px]">
                    <Activity size={10} />{data.totalTxCount} txns
                  </span>
                )}
                {data?.percentile != null && (
                  <span className="bg-[rgba(79,126,247,0.12)] border border-[rgba(79,126,247,0.28)] text-mw-brand rounded-full px-3 py-1 text-[11px] flex items-center gap-[5px]">
                    top {100 - data.percentile}%
                  </span>
                )}
              </div>
            </div>

            <div className="text-right min-w-[180px] pt-1 shrink-0 max-sm:min-w-0 max-sm:w-full max-sm:text-left">
              {data ? (
                <>
                  <AnimatedScore value={score} className="text-[56px] font-bold text-mw-brand font-mono tracking-[-2px] leading-none block" />
                  <div className="text-[11px] text-mw-ink-3 mt-1">of {maxScore} pts · {tier} tier</div>
                  {data.timeline && data.timeline.length > 1 && (
                    <div className="mt-3 h-9 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.timeline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4f7ef7" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#4f7ef7" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <RechartsTooltip
                            contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.8)', padding: '4px 10px' }}
                            itemStyle={{ color: '#6b9fff' }}
                            formatter={(v: number) => [v, 'score']}
                            labelFormatter={(l: string) => l}
                          />
                          <Area type="monotone" dataKey="score" stroke="#4f7ef7" strokeWidth={1.5} fill="url(#scoreGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className={[
                    'text-[18px] font-bold text-[#4ade80] font-mono tracking-[-0.5px] leading-none',
                    (data.timeline?.length ?? 0) > 1 ? 'mt-2' : 'mt-4',
                  ].join(' ')}>
                    ${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-mw-ink-3 mt-[3px]">Est. annual earnings</div>
                </>
              ) : loading ? (
                <div className="text-[13px] text-mw-ink-3">Loading…</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mw-accent-section border-t border-[rgba(15,23,42,0.08)]">
          <div className="flex items-stretch overflow-x-auto">
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(15,23,42,0.08)] shrink-0 bg-[rgba(0,82,255,0.08)] border-t-2 border-t-mw-brand -mt-px">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">Attribution score</span>
              <span className="text-mw-brand font-mono text-sm font-semibold whitespace-nowrap">
                {score > 0 ? `${score} / ${maxScore}` : '—'}
              </span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(15,23,42,0.08)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">Percentile</span>
              <span className="text-sm font-semibold text-mw-ink whitespace-nowrap">{data ? `${data.percentile}th` : '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(15,23,42,0.08)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">First seen</span>
              <span className="text-sm font-semibold text-mw-ink whitespace-nowrap">{data?.firstSeen ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(15,23,42,0.08)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">Chains</span>
              <span className="text-sm font-semibold text-mw-ink whitespace-nowrap">{data?.chains ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(15,23,42,0.08)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">Network size</span>
              <span className="text-sm font-semibold text-mw-ink whitespace-nowrap">{data?.treeSize ?? 0} wallets</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 whitespace-nowrap">Character</span>
              <span
                className="text-sm font-semibold whitespace-nowrap"
                style={{ color: data?.character?.color ?? 'var(--color-mw-ink)' }}
              >
                {data?.character?.icon} {data?.character?.label ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Tabs */}
      <div className="pt-5 bg-transparent">
        <div className="max-w-[960px] mx-auto px-8 max-sm:px-5">
          <div className="flex gap-2 max-sm:flex-wrap max-sm:gap-1.5">
            {(['portfolio', 'score', 'badge', 'invite', 'rewards'] as Tab[]).map(t => (
              <div
                key={t}
                className={[
                  'px-[18px] py-2 text-[13px] font-medium cursor-pointer rounded-full transition-all duration-150 border select-none',
                  'max-sm:px-3.5 max-sm:py-1.5 max-sm:text-xs',
                  activeTab === t
                    ? 'text-mw-brand bg-mw-brand-dim border-[rgba(0,82,255,0.18)] font-semibold'
                    : 'mw-accent-pill',
                ].join(' ')}
                onClick={() => setActiveTab(t)}
              >
                {t === 'portfolio'
                  ? <><BarChart2 size={13} className="inline mr-[5px] align-text-top" />Portfolio</>
                  : t === 'score'
                  ? <><Zap size={13} className="inline mr-[5px] align-text-top" />Score</>
                  : t === 'badge'
                  ? <><Award size={13} className="inline mr-[5px] align-text-top" />Badge</>
                  : t === 'invite'
                  ? <><Share2 size={13} className="inline mr-[5px] align-text-top" />Invite</>
                  : <><Coins size={13} className="inline mr-[5px] align-text-top" />Rewards</>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="bg-transparent pb-20">
        <div className="max-w-[960px] mx-auto px-8 max-sm:px-5 pt-5">
          <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >

          {activeTab === 'portfolio' && (
            <>
              {loading && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading score data…</div>
              )}

              {!loading && data && data.uvOpportunities?.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold tracking-[1px] uppercase text-mw-brand mb-3.5 block">
                    Earning opportunities for your wallet
                  </span>
                  <div className="flex flex-col gap-3">
                    {data.uvOpportunities.map((op, i) => (
                      <div
                        key={i}
                        className="mw-accent-card flex items-start gap-3.5 px-[18px] py-4 rounded-[14px] transition-all duration-150 shadow-[var(--shadow-card)] hover:shadow-md hover:-translate-y-px"
                      >
                        <div
                          className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg shrink-0"
                          style={{ background: op.accentColor + '18', color: op.accentColor }}
                        >
                          {op.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-bold text-mw-ink">{op.name}</span>
                            <span className="text-[10px] text-mw-ink-3">{op.cat}</span>
                            <span
                              className="text-[9px] font-bold tracking-[0.5px] uppercase px-[7px] py-px rounded"
                              style={{ color: op.typeColor, background: op.typeColor + '18' }}
                            >
                              {op.type}
                            </span>
                          </div>
                          <div className="text-[11px] text-mw-ink-3 mb-1">{op.mechanic}</div>
                          <div
                            className="text-[11px] text-mw-ink-2 leading-[1.55]"
                            dangerouslySetInnerHTML={{ __html: op.reason }}
                          />
                        </div>
                        <div className="text-right shrink-0 pl-2">
                          <div className="text-[13px] font-bold text-mw-green font-mono">
                            ${op.lo}–${op.hi}
                          </div>
                          <div className="text-[10px] text-mw-ink-3 mt-0.5">est. / yr</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!loading && !data && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">
                  Could not load score data. The API may be indexing your wallet.
                </div>
              )}
            </>
          )}

          {activeTab === 'score' && (
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
                      <AnimatedScore value={score} className="text-[52px] font-bold text-mw-brand font-mono tracking-[-2px] leading-none block" />
                      <div className="text-[11px] text-mw-ink-3 mt-1.5 font-mono">
                        of {maxScore} max · {data.percentile}th percentile
                      </div>
                    </div>
                    {data.character && (
                      <div className="flex-1 mw-accent-card rounded-xl px-4 py-3.5">
                        <div className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 mb-1.5">Wallet character</div>
                        <div
                          className="text-sm font-bold mb-[5px]"
                          style={{ color: data.character.color }}
                        >
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
                                <span
                                  className="text-xs font-bold font-mono"
                                  style={{ color: sig.color }}
                                >
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
                        <div className="text-[12px] font-bold text-mw-ink font-sans mb-[3px]">
                          Attested on Base
                        </div>
                        {easLoading ? (
                          <div className="w-[140px] h-3 rounded bg-[rgba(26,26,46,0.07)] animate-pulse" />
                        ) : easAttestation ? (
                          <div className="text-[11px] text-mw-ink-3 font-mono">
                            {shortAddr(easAttestation.uid)}
                          </div>
                        ) : (
                          <div className="text-[11px] text-mw-ink-4 font-sans">
                            Your score is cryptographically signed
                          </div>
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
                </>
              )}
            </div>
          )}

          {activeTab === 'invite' && (
            <InviteTab
              wallet={wallet}
              refCode={refCode}
              stats={refStats}
              referralRecords={referralRecords}
              isLoading={refLoading}
            />
          )}

          {activeTab === 'rewards' && (
            <ClaimCard wallet={wallet} />
          )}

          {activeTab === 'badge' && (
            <div className="mw-accent-card text-center px-6 py-12 rounded-xl shadow-[var(--shadow-card)]">
              {data ? (
                <>
                  <div className="text-[56px] mb-3.5 leading-none">{data.character?.icon ?? '🏅'}</div>
                  <div
                    className="text-xl font-bold tracking-[-0.3px] mb-1.5"
                    style={{ color: data.character?.color ?? '#0052FF' }}
                  >
                    {data.character?.label ?? tier}
                  </div>
                  <div className="text-[13px] text-mw-ink-3 mb-4">
                    {tier} tier · {data.percentile}th percentile
                  </div>
                  <div className="text-[13px] leading-[1.7] max-w-[380px] mx-auto mb-7 text-mw-ink-2">
                    {data.character?.desc}
                  </div>
                  <div className="mw-accent-card inline-flex rounded-[14px] overflow-hidden max-sm:flex-col">
                    <div className="px-7 py-4 border-r border-mw-border text-center max-sm:border-r-0 max-sm:border-b max-sm:border-b-mw-border">
                      <div className="text-[22px] font-bold font-mono tracking-[-0.5px] text-[#0052FF]">
                        {score}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Score</div>
                    </div>
                    <div className="px-7 py-4 border-r border-mw-border text-center max-sm:border-r-0 max-sm:border-b max-sm:border-b-mw-border">
                      <div className="text-[22px] font-bold text-mw-ink font-mono tracking-[-0.5px]">
                        {data.chains}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Chains</div>
                    </div>
                    <div className="px-7 py-4 text-center">
                      <div className="text-[22px] font-bold text-mw-ink font-mono tracking-[-0.5px]">
                        {data.treeSize}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Network</div>
                    </div>
                  </div>
                </>
              ) : loading ? (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>
              ) : (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Could not load badge data.</div>
              )}
            </div>
          )}

          </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <ProfileContent />
      </MwAuthGuard>
    </>
  )
}
