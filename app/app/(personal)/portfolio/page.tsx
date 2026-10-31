'use client'

// /app/portfolio — the Personal money home (one app, 2026-10-31). Everything on it is real: who you are, your
// market positions read from chain, the organizations you belong to, and the detail tabs (wallet holdings from the
// score API, your invite link). It replaces /app/account, whose totals, positions and card were example figures;
// the card now lives under Previews. /app/account, /app/profile and /app/referrals redirect here.
// `scoreApiUrl()` is still fetched because its response carries the wallet-holdings data the first tab shows
// (the human-facing score display was removed 2026-08-28 — see attribution_review_2026_08_28 memory).

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { AppContainer } from '@/components/web2/AppShell'
import { YourOrgs } from '@/components/web2/YourOrgs'
import { V1Portfolio } from '@/components/web2/v1/V1Portfolio'
import { IconDepth, IconHolders } from '@/components/ui2/MineralIcons'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { scoreApiUrl } from '@/lib/web2/api'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { ProfileEditPanel } from '@/components/rewards/profile/ProfileEditPanel'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { PortfolioTab } from './tabs/PortfolioTab'
import type { ScoreResponse, Tab } from './types'

function PortfolioContent() {
  const { address: evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''
  const params = useSearchParams()

  const [activeTab, setActiveTab] = useState<Tab>(params.get('tab') === 'invite' ? 'invite' : 'portfolio')
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

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const TABS: { id: Tab; icon: ReactNode; label: string }[] = [
    { id: 'portfolio', icon: <IconDepth size={16} />, label: 'Wallet holdings' },
    { id: 'invite',    icon: <IconHolders size={16} />, label: 'Invite' },
  ]

  return (
    <AppContainer>
      <div className="font-geist text-ink">
        {/* Only surface the share sheet once there's sharing traction; new wallets still reach it via Invite. */}
        <ReferralSheet stats={refStats} trigger={isFirstConnect && !loading && !!data && (refStats?.sharing_score ?? 0) > 0} />
        {editOpen && wallet && (
          <ProfileEditPanel wallet={wallet} meta={meta} onClose={() => setEditOpen(false)} onSaved={refetchMeta} />
        )}

        {/* ── Who you are (only once a wallet is connected; the positions block carries the connect prompt) ── */}
        {wallet && (
          <section className="mw-raise rounded-[22px] px-5 py-4 mb-8 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-12 h-12 rounded-full grid place-items-center text-[18px] font-semibold shrink-0 relative overflow-hidden" style={{ background: 'var(--mw-sheen)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.5)' }}>
                {meta?.avatar?.ref ? <img src={meta.avatar.ref} alt="" className="w-full h-full object-cover" /> : wallet.charAt(2).toUpperCase()}
              </div>
              <div className="min-w-0">
                {meta?.displayName
                  ? <div className="text-[17px] font-semibold tracking-[-0.01em] truncate">{meta.displayName}</div>
                  : <WalletDisplay address={wallet} mono className="text-ink text-[16px] font-semibold" />}
                <div className="text-[12.5px] text-ink-soft mt-0.5 flex items-center gap-1.5 font-geist-mono">
                  {`${wallet.slice(0, 8)}…${wallet.slice(-6)}`}
                  <button onClick={copyAddress} aria-label={copied ? 'Copied' : 'Copy address'} className="inline-flex items-center justify-center w-6 h-6 rounded-md border-0 cursor-pointer text-ink-soft hover:text-peri-deep transition-colors" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                    {copied ? <Check size={11} className="text-peri-deep" /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <ProfileSocials socials={meta?.socials} />
              <button onClick={() => setEditOpen(true)} className="mw-btn-quiet !min-h-[40px]">Edit profile</button>
            </div>
          </section>
        )}

        {/* ── Market positions, read from chain ── */}
        <V1Portfolio />

        {/* ── Organizations this wallet belongs to (renders nothing if none) ── */}
        <YourOrgs address={evmAddress} />

        {/* ── Detail: wallet holdings / invite ── */}
        {wallet && (
          <div className="mt-10">
            <div role="tablist" aria-label="Portfolio detail" className="inline-flex gap-1 p-1 rounded-[14px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
              {TABS.map(t => {
                const on = activeTab === t.id
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setActiveTab(t.id)}
                    className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-[10px] border-0 text-[14px] font-medium cursor-pointer transition-colors"
                    style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}
                  >
                    <span style={{ color: on ? 'var(--mw-peri-deep)' : 'currentColor' }}>{t.icon}</span>{t.label}
                  </button>
                )
              })}
            </div>
            <div className="pt-6">
              <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                  {activeTab === 'portfolio' && <PortfolioTab data={data} loading={loading} hasWallet={!!wallet} />}
                  {activeTab === 'invite' && (
                    <InviteTab wallet={wallet} refCode={refCode} stats={refStats} referralRecords={referralRecords} isLoading={refLoading} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </AppContainer>
  )
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioContent />
    </Suspense>
  )
}
