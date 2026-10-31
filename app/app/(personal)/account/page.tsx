'use client'

// /app/account — the retail home (Mineral). Reads top to bottom as one account: who you are → what you hold and
// where it sits → your market positions → your card → your organizations → portfolio / invite detail.
// The human-facing Attribution score/tier display was removed 2026-08-28 (see attribution_review_2026_08_28
// memory) — `scoreApiUrl()` is still fetched because the SAME response carries real portfolio data
// (`projects`/`uvOpportunities`) consumed by the Portfolio tab below; don't remove the fetch without re-plumbing
// that. Money figures above the tabs are examples (markets are on testnet; the card is in development), and
// every one of those blocks says so.

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { YourOrgs } from '@/components/web2/YourOrgs'
import { MineralMark } from '@/components/ui2/MineralMark'
import { IconCard, IconDepth, IconHolders, IconLimit, IconFailClosed, IconExit } from '@/components/ui2/MineralIcons'
import { IconTile, Arrow } from '@/components/marketing/Story'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { scoreApiUrl } from '@/lib/web2/api'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { ProfileEditPanel } from '@/components/rewards/profile/ProfileEditPanel'
import { ReferralSheet } from '@/components/rewards/referral/ReferralSheet'
import { InviteTab } from '@/components/rewards/referral/InviteTab'
import { PortfolioTab } from '../profile/tabs/PortfolioTab'
import type { ScoreResponse, Tab } from '../profile/types'

const WRAP = 'max-w-[1080px] mx-auto px-[clamp(16px,4vw,32px)]'
const LABEL = 'text-[12px] uppercase tracking-[0.08em] font-semibold text-ink-soft'

// ── Example money data (markets on testnet, card in development) ──
const POSITIONS = [
  { pair: ['TSLA', 'USDG'], tint: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', ink: '#2E2BA8', chain: 'Robinhood Chain', status: 'Testnet', value: 2431.2, putIn: 2300, fees: 58.42 },
  { pair: ['WCP7', 'dUSD'], tint: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', ink: '#2F5A1E', chain: 'Base Sepolia', status: 'Testnet demo', value: 1020, putIn: 1000, fees: 12.1 },
]
const CARD_BALANCE = 480
const SPEND = [
  { merchant: 'Blue Bottle Coffee', amt: 6.8, when: 'Today' },
  { merchant: 'Uber', amt: 24.4, when: 'Yesterday' },
  { merchant: 'Amazon', amt: 88.12, when: 'Oct 22' },
  { merchant: 'Spotify', amt: 11.99, when: 'Oct 20' },
]

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function Chip({ children, tone = 'band', tex }: { children: ReactNode; tone?: 'band' | 'live' | 'plain'; tex?: 'dots' | 'hatch' }) {
  const cls = tone === 'live' ? 'bg-[#E3F4EA] text-[#0F7A43]' : tone === 'plain' ? 'bg-white text-ink-mid' : 'bg-[#EDE9FB] text-[#4B2FA0]'
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap ${cls} ${tex ? `mw-tex-${tex}` : ''}`}>
    {tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{children}
  </span>
}

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

  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const inMarkets = POSITIONS.reduce((s, p) => s + p.value, 0)
  const total = inMarkets + CARD_BALANCE
  const fees = POSITIONS.reduce((s, p) => s + p.fees, 0)

  const TABS: { id: Tab; icon: ReactNode; label: string }[] = [
    { id: 'portfolio', icon: <IconDepth size={16} />, label: 'Wallet portfolio' },
    { id: 'invite',    icon: <IconHolders size={16} />, label: 'Invite' },
  ]

  return (
    <div className="font-geist text-ink overflow-x-clip pb-20">
      {/* Don't auto-pop the "share to grow your Sharing score" sheet at a brand-new, zero-activity
          wallet — it reads as "refer friends" before they've done anything. Only surface it once
          there's sharing traction to build on; new users still reach it via the Invite tab. */}
      <ReferralSheet stats={refStats} trigger={isFirstConnect && !loading && !!data && (refStats?.sharing_score ?? 0) > 0} />
      {editOpen && wallet && (
        <ProfileEditPanel wallet={wallet} meta={meta} onClose={() => setEditOpen(false)} onSaved={refetchMeta} />
      )}

      <div className={`${WRAP} pt-8 flex flex-col gap-6`}>
        {/* ── 1 · Who you are ── */}
        <section className="mw-raise rounded-[22px] px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-full grid place-items-center text-[18px] font-semibold shrink-0 relative overflow-hidden" style={{ background: 'var(--mw-sheen)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.5)' }}>
              {meta?.avatar?.ref ? <img src={meta.avatar.ref} alt="" className="w-full h-full object-cover" /> : avatarLetter}
            </div>
            <div className="min-w-0">
              {meta?.displayName
                ? <div className="text-[17px] font-semibold tracking-[-0.01em] truncate">{meta.displayName}</div>
                : <WalletDisplay address={wallet} mono className="text-ink text-[16px] font-semibold" />}
              <div className="text-[12.5px] text-ink-soft mt-0.5 flex items-center gap-1.5 font-geist-mono">
                {wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : 'No wallet connected'}
                {wallet && (
                  <button onClick={copyAddress} aria-label={copied ? 'Copied' : 'Copy address'} className="inline-flex items-center justify-center w-6 h-6 rounded-md border-0 cursor-pointer text-ink-soft hover:text-peri-deep transition-colors" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                    {copied ? <Check size={11} className="text-peri-deep" /> : <Copy size={11} />}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <ProfileSocials socials={meta?.socials} />
            {wallet && <button onClick={() => setEditOpen(true)} className="mw-btn-quiet !min-h-[40px]">Edit profile</button>}
          </div>
        </section>

        {/* ── 2 · What you hold, and where it sits ── */}
        <section className="mw-raise-lg relative overflow-hidden rounded-[28px] p-[clamp(22px,3.4vw,36px)]">
          <div aria-hidden="true" className="absolute -right-[120px] -top-[140px] w-[420px] h-[420px] rounded-full opacity-30 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
          <div className="relative flex items-center gap-2.5 flex-wrap">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>Your account</span>
            <Chip>Preview · example figures</Chip>
          </div>
          <div className="relative mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="font-geist-mono text-[clamp(40px,6vw,60px)] leading-none tracking-[-0.04em]">{usd(total)}</div>
              <div className="text-[15px] text-ink-mid mt-3">Across {POSITIONS.length} market positions and your card balance · <span className="font-geist-mono" style={{ color: 'var(--mw-gain)' }}>+{usd(fees)}</span> in fees so far</div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/v1" className="mw-btn !min-h-[48px] !px-5">Add liquidity <Arrow size={16} /></Link>
              <Link href="/app/swap" className="mw-btn-quiet !min-h-[48px]">Swap</Link>
              <button disabled title="Coming soon" className="mw-btn-quiet mw-tex-hatch !min-h-[48px] cursor-default opacity-80 !text-ink-mid">Move money · soon</button>
            </div>
          </div>

          {/* Where it sits: solid = in markets (testnet), dotted = card balance (in development). */}
          <div className="relative mt-7">
            <div className="h-4 rounded-full overflow-hidden flex gap-[3px] p-[3px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${(inMarkets / total) * 100}%`, background: '#7C7AF0' }} />
              <div className="h-full rounded-full mw-tex-dots" style={{ width: `${(CARD_BALANCE / total) * 100}%`, backgroundColor: '#E1DBFA' }} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-[13px] text-ink-mid">
              <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-[4px]" style={{ background: '#7C7AF0' }} />In markets <span className="font-geist-mono text-ink">{usd(inMarkets)}</span></span>
              <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-[4px] mw-tex-dots" style={{ backgroundColor: '#E1DBFA' }} />Card balance <span className="font-geist-mono text-ink">{usd(CARD_BALANCE)}</span> <span className="text-ink-soft">· in development</span></span>
            </div>
          </div>
        </section>

        {/* ── 3 · Market positions ── */}
        <section>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div><div className={LABEL}>Market positions</div><div className="text-[22px] font-semibold tracking-[-0.02em] mt-1">Where your liquidity is working</div></div>
            <Link href="/v1" className="inline-flex items-center gap-1.5 text-[14px] font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>Browse markets <Arrow size={15} /></Link>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {POSITIONS.map((p) => (
              <Link key={p.pair[0]} href="/v1" className="mw-raise mw-lift rounded-[22px] p-5 no-underline text-ink block">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex shrink-0">
                      <span className="relative z-[1] w-10 h-10 rounded-full grid place-items-center text-[11.5px] font-bold" style={{ background: p.tint, color: p.ink, boxShadow: 'inset 0 1px 0 #fff, 0 0 0 3px #fff' }}>{p.pair[0].slice(0, 2)}</span>
                      <span className="-ml-2.5 w-10 h-10 rounded-full grid place-items-center text-[11px] font-bold" style={{ background: '#E9F3EE', color: '#0F5F37', boxShadow: '0 0 0 3px #fff' }}>$</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[17px] tracking-[-0.02em] truncate">{p.pair[0]} <span className="font-medium text-ink-soft">/ {p.pair[1]}</span></div>
                      <div className="text-[12.5px] text-ink-soft">{p.chain}</div>
                    </div>
                  </div>
                  <Chip tone="live">{p.status}</Chip>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 rounded-[16px] px-4 py-3 text-[13px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                  <div><div className="text-ink-soft">Value</div><div className="font-geist-mono mt-0.5">{usd(p.value)}</div></div>
                  <div><div className="text-ink-soft">Put in</div><div className="font-geist-mono mt-0.5">{usd(p.putIn)}</div></div>
                  <div><div className="text-ink-soft">Fees</div><div className="font-geist-mono mt-0.5" style={{ color: 'var(--mw-gain)' }}>+{usd(p.fees)}</div></div>
                </div>
              </Link>
            ))}
          </div>
          <p className="text-[13px] text-ink-soft mt-3 mb-0">Example positions. Your real ones appear here once you provide to a live testnet market. Liquidity carries price risk and impermanent loss.</p>
        </section>

        {/* ── 4 · Your card ── */}
        <section className="mw-raise rounded-[26px] p-[clamp(20px,3vw,30px)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3"><IconTile><IconCard size={22} /></IconTile><div><div className={LABEL}>Your card</div><div className="text-[20px] font-semibold tracking-[-0.02em] mt-0.5">Spend from a card balance</div></div></div>
            <Chip tone="plain" tex="hatch">In development</Chip>
          </div>
          <div className="grid gap-5 mt-6 grid-cols-1 min-[820px]:grid-cols-[minmax(0,320px)_1fr] items-start">
            <div>
              <div className="relative overflow-hidden rounded-[20px] p-5 aspect-[1.586] flex flex-col justify-between text-white" style={{ background: '#4E4CD8', boxShadow: '0 0 0 1px rgba(40,36,140,.6), 0 2px 2px rgba(21,21,29,.08), 0 30px 60px -24px rgba(40,36,120,.55), inset 0 1px 0 rgba(255,255,255,.25)' }}>
                <div aria-hidden="true" className="absolute -right-16 -top-20 w-56 h-56 rounded-full blur-[40px] opacity-55" style={{ background: 'var(--mw-sheen)' }} />
                <div className="relative flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-[15px] tracking-[-0.02em]"><MineralMark size={20} />Mintware</span>
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,.16)' }}>Virtual</span>
                </div>
                <div className="relative">
                  <div className="font-geist-mono text-[15px] tracking-[0.14em]">•••• •••• •••• 4821</div>
                  <div className="flex items-center justify-between mt-2 text-[12px] opacity-85"><span className="uppercase tracking-[0.06em]">{meta?.displayName ?? 'Your name'}</span><span className="font-geist-mono">05/29</span></div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 mt-3">
                <button disabled title="Coming soon" className="mw-btn-quiet flex-1 !min-h-[40px] cursor-default opacity-70"><IconFailClosed size={16} />Freeze</button>
                <button disabled title="Coming soon" className="mw-btn-quiet flex-1 !min-h-[40px] cursor-default opacity-70"><IconLimit size={16} />Limits</button>
              </div>
            </div>

            <div className="@container flex flex-col gap-4">
              <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--mw-line)' }}>
                  <span className="font-semibold text-[14px]">Recent spend</span>
                  <span className="text-[12px] text-ink-soft">Example</span>
                </div>
                {SPEND.map((s, i) => (
                  <div key={s.merchant} className="flex items-center gap-3 px-4 py-2.5 text-[14px]" style={i ? { borderTop: '1px solid var(--mw-line)' } : undefined}>
                    <span className="w-8 h-8 rounded-full grid place-items-center text-[12px] font-semibold shrink-0 bg-white text-ink-mid" style={{ boxShadow: 'var(--mw-raise-sm)' }} aria-hidden="true">{s.merchant.charAt(0)}</span>
                    <div className="min-w-0 flex-1"><div className="font-medium truncate">{s.merchant}</div><div className="text-[12px] text-ink-soft">{s.when}</div></div>
                    <span className="font-geist-mono shrink-0">−{usd(s.amt)}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 @min-[480px]:grid-cols-3 gap-2.5">
                {([
                  ['A small card balance', 'You spend from it like any card.', <IconCard key="c" size={18} />],
                  ['Refills what you spend', 'Only that amount, within your daily limit.', <IconExit key="e" size={18} />],
                  ['Limits you control', 'Set a cap or freeze the card any time.', <IconLimit key="l" size={18} />],
                ] as [string, string, ReactNode][]).map(([t, d, icon]) => (
                  <div key={t} className="rounded-[16px] bg-white p-3.5" style={{ boxShadow: 'var(--mw-raise-sm)' }}>
                    <span style={{ color: 'var(--mw-peri-deep)' }}>{icon}</span>
                    <div className="font-semibold text-[13.5px] leading-tight mt-2">{t}</div>
                    <p className="text-[12.5px] text-ink-mid leading-[1.45] mt-1 mb-0">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[13px] text-ink-soft mt-5 mb-0">Cards will be issued with Bridge and Stripe. Not live yet: nothing here is a live card or an offer. <Link href="/cards" className="font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>How the card works</Link></p>
        </section>
      </div>

      {/* ── 5 · Organizations this wallet belongs to (renders nothing if none) ── */}
      <YourOrgs address={evmAddress} />

      {/* ── 6 · Detail: wallet portfolio / invite ── */}
      <div className={`${WRAP} mt-8`}>
        <div role="tablist" aria-label="Account detail" className="inline-flex gap-1 p-1 rounded-[14px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
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

export default function AccountPage() {
  return (
    <>
      {/* allowDisconnected: picking "I'm a person" lands here and renders a preview
          (illustrative numbers + connect prompts) instead of bouncing to '/'. */}
      <MwAuthGuard allowDisconnected>
        <AccountContent />
      </MwAuthGuard>
    </>
  )
}
