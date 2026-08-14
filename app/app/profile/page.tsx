'use client'

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import { scoreApiUrl } from '@/lib/web2/api'
import { computeBadges } from '@/lib/rewards/badges'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { ProfileEditPanel } from '@/components/rewards/profile/ProfileEditPanel'
import { AttestationBadge } from '@/components/rewards/profile/AttestationBadge'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { motion, AnimatePresence } from 'framer-motion'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { Copy, Check, ChevronRight, BarChart2, Droplets, Share2 } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RechartsTooltip } from 'recharts'
import { PortfolioTab } from './tabs/PortfolioTab'
import { LiquidityTab } from './tabs/LiquidityTab'
import type { ScoreResponse, Tab } from './types'

// Design v2 (Privy-esque).
const WRAP = 'max-w-[1040px] mx-auto px-6 max-sm:px-4'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft flex items-center gap-2.5'

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
    fetch(scoreApiUrl(wallet))
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
  const mult = percentile >= 67 ? '1.5×' : percentile >= 34 ? '1.25×' : '1.0×'

  const badges       = data ? computeBadges({ walletAge: data.walletAge ?? '', percentile, totalTxCount: data.totalTxCount ?? 0, signals: data.signals ?? [], treeSize: data.treeSize ?? 0 }, data.treeSize ?? 0) : []
  const earnedBadges = badges.filter(b => b.earned)
  const signals      = data?.signals ?? []

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'portfolio', icon: <BarChart2 size={13} />, label: 'Portfolio' },
    { id: 'liquidity', icon: <Droplets size={13} />,  label: 'Liquidity' },
    { id: 'invite',    icon: <Share2 size={13} />,    label: 'Invite' },
  ]

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink overflow-x-clip">
      <ReferralSheet stats={refStats} trigger={isFirstConnect && !loading && !!data} />
      {editOpen && wallet && (
        <ProfileEditPanel wallet={wallet} meta={meta} onClose={() => setEditOpen(false)} onSaved={refetchMeta} />
      )}

      {/* ── Hero band ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1040px] px-6 max-sm:px-4 py-[64px] max-sm:py-[44px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">On-chain reputation · your profile</div>
          <h1 className="font-atx-display font-medium text-ink mt-5 tracking-[-0.04em] leading-[1.02] text-[clamp(1.9rem,4.6vw,3.2rem)] max-w-[18ch] [text-wrap:balance]">
            Your reputation, <span className="text-peri">on-chain.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.5] mt-5 max-w-[60ch]">
            Everything your wallet has done — holding, LPing, referring — scored into one number. This is your Attribution profile.
          </p>
        </div>
      </section>

      {/* ── BAND 1 · IDENTITY ── */}
      <div className="border-b border-hair-soft bg-white">
        <div className={`${WRAP} pt-8 pb-8`}>
          <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Your Attribution · The reputation economy</div>

          <div className="flex justify-between items-start gap-8 mt-5 flex-wrap">
            {/* identity */}
            <div className="flex gap-[18px] items-center">
              <div className="w-[76px] h-[76px] rounded-2xl bg-ground-cool border border-hair flex items-center justify-center text-[30px] font-medium font-atx-display shrink-0 relative overflow-hidden text-ink">
                {meta?.avatar?.ref
                  ? <img src={meta.avatar.ref} alt="" className="w-full h-full object-cover" />
                  : avatarLetter}
                <span className="absolute -bottom-[7px] -right-[7px] w-[24px] h-[24px] rounded-[7px] grid place-items-center text-white text-[12px] z-[1]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 3px 10px rgba(108,108,240,0.35)' }}>✴</span>
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {meta?.displayName
                    ? <span className="text-ink text-[24px] font-medium tracking-[-0.02em] font-atx-display">{meta.displayName}</span>
                    : <WalletDisplay address={wallet} mono className="text-ink text-[24px] font-medium tracking-[-0.02em]" />}
                  {data && (
                    <span className="text-[10px] font-semibold rounded-full border border-[rgba(108,108,240,0.4)] text-peri-deep bg-[rgba(108,108,240,0.08)] px-2.5 py-[3px] tracking-[0.06em] uppercase">{tier} tier</span>
                  )}
                </div>
                <div className="text-[11px] text-ink-soft mt-2 flex items-center gap-2 flex-wrap break-all font-mono">
                  {wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-6)}` : '—'}
                  <button onClick={copyAddress} title={copied ? 'Copied!' : 'Copy'} className="inline-flex items-center justify-center w-6 h-6 rounded-lg border border-hair bg-white cursor-pointer text-ink-soft hover:border-[rgba(108,108,240,0.4)] hover:text-peri-deep transition-colors">
                    {copied ? <Check size={11} className="text-peri-deep" /> : <Copy size={11} />}
                  </button>
                  {data?.walletAge && <span>· {data.walletAge} on-chain</span>}
                </div>
                {meta?.bio && <div className="text-[13px] text-ink-mid mt-2.5 max-w-[52ch] leading-[1.45]">{meta.bio}</div>}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {data?.character && (
                    <span className="rounded-full border px-2.5 py-[3px] text-[11px] font-medium" style={{ color: data.character.color, borderColor: data.character.color }}>{data.character.icon} {data.character.label}</span>
                  )}
                  {earnedBadges.map(b => (
                    <span key={b.id} className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-semibold border" style={{ color: b.color, borderColor: b.color }} title={b.desc}>{b.icon} {b.label}</span>
                  ))}
                  {wallet && (
                    <AttestationBadge attestationUid={meta?.attestationUid ?? null} address={wallet} isOwner onAttested={refetchMeta} />
                  )}
                </div>
                <ProfileSocials socials={meta?.socials} className="mt-3" />
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  {wallet && (
                    <button onClick={() => setEditOpen(true)} className="glass-pill glass-pill-sm">
                      ✎ Edit profile
                    </button>
                  )}
                  {wallet && (
                    <Link href={`/${wallet}`} className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-peri-deep no-underline uppercase tracking-[0.06em]">
                      <ChevronRight size={12} />View public profile
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* score */}
            <div className="text-right min-w-[220px] shrink-0 max-sm:min-w-0 max-sm:w-full max-sm:text-left">
              <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft">Attribution score</div>
              {data ? (
                <>
                  <div className="flex items-end justify-end gap-4 mt-1.5 max-sm:justify-start">
                    {data.timeline && data.timeline.length > 1 && (
                      <div className="w-[150px] h-[46px] max-sm:hidden">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data.timeline} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <defs><linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6C6CF0" stopOpacity={0.3} /><stop offset="95%" stopColor="#6C6CF0" stopOpacity={0} /></linearGradient></defs>
                            <RechartsTooltip contentStyle={{ background: '#17171F', border: 'none', borderRadius: 12, fontSize: 11, color: 'rgba(255,255,255,0.85)', padding: '4px 10px' }} itemStyle={{ color: '#A9B6FC' }} formatter={(v: number) => [v, 'score']} labelFormatter={(l: string) => l} />
                            <Area type="monotone" dataKey="score" stroke="#6C6CF0" strokeWidth={1.5} fill="url(#scoreGrad)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <AnimatedScore value={score} className="text-[62px] font-medium text-peri-deep font-atx-display tracking-[-3px] leading-[0.82] block" />
                  </div>
                  <div className="text-[12px] text-ink-soft mt-2">
                    of {maxScore} · <span className="text-ink font-semibold">{tier}</span>{percentile ? <> · <span className="text-coral2-deep">top {100 - percentile}%</span></> : null} · <span className="text-ink font-semibold">{mult}</span> multiplier
                  </div>
                  {data.totalLo != null && data.totalHi != null && (
                    <div className="text-[13px] text-coral2-deep font-semibold mt-3">${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}<span className="text-ink-soft font-normal"> est. opportunity / yr</span></div>
                  )}
                </>
              ) : loading ? (
                <div className="text-[13px] text-ink-soft mt-2">Loading…</div>
              ) : (
                <div className="text-[13px] text-ink-soft mt-2">Connect to see your score.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BAND 2 · REPUTATION ── */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <div className={`${WRAP} py-8`}>
          <div className="grid grid-cols-6 max-[900px]:grid-cols-3 max-[420px]:grid-cols-2 gap-x-6 gap-y-4 mb-7">
            {[
              { l: 'Reward multiplier', v: mult, hl: true },
              { l: 'Percentile', v: percentile ? `top ${100 - percentile}%` : '—' },
              { l: 'Chains', v: data?.chains != null ? String(data.chains) : '—' },
              { l: 'Txns', v: data?.totalTxCount != null ? String(data.totalTxCount) : '—' },
              { l: 'Network', v: `${data?.treeSize ?? 0} wallets` },
              { l: 'First seen', v: data?.firstSeen ?? '—' },
            ].map((s) => (
              <div key={s.l} className="flex flex-col gap-[3px] min-w-0">
                <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft whitespace-nowrap">{s.l}</span>
                <span className={`font-atx-display text-[17px] font-medium whitespace-nowrap tabular-nums ${s.hl ? 'text-peri-deep' : 'text-ink'}`}>{s.v}</span>
              </div>
            ))}
          </div>

          <div className={`${EY} mb-4`}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />What your score is made of · six signals</div>
          {signals.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-7 gap-y-4 max-sm:grid-cols-1">
              {signals.map(sig => {
                const pct = score > 0 ? Math.round((sig.score / score) * 100) : 0
                const barPct = sig.max > 0 ? Math.min(100, Math.round((sig.score / sig.max) * 100)) : 0
                return (
                  <div key={sig.key}>
                    <div className="flex justify-between text-[12px] mb-1.5">
                      <span className="text-ink font-semibold">{sig.name}</span>
                      <span className="text-ink-soft">{sig.score} · {pct}%</span>
                    </div>
                    <div className="h-[8px] rounded-full bg-white border border-hair relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barPct}%`, background: sig.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[12px] text-ink-soft">Connect your wallet to see your reputation breakdown.</div>
          )}
        </div>
      </div>

      {/* ── TABS + CONTENT ── */}
      <div className={WRAP}>
        <div className="flex gap-6 max-sm:gap-3 border-b border-hair-soft mt-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none]">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-[6px] py-4 -mb-px border-b-2 text-[13px] font-medium cursor-pointer transition-colors ${activeTab === t.id ? 'text-peri-deep border-peri' : 'text-ink-mid border-transparent hover:text-ink'}`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="pt-6 pb-20">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {activeTab === 'portfolio' && <PortfolioTab data={data} loading={loading} hasWallet={!!wallet} />}
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
