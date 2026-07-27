'use client'

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr } from '@/lib/web2/api'
import { computeBadges } from '@/lib/rewards/badges'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { ClaimCard } from '@/components/rewards/campaigns/ClaimCard'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { motion, AnimatePresence } from 'framer-motion'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { BarChart2, Zap, Award, Share2, Coins, Calendar, Link2, Activity, Copy, Check, Droplets, ChevronRight } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RechartsTooltip } from 'recharts'
import { PortfolioTab } from './tabs/PortfolioTab'
import { ScoreTab } from './tabs/ScoreTab'
import { BadgeTab } from './tabs/BadgeTab'
import { LiquidityTab } from './tabs/LiquidityTab'
import type { ScoreResponse, Tab } from './types'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

// ─── Profile content ──────────────────────────────────────────────────────────
function ProfileContent() {
  const { address: evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData]           = useState<ScoreResponse | null>(null)
  const [loading, setLoading]     = useState(false)
  const [copied, setCopied]       = useState(false)

  const {
    stats: refStats,
    referralRecords,
    refCode,
    isFirstConnect,
    isLoading: refLoading,
  } = useReferral(wallet || undefined)

  // Score fetch — needed by the hero section and all tabs
  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [wallet])

  useEffect(() => { window.scrollTo(0, 0) }, [])

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inviteOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'
  const inviteLink   = refCode ? `${inviteOrigin}/ref/${refCode}` : null

  const score    = data?.score ?? 0
  const tier     = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const maxScore = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925

  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'

  const badges      = data ? computeBadges({ walletAge: data.walletAge ?? '', percentile: data.percentile ?? 0, totalTxCount: data.totalTxCount ?? 0, signals: data.signals ?? [], treeSize: data.treeSize ?? 0 }, data.treeSize ?? 0) : []
  const earnedBadges = badges.filter(b => b.earned)

  return (
    <div className="page-profile min-h-screen bg-atx-bone font-atx-display text-atx-ink [&_*]:rounded-none">
      <ReferralSheet
        stats={refStats}
        trigger={isFirstConnect && !loading && !!data}
      />

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className="max-w-[960px] mx-auto px-8 pt-6 max-sm:px-5">
        <div className="border border-atx-ink relative overflow-hidden mb-7 animate-fade-up pt-9 max-sm:pt-6" style={{ backgroundImage: GRID_BG }}>
          <div className="px-8 max-sm:px-5">
            <div className="flex items-start gap-[22px] pb-7 relative max-sm:flex-wrap">
              {/* Avatar */}
              <div className="w-[82px] h-[82px] bg-atx-panel border border-atx-ink flex items-center justify-center text-[36px] font-bold text-atx-ink shrink-0 relative font-atx-mono">
                {avatarLetter}
                {score > 0 && (
                  <div className="absolute bottom-[-1px] right-[-1px] bg-atx-blue text-white font-atx-mono text-[10px] font-semibold px-2 py-[3px] border border-atx-ink whitespace-nowrap">
                    {score}
                  </div>
                )}
              </div>

              {/* Identity */}
              <div className="flex-1 pt-1">
                <div className="text-[22px] font-bold text-atx-ink tracking-[-0.02em] flex items-center gap-2 flex-wrap mb-1.5">
                  <WalletDisplay address={wallet} mono className="text-atx-ink text-[22px] font-bold tracking-[-0.02em] font-atx-mono" />
                  {data && (
                    <span className="text-[10px] font-semibold border border-atx-ink text-atx-blue px-2.5 py-[3px] tracking-[0.06em] uppercase whitespace-nowrap font-atx-mono">
                      {tier} tier
                    </span>
                  )}
                </div>
                <div className="font-atx-mono text-[11px] text-atx-ink/55 mb-3 flex items-center gap-2 flex-wrap break-all">
                  {wallet}
                  <button
                    className="inline-flex items-center justify-center w-6 h-6 border border-atx-ink/30 bg-atx-panel cursor-pointer shrink-0 transition-colors duration-150 hover:border-atx-blue text-atx-ink/55 hover:text-atx-blue"
                    onClick={copyAddress}
                    title={copied ? 'Copied!' : 'Copy address'}
                  >
                    {copied ? <Check size={11} className="text-atx-mesquite" /> : <Copy size={11} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {data?.walletAge && (
                    <span className="border border-atx-ink/25 px-3 py-1 text-[11px] text-atx-ink/60 flex items-center gap-[5px] font-atx-mono">
                      <Calendar size={10} />{data.walletAge} old
                    </span>
                  )}
                  {data?.chains != null && (
                    <span className="border border-atx-ink/25 px-3 py-1 text-[11px] text-atx-ink/60 flex items-center gap-[5px] font-atx-mono">
                      <Link2 size={10} />{data.chains} chains
                    </span>
                  )}
                  {data?.totalTxCount != null && (
                    <span className="border border-atx-ink/25 px-3 py-1 text-[11px] text-atx-ink/60 flex items-center gap-[5px] font-atx-mono">
                      <Activity size={10} />{data.totalTxCount} txns
                    </span>
                  )}
                  {data?.percentile != null && (
                    <span className="border border-atx-ink text-atx-blue px-3 py-1 text-[11px] flex items-center gap-[5px] font-atx-mono">
                      top {100 - data.percentile}%
                    </span>
                  )}
                </div>

                {/* Earned badges at a glance */}
                {earnedBadges.length > 0 && (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {earnedBadges.map(b => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border font-atx-mono"
                        style={{ color: b.color, borderColor: b.color }}
                        title={b.desc}
                      >
                        {b.icon} {b.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Linked wallets */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {evmAddress && (
                    <span className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-medium border border-atx-ink/25 text-atx-ink/60 font-atx-mono">
                      <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink shrink-0" />
                      EVM · {shortAddr(wallet)}
                    </span>
                  )}
                </div>

                {/* Public profile link */}
                {wallet && (
                  <div className="mt-3">
                    <Link
                      href={`/${wallet}`}
                      className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-atx-blue no-underline font-atx-mono uppercase tracking-[0.06em]"
                    >
                      <ChevronRight size={12} />
                      View public profile
                    </Link>
                  </div>
                )}
              </div>

              {/* Score + timeline */}
              <div className="text-right min-w-[180px] pt-1 shrink-0 max-sm:min-w-0 max-sm:w-full max-sm:text-left">
                {data ? (
                  <>
                    <AnimatedScore
                      value={score}
                      className="text-[56px] font-bold text-atx-blue font-atx-mono tracking-[-2px] leading-none block"
                    />
                    <div className="text-[11px] text-atx-ink/55 mt-1 font-atx-mono">of {maxScore} pts · {tier} tier</div>
                    {data.timeline && data.timeline.length > 1 && (
                      <div className="mt-3 h-9 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data.timeline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#006FCC" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="#006FCC" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <RechartsTooltip
                              contentStyle={{ background: '#111111', border: '1px solid #111', borderRadius: 0, fontSize: 11, color: 'rgba(255,255,255,0.85)', padding: '4px 10px' }}
                              itemStyle={{ color: '#4d9fff' }}
                              formatter={(v: number) => [v, 'score']}
                              labelFormatter={(l: string) => l}
                            />
                            <Area type="monotone" dataKey="score" stroke="#006FCC" strokeWidth={1.5} fill="url(#scoreGrad)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className={['text-[18px] font-bold text-atx-mesquite font-atx-mono tracking-[-0.5px] leading-none', (data.timeline?.length ?? 0) > 1 ? 'mt-2' : 'mt-4'].join(' ')}>
                      ${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-atx-ink/55 mt-[3px] font-atx-mono">Est. annual earnings</div>
                  </>
                ) : loading ? (
                  <div className="text-[13px] text-atx-ink/55 font-atx-mono">Loading…</div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="border-t border-atx-ink bg-atx-panel/60">
            <div className="flex items-stretch overflow-x-auto">
              {[
                { label: 'Attribution score', value: score > 0 ? `${score} / ${maxScore}` : '—', highlight: true },
                { label: 'Percentile',   value: data ? `${data.percentile}th` : '—' },
                { label: 'First seen',   value: data?.firstSeen ?? '—' },
                { label: 'Chains',       value: data?.chains != null ? String(data.chains) : '—' },
                { label: 'Network size', value: `${data?.treeSize ?? 0} wallets` },
                { label: 'Character',    value: data?.character ? `${data.character.icon} ${data.character.label}` : '—', characterColor: data?.character?.color },
              ].map(({ label, value, highlight, characterColor }, i, arr) => (
                <div
                  key={label}
                  className={[
                    'flex flex-col gap-[3px] px-5 py-3.5 shrink-0',
                    i < arr.length - 1 ? 'border-r border-atx-ink/15' : '',
                    highlight ? 'bg-atx-bone border-t-2 border-t-atx-blue -mt-px' : '',
                  ].join(' ')}
                >
                  <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-atx-ink/55 whitespace-nowrap font-atx-mono">{label}</span>
                  <span
                    className="text-sm font-semibold whitespace-nowrap font-atx-mono"
                    style={{ color: characterColor ?? (highlight ? 'var(--color-atx-blue)' : 'var(--color-atx-ink)') }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Invite banner ───────────────────────────────────────────────────── */}
      <div className="max-w-[960px] mx-auto px-8 max-sm:px-5 mt-4 mb-1">
        <div
          className="bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-coral px-5 py-[14px] flex items-center justify-between gap-4 cursor-pointer transition-shadow duration-150 hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]"
          onClick={() => {
            setActiveTab('invite')
            setTimeout(() => document.getElementById('profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-atx-ink flex items-center justify-center text-atx-coral shrink-0">
              <Share2 size={16} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-atx-ink">
                Invite friends to Mintware
              </div>
              <div className="text-[11px] text-atx-ink/55 font-atx-mono">
                Share your link — every active referral boosts your Sharing score
              </div>
            </div>
          </div>
          <div className="shrink-0 px-4 py-[7px] bg-atx-blue border border-atx-ink text-white text-[12px] font-semibold whitespace-nowrap font-atx-mono uppercase tracking-[0.05em]">
            Share link →
          </div>
        </div>
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────────── */}
      <div id="profile-tabs" className="pt-5 bg-transparent">
        <div className="max-w-[960px] mx-auto px-8 max-sm:px-5">
          <div className="flex gap-0 border border-atx-ink w-fit max-sm:flex-wrap max-sm:w-full">
            {([
              { id: 'portfolio', icon: <BarChart2 size={13} />, label: 'Portfolio' },
              { id: 'score',     icon: <Zap size={13} />,       label: 'Score' },
              { id: 'badge',     icon: <Award size={13} />,     label: 'Badge' },
              { id: 'invite',    icon: <Share2 size={13} />,    label: 'Invite' },
              { id: 'rewards',   icon: <Coins size={13} />,     label: 'Rewards' },
              { id: 'liquidity', icon: <Droplets size={13} />,  label: 'Liquidity' },
            ] as { id: Tab; icon: React.ReactNode; label: string }[]).map(({ id, icon, label }, i) => (
              <div
                key={id}
                className={[
                  'px-[18px] py-2 text-[12px] font-atx-mono uppercase tracking-[0.06em] cursor-pointer transition-colors duration-150 select-none',
                  i > 0 ? 'border-l border-atx-ink' : '',
                  'max-sm:px-3.5 max-sm:py-1.5 max-sm:text-[11px]',
                  activeTab === id
                    ? 'text-white bg-atx-blue font-semibold'
                    : 'text-atx-ink/60 bg-transparent hover:text-atx-ink hover:bg-atx-panel',
                ].join(' ')}
                onClick={() => setActiveTab(id)}
              >
                <span className="inline mr-[5px] align-text-top">{icon}</span>{label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
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
                <PortfolioTab data={data} loading={loading} />
              )}
              {activeTab === 'score' && (
                <ScoreTab
                  data={data}
                  loading={loading}
                  wallet={wallet}
                  score={score}
                  maxScore={maxScore}
                  tier={tier}
                  refStats={refStats}
                  inviteLink={inviteLink}
                  setActiveTab={setActiveTab}
                />
              )}
              {activeTab === 'badge' && (
                <BadgeTab
                  data={data}
                  loading={loading}
                  score={score}
                  maxScore={maxScore}
                  tier={tier}
                  badges={badges}
                  earnedBadges={earnedBadges}
                />
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
              {activeTab === 'liquidity' && (
                <LiquidityTab wallet={wallet} />
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
