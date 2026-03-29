'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr, fmtUSD, iconColor } from '@/lib/web2/api'
import { computeBadges } from '@/lib/rewards/badges'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { ClaimCard } from '@/components/rewards/campaigns/ClaimCard'
import { toast } from 'sonner'
import * as Progress from '@radix-ui/react-progress'
import * as Tooltip from '@radix-ui/react-tooltip'
import { BarChart2, Zap, Award, Share2, Coins, Calendar, Link2, Activity, CheckCircle2, Clock, ChevronRight, Copy, Check, Droplets } from 'lucide-react'
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
  projects?: {
    name: string
    symbol: string
    cat: string
    deployed: number
    pnl: number
    pnlPct: number
    stillActive: boolean
    holdDays: number
  }[]
  uvOpportunities: {
    name: string; cat: string; icon: string
    type: string; typeColor: string; accentColor: string
    mechanic: string; lo: number; hi: number; reason: string
  }[]
  totalLo: number
  totalHi: number
  timeline?: { date: string; score: number; events: unknown[] }[]
}

type Tab = 'portfolio' | 'score' | 'badge' | 'invite' | 'rewards' | 'liquidity'

// ─── Profile content ──────────────────────────────────────────────────────────
function ProfileContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData] = useState<ScoreResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]           = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [easAttestation, setEasAttestation] = useState<{ uid: string; eas_explorer_url: string; attested_at?: string } | null>(null)
  const [easLoading, setEasLoading]         = useState(false)
  const [lpDeposits, setLpDeposits]         = useState<Array<{ id: string; vault_id: string; usdc_amount: number; lock_tier: string; deposited_at: string; status: string; locked_until: string | null; compounded_amount: number; vault?: { id: string; name: string; project_token: string; status: string; tvl_usdc: number } }>>([])
  const [lpQueue, setLpQueue]               = useState<Array<{ id: string; vault_id: string; requested_amount: number; executable_at: string; penalty_pct: number; status: string }>>([])
  const [lpLoading, setLpLoading]           = useState(false)

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

  // Load LP positions when Liquidity tab opened
  useEffect(() => {
    if (activeTab !== 'liquidity' || !wallet || lpDeposits.length > 0 || lpLoading) return
    setLpLoading(true)
    fetch(`/api/vault?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        setLpDeposits(d.deposits ?? [])
        setLpQueue(d.withdrawal_queue ?? [])
      })
      .catch(() => {})
      .finally(() => setLpLoading(false))
  }, [activeTab, wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Address copied')
  }

  const inviteOrigin  = typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'
  const inviteLink    = refCode ? `${inviteOrigin}/ref/${refCode}` : null

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

  const score = data?.score ?? 0
  const tier = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const maxScore = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925

  // Derived badges from score data
  const badges = data
    ? computeBadges(
        {
          walletAge:    data.walletAge    ?? '',
          percentile:   data.percentile   ?? 0,
          totalTxCount: data.totalTxCount ?? 0,
          signals:      data.signals      ?? [],
          treeSize:     data.treeSize     ?? 0,
        },
        data.treeSize ?? 0,
      )
    : []
  const earnedBadges = badges.filter(b => b.earned)

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

              {/* Badge row — earned badges at a glance */}
              {earnedBadges.length > 0 && (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {earnedBadges.map(b => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-semibold border"
                      style={{
                        color:            b.color,
                        background:       b.color + '18',
                        borderColor:      b.color + '40',
                      }}
                      title={b.desc}
                    >
                      {b.icon} {b.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Public profile link */}
              {wallet && (
                <div className="mt-3">
                  <Link
                    href={`/${wallet}`}
                    className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-mw-brand no-underline"
                    style={{ fontFamily: 'var(--font-jakarta)' }}
                  >
                    <ChevronRight size={12} />
                    View public profile
                  </Link>
                </div>
              )}
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

      {/* Invite banner */}
      <div className="max-w-[960px] mx-auto px-8 max-sm:px-5 mt-4 mb-1">
        <div
          className="rounded-xl px-5 py-[14px] flex items-center justify-between gap-4 cursor-pointer"
          style={{
            background: 'var(--color-mw-brand-dim)',
            border: '1.5px solid rgba(79,126,247,0.18)',
          }}
          onClick={() => {
            setActiveTab('invite')
            setTimeout(() => document.getElementById('profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[17px] shrink-0"
              style={{ background: 'rgba(79,126,247,0.14)', color: 'var(--color-mw-brand)' }}
            >
              <Share2 size={16} />
            </div>
            <div>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)' }}>
                Invite friends to Mintware
              </div>
              <div className="text-[11px]" style={{ color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>
                Share your link — every active referral boosts your Sharing score
              </div>
            </div>
          </div>
          <div
            className="shrink-0 px-4 py-[7px] rounded-full text-[12px] font-semibold whitespace-nowrap"
            style={{ background: 'var(--color-mw-brand)', color: '#fff', fontFamily: 'var(--font-jakarta)' }}
          >
            Share link →
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div id="profile-tabs" className="pt-5 bg-transparent">
        <div className="max-w-[960px] mx-auto px-8 max-sm:px-5">
          <div className="flex gap-2 max-sm:flex-wrap max-sm:gap-1.5">
            {(['portfolio', 'score', 'badge', 'invite', 'rewards', 'liquidity'] as Tab[]).map(t => (
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
                  : t === 'rewards'
                  ? <><Coins size={13} className="inline mr-[5px] align-text-top" />Rewards</>
                  : <><Droplets size={13} className="inline mr-[5px] align-text-top" />Liquidity</>}
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
                <div className="flex flex-col gap-3">
                  {[1,2,3].map(n => (
                    <div key={n} className="mw-accent-card rounded-xl h-[64px] animate-pulse" />
                  ))}
                </div>
              )}

              {/* ── Holdings ─────────────────────────────────────────────────── */}
              {!loading && data && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3">
                      On-chain assets
                    </span>
                    {(data.projects?.length ?? 0) > 0 && (
                      <span className="text-[11px] font-bold font-mono text-mw-ink">
                        {fmtUSD(data.projects!.reduce((s, p) => s + p.deployed, 0))} total
                      </span>
                    )}
                  </div>

                  {(data.projects?.length ?? 0) === 0 ? (
                    <div className="mw-accent-card rounded-xl px-5 py-10 flex flex-col items-center text-center gap-2">
                      <div className="text-[28px] opacity-20">◆</div>
                      <div className="text-[13px] font-semibold text-mw-ink-3">No on-chain assets detected</div>
                      <div className="text-[11px] text-mw-ink-4 max-w-[240px] leading-[1.55]">
                        Hold tokens, provide liquidity, or bridge to Base — assets appear here once indexed.
                      </div>
                      <a
                        href="/swap"
                        className="mt-2 text-[11px] font-semibold text-mw-brand no-underline hover:underline"
                      >
                        Start with a swap →
                      </a>
                    </div>
                  ) : (
                    <div className="mw-accent-card rounded-xl overflow-hidden shadow-[var(--shadow-card)]">
                      {data.projects!
                        .slice()
                        .sort((a, b) => b.deployed - a.deployed)
                        .map((p, i, arr) => {
                          const ic = iconColor(p.symbol || p.name)
                          const maxDeployed = arr[0].deployed || 1
                          const barPct = Math.round((p.deployed / maxDeployed) * 100)
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-[rgba(0,0,0,0.02)]"
                              style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--color-mw-border)' : undefined }}
                            >
                              <div
                                className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[13px] font-bold shrink-0"
                                style={{ background: ic.bg, color: ic.fg }}
                              >
                                {p.symbol?.slice(0, 3) ?? p.name?.slice(0, 2)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-[3px]">
                                  <span className="text-[13px] font-semibold text-mw-ink truncate">{p.name}</span>
                                  <span className="text-[10px] text-mw-ink-4 shrink-0">{p.cat}</span>
                                  {p.stillActive && (
                                    <span className="w-[5px] h-[5px] rounded-full bg-mw-live shrink-0" title="Active position" />
                                  )}
                                </div>
                                <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--color-mw-border)' }}>
                                  <div
                                    className="h-full rounded-full transition-[width] duration-700"
                                    style={{ width: `${barPct}%`, background: ic.fg }}
                                  />
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[13px] font-bold font-mono text-mw-ink">{fmtUSD(p.deployed)}</div>
                                {p.pnlPct !== 0 ? (
                                  <div className="text-[10px] font-semibold font-mono mt-[1px]"
                                    style={{ color: p.pnlPct >= 0 ? 'var(--color-mw-live)' : 'var(--color-mw-red)' }}>
                                    {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-mw-ink-4 mt-[1px]">deployed</div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Protocol opportunities ───────────────────────────────────── */}
              {!loading && data && data.uvOpportunities?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3">
                      Matched protocols
                    </span>
                    <span className="text-[11px] text-mw-green font-mono font-bold">
                      {fmtUSD(data.totalLo)}–{fmtUSD(data.totalHi)} / yr
                    </span>
                  </div>
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
                          <div className="text-[11px] text-mw-ink-2 leading-[1.55]" dangerouslySetInnerHTML={{ __html: op.reason }} />
                        </div>
                        <div className="text-right shrink-0 pl-2">
                          <div className="text-[13px] font-bold text-mw-green font-mono">${op.lo}–${op.hi}</div>
                          <div className="text-[10px] text-mw-ink-3 mt-0.5">est. / yr</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!loading && !data && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">
                  Could not load data. The API may be indexing your wallet.
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

                  {/* Invite Friends card */}
                  <div className="mw-accent-card mt-4 rounded-xl overflow-hidden">
                    {/* Dark banner */}
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
                    {/* Actions */}
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
                      {/* Sharing score progress */}
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
            <div>
              {lpLoading ? (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading positions…</div>
              ) : lpDeposits.length === 0 && lpQueue.length === 0 ? (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">
                  No active LP positions.{' '}
                  <a href="/vaults" className="text-mw-brand font-semibold no-underline">Browse vaults →</a>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Summary row */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 4, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Total deposited', value: `$${lpDeposits.reduce((s, d) => s + d.usdc_amount, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                      { label: 'Active positions', value: String(lpDeposits.filter(d => d.status === 'active').length) },
                      { label: 'Compounded', value: `$${lpDeposits.reduce((s, d) => s + (d.compounded_amount ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="mw-card" style={{ flex: 1, minWidth: 120, padding: '12px 16px' }}>
                        <div className="text-[20px] font-bold font-mono text-mw-brand tracking-[-0.5px]">{value}</div>
                        <div className="text-[11px] text-mw-ink-3 uppercase tracking-[0.08em] font-semibold mt-[2px]">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Deposit rows */}
                  {lpDeposits.map(d => {
                    const tierColors: Record<string, string> = { flex: 'var(--color-mw-ink-3)', committed: 'var(--color-mw-brand)', aligned: 'var(--color-mw-teal)', core: 'var(--color-mw-amber)' }
                    const color = tierColors[d.lock_tier] ?? 'var(--color-mw-ink-3)'
                    const daysLeft = d.locked_until ? Math.max(0, Math.ceil((new Date(d.locked_until).getTime() - Date.now()) / 86_400_000)) : 0
                    return (
                      <a key={d.id} href={`/vault/${d.vault?.id ?? d.vault_id}`} className="mw-card no-underline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', cursor: 'pointer', textDecoration: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-mw-brand-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>⬡</div>
                          <div>
                            <div className="text-[14px] font-semibold text-mw-ink" style={{ fontFamily: 'var(--font-jakarta)' }}>
                              {d.vault?.name ?? 'Vault'}
                            </div>
                            <div className="text-[11px] text-mw-ink-4" style={{ fontFamily: 'var(--font-jakarta)', marginTop: 1 }}>
                              {d.lock_tier.charAt(0).toUpperCase() + d.lock_tier.slice(1)}
                              {daysLeft > 0 ? ` · ${daysLeft}d remaining` : ''}
                              {d.status === 'withdrawal_pending' ? ' · Withdrawing' : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="text-[16px] font-bold font-mono" style={{ color: 'var(--color-mw-brand)' }}>${d.usdc_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                          <div className="text-[11px] font-semibold" style={{ color, fontFamily: 'var(--font-jakarta)' }}>
                            {d.lock_tier === 'flex' ? '1.0×' : d.lock_tier === 'committed' ? '1.15×' : d.lock_tier === 'aligned' ? '1.3×' : '1.5×'}
                          </div>
                        </div>
                      </a>
                    )
                  })}

                  {/* Pending withdrawals */}
                  {lpQueue.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="mw-label text-mw-ink-3" style={{ marginBottom: 8 }}>Pending withdrawals</div>
                      {lpQueue.map(q => {
                        const daysLeft = Math.max(0, Math.ceil((new Date(q.executable_at).getTime() - Date.now()) / 86_400_000))
                        return (
                          <div key={q.id} className="mw-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
                            <div>
                              <div className="text-[14px] font-bold font-mono text-mw-ink">${q.requested_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                              <div className="text-[11px] text-mw-ink-4" style={{ fontFamily: 'var(--font-jakarta)', marginTop: 2 }}>
                                Executable {daysLeft === 0 ? 'today' : `in ${daysLeft}d`}
                                {q.penalty_pct > 0 ? ` · ${q.penalty_pct}% penalty` : ''}
                              </div>
                            </div>
                            <span className="mw-pill mw-pill-soon">Pending</span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <a href="/vaults" className="text-[13px] text-mw-brand font-semibold no-underline text-center block mt-2" style={{ fontFamily: 'var(--font-jakarta)' }}>
                    Browse more vaults →
                  </a>
                </div>
              )}
            </div>
          )}

          {activeTab === 'badge' && (
            <div>
              {loading && <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>}

              {!loading && !data && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Could not load badge data.</div>
              )}

              {data && (
                <>
                  {/* Character card */}
                  <div className="mw-accent-card rounded-xl px-6 py-5 mb-4 flex items-start gap-4 shadow-[var(--shadow-card)]">
                    <div
                      className="w-14 h-14 rounded-[14px] flex items-center justify-center text-[28px] shrink-0"
                      style={{ background: (data.character?.color ?? '#0052FF') + '18' }}
                    >
                      {data.character?.icon ?? '○'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-[3px] flex-wrap">
                        <span
                          className="text-[18px] font-bold tracking-[-0.3px]"
                          style={{ color: data.character?.color ?? '#0052FF' }}
                        >
                          {data.character?.label ?? tier}
                        </span>
                        <span className="text-[11px] text-mw-ink-3">{tier} tier · top {100 - data.percentile}%</span>
                      </div>
                      <div className="text-[13px] leading-[1.6] text-mw-ink-2 max-w-[480px]">
                        {data.character?.desc}
                      </div>
                    </div>
                  </div>

                  {/* Badge grid */}
                  <div className="mb-3">
                    <span className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-ink-3 mb-3 block">
                      {earnedBadges.length} of {badges.length} badges earned
                    </span>
                    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
                      {badges.map(b => (
                        <div
                          key={b.id}
                          className="mw-accent-card rounded-[14px] px-4 py-4 flex flex-col gap-2 transition-all duration-150"
                          style={{
                            opacity:     b.earned ? 1 : 0.45,
                            borderColor: b.earned ? b.color + '40' : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="text-[22px]"
                              style={{ color: b.earned ? b.color : 'var(--color-mw-ink-3)' }}
                            >
                              {b.icon}
                            </span>
                            {b.earned && (
                              <CheckCircle2 size={14} style={{ color: b.color }} />
                            )}
                          </div>
                          <div>
                            <div
                              className="text-[13px] font-bold mb-[3px]"
                              style={{ color: b.earned ? b.color : 'var(--color-mw-ink)' }}
                            >
                              {b.label}
                            </div>
                            <div className="text-[11px] text-mw-ink-3 leading-[1.4]">{b.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats strip */}
                  <div className="mw-accent-card rounded-[14px] overflow-hidden flex max-sm:flex-col">
                    {[
                      { label: 'Attribution score', value: `${score}/${maxScore}`, color: 'var(--color-mw-brand)' },
                      { label: 'Chains active', value: String(data.chains), color: 'var(--color-mw-ink)' },
                      { label: 'Network size', value: `${data.treeSize} wallets`, color: 'var(--color-mw-ink)' },
                    ].map(({ label, value, color }, i, arr) => (
                      <div
                        key={label}
                        className="flex-1 px-6 py-4 text-center"
                        style={{
                          borderRight: i < arr.length - 1 ? '1px solid var(--color-mw-border)' : undefined,
                        }}
                      >
                        <div className="text-[20px] font-bold font-mono tracking-[-0.5px]" style={{ color }}>{value}</div>
                        <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">{label}</div>
                      </div>
                    ))}
                  </div>
                </>
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
