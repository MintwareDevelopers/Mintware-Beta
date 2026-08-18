'use client'

// /app/account — the retail home: Account + Profile MESHED into one stats-forward
// page. Leads with account info (balance, holdings, spend) and SPRINKLES Attribution
// through the stats rather than giving it its own big section. Real data: the
// Attribution score + signals + referrals + profile meta/edit (same as the old
// Profile). Illustrative: balance / positions / card (vaults in testing on Base
// Sepolia; card settlement engine off-chain but deploy-gated). Profile now redirects
// here; the detailed reputation/portfolio/invite views live in the tabs below.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, ChevronRight, BarChart2, Droplets, Share2 } from 'lucide-react'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { scoreApiUrl } from '@/lib/web2/api'
import { computeBadges } from '@/lib/rewards/badges'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { ProfileEditPanel } from '@/components/rewards/profile/ProfileEditPanel'
import { AttestationBadge } from '@/components/rewards/profile/AttestationBadge'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { PortfolioTab } from '../profile/tabs/PortfolioTab'
import { LiquidityTab } from '../profile/tabs/LiquidityTab'
import type { ScoreResponse, Tab } from '../profile/types'

const WRAP = 'max-w-[1040px] mx-auto px-6 max-sm:px-4'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft flex items-center gap-2.5'

// ── Illustrative money data (vaults in testing) ──
const POSITIONS = [
  { name: 'Growth Vault',      pair: 'ETH / USDC', deposited: '$32,000', apy: '8.1%', earned: '+$1,204.10', lock: 'Flexible',     tint: 'var(--color-pas-peri)' },
  { name: 'Matched Liquidity', pair: 'MW / ETH',   deposited: '$16,200', apy: '6.2%', earned: '+$638.30',   lock: '90-day cliff', tint: 'var(--color-pas-peach)' },
]
const SPEND = [
  { merchant: 'Blue Bottle Coffee', amt: '$6.80',  when: 'Today · 112ms' },
  { merchant: 'Uber',               amt: '$24.40', when: 'Yesterday' },
  { merchant: 'Amazon',             amt: '$88.12', when: 'Aug 12' },
  { merchant: 'Spotify',            amt: '$11.99', when: 'Aug 10' },
]

function AccountContent() {
  const { address: evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData]           = useState<ScoreResponse | null>(null)
  const [loading, setLoading]     = useState(false)
  const [copied, setCopied]       = useState(false)
  const [editOpen, setEditOpen]   = useState(false)

  const { stats: refStats, referralRecords, refCode, isFirstConnect, isLoading: refLoading } = useReferral(wallet || undefined)
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

  const score        = data?.score ?? 0
  const tier         = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const percentile   = data?.percentile ?? 0
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const mult = percentile >= 67 ? '1.5×' : percentile >= 34 ? '1.25×' : '1.0×'

  const badges       = data ? computeBadges({ walletAge: data.walletAge ?? '', percentile, totalTxCount: data.totalTxCount ?? 0, signals: data.signals ?? [], treeSize: data.treeSize ?? 0 }, data.treeSize ?? 0) : []
  const earnedBadges = badges.filter(b => b.earned)
  const signals      = data?.signals ?? []

  // Meshed stat grid — money stats sprinkled with real Attribution stats.
  const STATS: { l: string; v: string; hl?: boolean; rep?: boolean }[] = [
    { l: 'Total deposited', v: '$48,200' },
    { l: 'Blended APY',     v: '7.4%', hl: true },
    { l: 'Accrued yield',   v: '$312.40' },
    { l: 'Positions',       v: String(POSITIONS.length) },
    { l: 'Attribution',     v: data ? String(score) : '—', rep: true },
    { l: 'Percentile',      v: percentile ? `top ${100 - percentile}%` : '—', rep: true },
    { l: 'Reward mult.',    v: data ? mult : '—', rep: true, hl: true },
    { l: 'Network',         v: `${data?.treeSize ?? 0} wallets`, rep: true },
  ]

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

      {/* ── Hero: identity strip + balance ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${WRAP} pt-7 pb-[44px] max-sm:pb-[36px]`}>
          {/* slim identity row */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[42px] h-[42px] rounded-xl bg-white border border-hair grid place-items-center text-[17px] font-medium shrink-0 relative overflow-hidden text-ink">
                {meta?.avatar?.ref ? <img src={meta.avatar.ref} alt="" className="w-full h-full object-cover" /> : avatarLetter}
                <span className="absolute -bottom-[5px] -right-[5px] w-[18px] h-[18px] rounded-[6px] grid place-items-center text-white text-[9px]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))' }}>✴</span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {meta?.displayName
                    ? <span className="text-ink text-[16px] font-semibold tracking-[-0.01em]">{meta.displayName}</span>
                    : <WalletDisplay address={wallet} mono className="text-ink text-[15px] font-semibold" />}
                  {data && <span className="text-[9px] font-semibold rounded-full border border-[rgba(108,108,240,0.4)] text-peri-deep bg-[rgba(108,108,240,0.08)] px-2 py-[2px] tracking-[0.06em] uppercase">{tier}</span>}
                </div>
                <div className="text-[10.5px] text-ink-soft mt-0.5 flex items-center gap-1.5 font-mono">
                  {wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : '—'}
                  <button onClick={copyAddress} title={copied ? 'Copied!' : 'Copy'} className="inline-flex items-center justify-center w-5 h-5 rounded-md border border-hair bg-white cursor-pointer text-ink-soft hover:text-peri-deep transition-colors">
                    {copied ? <Check size={10} className="text-peri-deep" /> : <Copy size={10} />}
                  </button>
                  {data?.walletAge && <span className="max-sm:hidden">· {data.walletAge}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {wallet && <button onClick={() => setEditOpen(true)} className="glass-pill glass-pill-sm">✎ Edit</button>}
              {wallet && (
                <Link href={`/${wallet}`} className="inline-flex items-center gap-[4px] text-[11px] font-semibold text-peri-deep no-underline uppercase tracking-[0.06em]">
                  <ChevronRight size={12} />Public profile
                </Link>
              )}
            </div>
          </div>

          {/* balance */}
          <div className="flex justify-between items-end gap-8 mt-7 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Liquid Sovereign Account</div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"><span className="w-[5px] h-[5px] rounded-full bg-peri" />Preview · illustrative</span>
              </div>
              <div className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[0.9] text-[clamp(2.4rem,6.5vw,3.6rem)] mt-2.5 tabular-nums">$48,512</div>
              <div className="text-[13px] text-ink-mid mt-2.5">Earning and spendable at once · <span className="text-ink font-semibold">principal never touched</span></div>
            </div>
            <div className="flex gap-8 max-sm:gap-6 flex-wrap">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft whitespace-nowrap">Available to spend</div>
                <div className="font-atx-display font-medium text-[24px] tracking-[-0.02em] mt-1.5 tabular-nums text-peri-deep">$48,512</div>
                <div className="text-[11px] text-ink-soft mt-0.5">all of it · never locked</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft whitespace-nowrap">Reputation</div>
                <div className="font-atx-display font-medium text-[24px] tracking-[-0.02em] mt-1.5 tabular-nums text-ink">{data ? tier : '—'}</div>
                <div className="text-[11px] text-ink-soft mt-0.5">{data ? `${score} · ${mult} yield mult.` : 'connect to score'}</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6 flex-wrap">
            <Link href="/app/vaults" className="glass-pill-primary glass-pill-sm">Deposit →</Link>
            <Link href="/app/swap" className="glass-pill glass-pill-sm">Swap</Link>
            <button disabled title="Coming soon" className="text-[11px] font-semibold text-ink-soft uppercase tracking-[0.06em]">Move money · coming</button>
          </div>
        </div>
      </section>

      {/* ── Meshed stats grid (money + attribution) ── */}
      <div className="border-b border-hair-soft bg-white">
        <div className={`${WRAP} py-7`}>
          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-x-6 gap-y-5">
            {STATS.map((s) => (
              <div key={s.l} className="flex flex-col gap-[3px] min-w-0">
                <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft whitespace-nowrap flex items-center gap-1.5">
                  {s.rep && <span className="w-[5px] h-[5px] rounded-full bg-peri inline-block shrink-0" />}{s.l}
                </span>
                <span className={`font-atx-display text-[20px] font-medium whitespace-nowrap tabular-nums ${s.hl ? 'text-peri-deep' : 'text-ink'}`}>{s.v}</span>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-ink-soft mt-4">Money figures are illustrative — vaults are in testing on Base Sepolia. <span className="text-peri-deep">•</span> Attribution stats are live from your wallet.</div>
        </div>
      </div>

      {/* ── Holdings ── */}
      <div className={`${WRAP} py-8`}>
        <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Holdings · your positions</div>
        <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3 mt-5">
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
        <p className="text-[11px] text-ink-soft mt-4">Illustrative — real positions appear once you deposit into a live pool.</p>
      </div>

      {/* ── Spending · card ── */}
      <div className="border-y border-hair-soft bg-ground-cool">
        <div className={`${WRAP} py-8`}>
          <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Spending · your card</div>
          <div className="grid grid-cols-[minmax(0,340px)_1fr] max-[720px]:grid-cols-1 gap-5 mt-5 items-start">
            <div>
              <div className="rounded-[20px] p-5 aspect-[1.586] flex flex-col justify-between shadow-lift relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-peri-deep), var(--color-peri) 60%, var(--color-coral2))' }}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-white"><MintwareMark size={20} tone="inverse" /><span className="font-atx-display font-bold text-[14px] tracking-[-0.02em]">Mintware</span></span>
                  <span className="text-[9px] uppercase tracking-[0.1em] font-semibold text-white/80 border border-white/30 rounded-full px-2 py-0.5">Virtual</span>
                </div>
                <div>
                  <div className="font-mono text-white text-[16px] tracking-[0.12em]">••••  ••••  ••••  4821</div>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="text-white/85 text-[11px] uppercase tracking-[0.06em]">{meta?.displayName ?? 'Your name'}</span>
                    <span className="text-white/85 text-[11px] font-mono">05/29</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button disabled title="Coming soon" className="glass-pill glass-pill-sm flex-1">Freeze</button>
                <button disabled title="Coming soon" className="glass-pill glass-pill-sm flex-1">Limits</button>
              </div>
            </div>

            <div>
              <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-hair-soft">
                  <span className="font-atx-display font-semibold text-[13.5px] text-ink">Recent spend</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">principal untouched</span>
                </div>
                {SPEND.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-hair-soft last:border-0">
                    <span className="w-[7px] h-[7px] rounded-full bg-mw-green shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-ink truncate">{s.merchant}</div>
                      <div className="text-[10.5px] text-ink-soft">{s.when}</div>
                    </div>
                    <span className="text-[13px] tabular-nums text-ink shrink-0">{s.amt}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 max-[520px]:grid-cols-1 gap-2.5 mt-3">
                {[
                  ['Spend against, not out of', 'Your balance keeps earning while you spend against it.'],
                  ['Principal never touched', 'You draw on yield and liquidity, not your position.'],
                  ['Sub-150ms authorization', 'The same edge-auth engine that decides treasury spend.'],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-3.5">
                    <div className="font-atx-display font-semibold text-[12.5px] text-ink leading-tight">{t}</div>
                    <p className="text-[11.5px] text-ink-mid leading-[1.45] mt-1.5">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ink-soft mt-5">The card and on-chain settlement are in development — the engine exists off-chain but isn't wired to a funded relayer or live vault. Not a live card or an offer.</p>
        </div>
      </div>

      {/* ── Reputation breakdown (sprinkled, compact) ── */}
      <div className={`${WRAP} py-8`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Reputation · what your score is made of</div>
          {data?.character && (
            <span className="rounded-full border px-2.5 py-[3px] text-[11px] font-medium" style={{ color: data.character.color, borderColor: data.character.color }}>{data.character.icon} {data.character.label}</span>
          )}
        </div>
        {(earnedBadges.length > 0 || wallet) && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {earnedBadges.map(b => (
              <span key={b.id} className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-semibold border" style={{ color: b.color, borderColor: b.color }} title={b.desc}>{b.icon} {b.label}</span>
            ))}
            {wallet && <AttestationBadge attestationUid={meta?.attestationUid ?? null} address={wallet} isOwner onAttested={refetchMeta} />}
            <ProfileSocials socials={meta?.socials} className="ml-1" />
          </div>
        )}
        {signals.length > 0 ? (
          <div className="grid grid-cols-3 gap-x-7 gap-y-4 max-sm:grid-cols-1 mt-5">
            {signals.map(sig => {
              const pct = score > 0 ? Math.round((sig.score / score) * 100) : 0
              const barPct = sig.max > 0 ? Math.min(100, Math.round((sig.score / sig.max) * 100)) : 0
              return (
                <div key={sig.key}>
                  <div className="flex justify-between text-[12px] mb-1.5">
                    <span className="text-ink font-semibold">{sig.name}</span>
                    <span className="text-ink-soft">{sig.score} · {pct}%</span>
                  </div>
                  <div className="h-[8px] rounded-full bg-ground-cool border border-hair relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barPct}%`, background: sig.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-[12px] text-ink-soft mt-4">{loading ? 'Loading your reputation…' : 'Connect your wallet to see your reputation breakdown.'}</div>
        )}
        {data && (
          <div className="flex items-center gap-4 mt-6 flex-wrap">
            <AnimatedScore value={score} className="text-[38px] font-medium text-peri-deep font-atx-display tracking-[-2px] leading-none block" />
            <div className="text-[12px] text-ink-soft">Attribution score{percentile ? <> · <span className="text-coral2-deep">top {100 - percentile}%</span></> : null} · <span className="text-ink font-semibold">{mult}</span> yield multiplier{data.totalLo != null && data.totalHi != null ? <> · <span className="text-coral2-deep font-semibold">${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}</span> est. opportunity / yr</> : null}</div>
          </div>
        )}
      </div>

      {/* ── Tabs: Portfolio / Liquidity / Invite ── */}
      <div className="border-t border-hair-soft">
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
    </div>
  )
}

export default function AccountPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <AccountContent />
      </MwAuthGuard>
    </>
  )
}
