'use client'

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API } from '@/lib/web2/api'
import { computeBadges } from '@/lib/rewards/badges'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { ProfileEditPanel } from '@/components/rewards/profile/ProfileEditPanel'
import { AttestationBadge } from '@/components/rewards/profile/AttestationBadge'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { ClaimCard } from '@/components/rewards/campaigns/ClaimCard'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { motion, AnimatePresence } from 'framer-motion'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { Copy, Check, ChevronRight, BarChart2, Coins, Droplets, Share2 } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RechartsTooltip } from 'recharts'
import { PortfolioTab } from './tabs/PortfolioTab'
import { LiquidityTab } from './tabs/LiquidityTab'
import type { ScoreResponse, Tab } from './types'

// ─── ATX tokens ─────────────────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.055'/%3E%3C/svg%3E\")"
const WRAP = 'max-w-[1040px] mx-auto px-7 max-sm:px-4'
const EY = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-grey flex items-center gap-2.5'

// ─── Profile content ────────────────────────────────────────────────────────────
function ProfileContent() {
  const { address: evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData]           = useState<ScoreResponse | null>(null)
  const [loading, setLoading]     = useState(false)
  const [copied, setCopied]       = useState(false)
  const [editOpen, setEditOpen]   = useState(false)

  const {
    stats: refStats,
    referralRecords,
    refCode,
    isFirstConnect,
    isLoading: refLoading,
  } = useReferral(wallet || undefined)

  const { meta, refetch: refetchMeta } = useProfileMeta(wallet || undefined)

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

  const score       = data?.score ?? 0
  const tier        = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const maxScore    = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925
  const percentile  = data?.percentile ?? 0
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  // Attribution multiplier by percentile bucket (see rewards.md score-multiplier table)
  const mult = percentile >= 67 ? '1.5×' : percentile >= 34 ? '1.25×' : '1.0×'

  const badges       = data ? computeBadges({ walletAge: data.walletAge ?? '', percentile, totalTxCount: data.totalTxCount ?? 0, signals: data.signals ?? [], treeSize: data.treeSize ?? 0 }, data.treeSize ?? 0) : []
  const earnedBadges = badges.filter(b => b.earned)
  const signals      = data?.signals ?? []

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'portfolio', icon: <BarChart2 size={13} />, label: 'Portfolio' },
    { id: 'rewards',   icon: <Coins size={13} />,     label: 'Rewards' },
    { id: 'liquidity', icon: <Droplets size={13} />,  label: 'Liquidity' },
    { id: 'invite',    icon: <Share2 size={13} />,    label: 'Invite' },
  ]

  return (
    <div className="min-h-screen bg-atx-bone font-atx-display text-atx-ink [&_*]:rounded-none">
      <ReferralSheet stats={refStats} trigger={isFirstConnect && !loading && !!data} />
      {editOpen && wallet && (
        <ProfileEditPanel wallet={wallet} meta={meta} onClose={() => setEditOpen(false)} onSaved={refetchMeta} />
      )}

      {/* ── BAND 1 · HERO (bone + grid) ── */}
      <div className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className={`${WRAP} pt-7 pb-7`}>
          <div className={EY}><span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink" />Your Attribution · The reputation economy</div>

          <div className="flex justify-between items-start gap-8 mt-5 flex-wrap">
            {/* identity */}
            <div className="flex gap-[18px] items-center">
              <div className="w-[76px] h-[76px] bg-atx-bone border border-atx-ink flex items-center justify-center text-[30px] font-bold font-atx-mono shrink-0 relative overflow-hidden">
                {meta?.avatar?.ref
                  ? <img src={meta.avatar.ref} alt="" className="w-full h-full object-cover" />
                  : avatarLetter}
                <span className="absolute -bottom-[9px] -right-[9px] w-[22px] h-[22px] bg-atx-acid border border-atx-ink flex items-center justify-center text-[12px] z-[1]">✴</span>
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {meta?.displayName
                    ? <span className="text-atx-ink text-[24px] font-bold tracking-[-0.02em] font-atx-display">{meta.displayName}</span>
                    : <WalletDisplay address={wallet} mono className="text-atx-ink text-[24px] font-bold tracking-[-0.02em] font-atx-mono" />}
                  {data && (
                    <span className="text-[10px] font-semibold border border-atx-blue text-atx-blue bg-atx-blue/[0.06] px-2.5 py-[3px] tracking-[0.06em] uppercase font-atx-mono">{tier} tier</span>
                  )}
                </div>
                <div className="font-atx-mono text-[11px] text-atx-grey mt-2 flex items-center gap-2 flex-wrap break-all">
                  {wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-6)}` : '—'}
                  <button onClick={copyAddress} title={copied ? 'Copied!' : 'Copy'} className="inline-flex items-center justify-center w-6 h-6 border border-atx-ink/30 bg-atx-bone cursor-pointer text-atx-grey hover:border-atx-blue hover:text-atx-blue transition-colors">
                    {copied ? <Check size={11} className="text-atx-mesquite" /> : <Copy size={11} />}
                  </button>
                  {data?.walletAge && <span>· {data.walletAge} on-chain</span>}
                </div>
                {meta?.bio && <div className="text-[13px] text-atx-ink/70 mt-2.5 max-w-[52ch] leading-[1.45]">{meta.bio}</div>}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {data?.character && (
                    <span className="border px-2.5 py-[3px] text-[11px] font-atx-mono" style={{ color: data.character.color, borderColor: data.character.color }}>{data.character.icon} {data.character.label}</span>
                  )}
                  {earnedBadges.map(b => (
                    <span key={b.id} className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border font-atx-mono" style={{ color: b.color, borderColor: b.color }} title={b.desc}>{b.icon} {b.label}</span>
                  ))}
                  {wallet && (
                    <AttestationBadge attestationUid={meta?.attestationUid ?? null} address={wallet} isOwner onAttested={refetchMeta} />
                  )}
                </div>
                <ProfileSocials socials={meta?.socials} className="mt-3" />
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  {wallet && (
                    <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-atx-ink no-underline font-atx-mono uppercase tracking-[0.06em] border border-atx-ink/30 px-2.5 py-1.5 bg-atx-bone cursor-pointer hover:border-atx-ink transition-colors">
                      ✎ Edit profile
                    </button>
                  )}
                  {wallet && (
                    <Link href={`/${wallet}`} className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-atx-blue no-underline font-atx-mono uppercase tracking-[0.06em]">
                      <ChevronRight size={12} />View public profile
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* score */}
            <div className="text-right min-w-[220px] shrink-0 max-sm:min-w-0 max-sm:w-full max-sm:text-left">
              <div className="font-atx-mono uppercase tracking-[0.14em] text-[10px] text-atx-grey">Attribution score</div>
              {data ? (
                <>
                  <div className="flex items-end justify-end gap-4 mt-1.5 max-sm:justify-start">
                    {data.timeline && data.timeline.length > 1 && (
                      <div className="w-[150px] h-[46px] max-sm:hidden">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data.timeline} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <defs><linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#006FCC" stopOpacity={0.3} /><stop offset="95%" stopColor="#006FCC" stopOpacity={0} /></linearGradient></defs>
                            <RechartsTooltip contentStyle={{ background: '#111111', border: '1px solid #111', borderRadius: 0, fontSize: 11, color: 'rgba(255,255,255,0.85)', padding: '4px 10px' }} itemStyle={{ color: '#4d9fff' }} formatter={(v: number) => [v, 'score']} labelFormatter={(l: string) => l} />
                            <Area type="monotone" dataKey="score" stroke="#006FCC" strokeWidth={1.5} fill="url(#scoreGrad)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <AnimatedScore value={score} className="text-[62px] font-bold text-atx-blue font-atx-mono tracking-[-3px] leading-[0.82] block" />
                  </div>
                  <div className="font-atx-mono text-[12px] text-atx-grey mt-2">
                    of {maxScore} · <span className="text-atx-ink font-semibold">{tier}</span>{percentile ? <> · <span className="text-atx-mesquite">top {100 - percentile}%</span></> : null} · <span className="text-atx-ink font-semibold">{mult}</span> multiplier
                  </div>
                  {data.totalLo != null && data.totalHi != null && (
                    <div className="font-atx-mono text-[13px] text-atx-mesquite font-bold mt-3">${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}<span className="text-atx-grey font-normal"> est. opportunity / yr</span></div>
                  )}
                </>
              ) : loading ? (
                <div className="text-[13px] text-atx-grey font-atx-mono mt-2">Loading…</div>
              ) : (
                <div className="text-[13px] text-atx-grey font-atx-mono mt-2">Connect to see your score.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BAND 2 · REPUTATION (blue tint) ── */}
      <div className="border-b border-atx-ink bg-atx-blue/[0.045]">
        <div className={`${WRAP} py-7`}>
          <div className="flex gap-0 flex-wrap mb-7">
            {[
              { l: 'Reward multiplier', v: mult, hl: true },
              { l: 'Percentile', v: percentile ? `top ${100 - percentile}%` : '—' },
              { l: 'Chains', v: data?.chains != null ? String(data.chains) : '—' },
              { l: 'Txns', v: data?.totalTxCount != null ? String(data.totalTxCount) : '—' },
              { l: 'Network', v: `${data?.treeSize ?? 0} wallets` },
              { l: 'First seen', v: data?.firstSeen ?? '—' },
            ].map((s, i, arr) => (
              <div key={s.l} className={`flex flex-col gap-[3px] pr-6 mr-6 ${i < arr.length - 1 ? 'border-r border-atx-ink/15' : ''}`}>
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.08em] text-atx-grey whitespace-nowrap">{s.l}</span>
                <span className={`font-atx-mono text-[17px] font-bold whitespace-nowrap ${s.hl ? 'text-atx-blue' : ''}`}>{s.v}</span>
              </div>
            ))}
          </div>

          <div className={`${EY} mb-4`}><span className="w-[9px] h-[9px] bg-atx-blue border border-atx-ink" />What your score is made of · six signals</div>
          {signals.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-7 gap-y-4 max-sm:grid-cols-1">
              {signals.map(sig => {
                const pct = score > 0 ? Math.round((sig.score / score) * 100) : 0
                const barPct = sig.max > 0 ? Math.min(100, Math.round((sig.score / sig.max) * 100)) : 0
                return (
                  <div key={sig.key}>
                    <div className="flex justify-between font-atx-mono text-[12px] mb-1.5">
                      <span className="text-atx-ink/70 font-semibold">{sig.name}</span>
                      <span className="text-atx-grey">{sig.score} · {pct}%</span>
                    </div>
                    <div className="h-[8px] border border-atx-ink bg-atx-bone relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0" style={{ width: `${barPct}%`, background: sig.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="font-atx-mono text-[12px] text-atx-grey">Connect your wallet to see your reputation breakdown.</div>
          )}
        </div>
      </div>

      {/* ── TABS + CONTENT ── */}
      <div className={WRAP}>
        <div className="flex gap-7 border-b border-atx-ink mt-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-[6px] py-4 -mb-px border-b-2 font-atx-mono text-[13px] tracking-[0.04em] cursor-pointer transition-colors ${activeTab === t.id ? 'text-atx-blue font-semibold border-atx-blue' : 'text-atx-ink/55 border-transparent hover:text-atx-ink'}`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="pt-6 pb-20">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {activeTab === 'portfolio' && <PortfolioTab data={data} loading={loading} hasWallet={!!wallet} />}
              {activeTab === 'rewards'   && <ClaimCard wallet={wallet} />}
              {activeTab === 'liquidity' && <LiquidityTab wallet={wallet} />}
              {activeTab === 'invite'    && (
                <InviteTab wallet={wallet} refCode={refCode} stats={refStats} referralRecords={referralRecords} isLoading={refLoading} />
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
