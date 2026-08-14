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

// ── "Your capital" — ILLUSTRATIVE. Vaults are in testing on Base Sepolia; there
// is no live retail position data to read yet, so this whole surface is a framed
// "Preview" demo of the funded state. The Attribution score below it is REAL.
const CAP_METRICS: { l: string; v: string; sub?: string; hl?: boolean }[] = [
  { l: 'Blended APY',    v: '7.4%',    sub: '30-day net', hl: true },
  { l: 'Accrued yield',  v: '$312.40', sub: 'claimable' },
  { l: 'Position share', v: '0.8%',    sub: 'of active TVL' },
]
const POSITIONS: { name: string; pair: string; deposited: string; apy: string; earned: string; lock: string; tint: string }[] = [
  { name: 'Growth Vault',      pair: 'ETH / USDC', deposited: '$32,000', apy: '8.1%', earned: '+$1,204.10', lock: 'Flexible',      tint: 'var(--color-pas-peri)' },
  { name: 'Matched Liquidity', pair: 'MW / ETH',   deposited: '$16,200', apy: '6.2%', earned: '+$638.30',   lock: '90-day cliff',  tint: 'var(--color-pas-peach)' },
]

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

      {/* ── YOUR CAPITAL · illustrative preview ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1040px] px-6 max-sm:px-4 py-[52px] max-sm:py-[40px]">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Your capital</div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Preview · illustrative</span>
          </div>

          <div className="flex justify-between items-end gap-8 mt-5 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Total deposited</div>
              <div className="font-atx-display font-medium text-ink tracking-[-0.03em] leading-[0.9] text-[clamp(2.6rem,7vw,4rem)] mt-2.5 tabular-nums">$48,200</div>
              <div className="text-[13px] text-ink-mid mt-3">Across 2 vault positions · <span className="text-mw-green font-semibold">+$1,842</span> earned all-time</div>
            </div>
            <div className="flex gap-9 max-sm:gap-6 flex-wrap">
              {CAP_METRICS.map((m) => (
                <div key={m.l} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft whitespace-nowrap">{m.l}</div>
                  <div className={`font-atx-display font-medium text-[26px] tracking-[-0.02em] mt-1.5 tabular-nums ${m.hl ? 'text-peri-deep' : 'text-ink'}`}>{m.v}</div>
                  {m.sub && <div className="text-[11px] text-ink-soft mt-0.5">{m.sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* positions */}
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3 mt-7">
            {POSITIONS.map((p) => (
              <div key={p.name} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-[38px] h-[38px] rounded-xl shrink-0 border border-hair" style={{ background: p.tint }} />
                    <div className="min-w-0">
                      <div className="font-atx-display font-semibold text-[15px] text-ink truncate">{p.name}</div>
                      <div className="text-[11px] text-ink-soft mt-0.5 font-mono">{p.pair}</div>
                    </div>
                  </div>
                  <span className="text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full bg-ground-cool text-ink-soft px-2 py-1 shrink-0">{p.lock}</span>
                </div>
                <div className="flex items-end justify-between gap-4 mt-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">Deposited</div>
                    <div className="font-atx-display font-medium text-[19px] text-ink tabular-nums mt-0.5">{p.deposited}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">APY · earned</div>
                    <div className="text-[13px] mt-0.5"><span className="text-peri-deep font-semibold tabular-nums">{p.apy}</span> <span className="text-mw-green font-semibold tabular-nums">{p.earned}</span></div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 mt-6 flex-wrap">
            <Link href="/app/vaults" className="glass-pill glass-pill-sm">Browse vaults →</Link>
            <button disabled title="Coming soon" className="text-[11px] font-semibold text-ink-soft uppercase tracking-[0.06em] inline-flex items-center gap-1.5">Claim yield · coming</button>
          </div>
          <p className="text-[11px] text-ink-soft mt-5">Illustrative preview. Vaults are in testing on Base Sepolia — these positions and figures are a mockup of the funded state, not live balances or an offer. Your Attribution score below is real.</p>
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
