'use client'

// Referral attribution surface. The former harvest-based fee rewards are retired. Mineral flow: one raised share
// card (link in an inset well, copy + share), your numbers, then how attribution works — with the retired reward
// shown plainly as retired rather than as an empty progress bar.

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { LaneHeader, Label, PLAIN, INSET } from './LaneHeader'

function Glyph({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
// Two discs joined by a thread — a link between wallets.
const LinkIcon = <Glyph><ellipse cx="7" cy="9" rx="4.5" ry="2" /><path d="M2.5 9v2.2c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V9" /><ellipse cx="17" cy="15" rx="4.5" ry="2" /><path d="M12.5 15v2.2c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V15" /><path d="M11 12.5 13 13.5" strokeDasharray="1.6 2" /></Glyph>
const PeopleIcon = <Glyph><circle cx="8.5" cy="8" r="3" /><path d="M3 19c.6-3 2.8-4.8 5.5-4.8S13.4 16 14 19" /><circle cx="16.5" cy="9" r="2.5" /><path d="M15.4 14.4c.4-.1.7-.2 1.1-.2 2.3 0 4.2 1.6 4.5 4.3" /></Glyph>
const WalletIcon = <Glyph><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 9.5h18" /><ellipse cx="16.5" cy="14.2" rx="2" ry="1.1" /></Glyph>

function Tile({ children }: { children: ReactNode }) {
  return <span className="flex-none w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{children}</span>
}

export function V1Referrals() {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const { refCode, stats, isLoading } = useReferral(address ?? undefined)
  const [copied, setCopied] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'
  const refLink = useMemo(() => (refCode ? `${origin}/ref/${refCode}` : null), [origin, refCode])

  const copy = async () => {
    if (!refLink) return
    try { await navigator.clipboard.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* blocked */ }
  }
  const share = () => {
    if (!refLink) return
    const text = encodeURIComponent(`Explore curated pools on Mintware. ${refLink}`)
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  const treeSize = stats?.tree_size ?? 0
  const sharing = stats?.sharing_score ?? 0

  return (
    <div>
      <LaneHeader
        eyebrow="Refer · Robinhood Chain"
        title="Bring others"
        accent="to Discover."
        lede={<>Your referral link tags the wallets you bring and feeds your sharing score. <b style={{ color: '#15151D' }}>Harvest-based referral rewards and performance-fee discounts are retired</b>, so nothing is paid out for referrals.</>}
      />

      {!isConnected ? (
        <div className="rounded-[24px] p-8 mt-8 flex flex-wrap items-center justify-between gap-5 mw-raise-lg">
          <div className="flex gap-4 items-center">
            <Tile>{WalletIcon}</Tile>
            <div>
              <div className="font-semibold text-[17px]">Connect to get your link</div>
              <p className="text-[14.5px] mt-1 mb-0" style={{ color: '#454552' }}>Your referral code is tied to your wallet and created the moment you connect.</p>
            </div>
          </div>
          <button onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })} className="mw-btn !min-h-[48px] !px-6">
            Connect wallet
          </button>
        </div>
      ) : (
        <div className="grid gap-5 mt-8 grid-cols-1 min-[960px]:grid-cols-[1.4fr_1fr]">
          {/* share link */}
          <div className="rounded-[24px] p-6 mw-raise-lg">
            <div className="flex items-center gap-3.5">
              <Tile>{LinkIcon}</Tile>
              <div>
                <div className="font-semibold text-[17px]">Your referral link</div>
                <div className="text-[13px]" style={{ color: '#62626F' }}>Tied to your wallet, permanent, first referrer wins</div>
              </div>
            </div>
            <div className="mt-5 rounded-[14px] px-4 min-h-[50px] font-mono text-[14px] flex items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ ...INSET, color: '#15151D' }}>
              {refLink ?? (isLoading ? 'Loading…' : '—')}
            </div>
            <div className="flex gap-2.5 mt-3 flex-wrap">
              <button onClick={copy} disabled={!refLink} className="mw-btn-quiet flex-1 min-w-[120px] !min-h-[46px] disabled:opacity-50 disabled:cursor-default" style={copied ? { color: '#0F7A43' } : undefined}>{copied ? 'Copied ✓' : 'Copy link'}</button>
              <button onClick={share} disabled={!refLink} className="mw-btn flex-1 min-w-[120px] !min-h-[46px] disabled:opacity-50 disabled:cursor-default">Share on X</button>
            </div>
            <div className="text-[12.5px] mt-4" style={{ color: '#62626F' }}>
              Your code <span className="font-mono" style={{ color: '#454552' }}>{refCode ?? '—'}</span>
            </div>
          </div>

          {/* your numbers */}
          <div className="rounded-[24px] p-5 flex flex-col gap-3" style={PLAIN}>
            <div className="flex items-center gap-3 px-1 pt-1"><span style={{ color: 'var(--mw-peri-deep)' }}>{PeopleIcon}</span><span className="font-semibold text-[15px]">Your numbers</span></div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard k="Referrals" v={String(treeSize)} sub="wallets you brought" />
              <StatCard k="Sharing score" v={`${sharing}`} sub="of 125" accent />
            </div>
            <div className="rounded-[14px] px-4 py-3.5 flex items-center justify-between gap-3" style={INSET}>
              <div>
                <Label>Fee rewards</Label>
                <div className="text-[12.5px] mt-0.5" style={{ color: '#62626F' }}>No harvest-based payout</div>
              </div>
              <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: '#fff', color: '#454552', boxShadow: 'var(--mw-raise-sm)' }}>Retired</span>
            </div>
          </div>
        </div>
      )}

      {/* how it works */}
      <div className="rounded-[24px] p-6 mt-5" style={PLAIN}>
        <div className="font-semibold text-[17px]">How referrals work</div>
        <ol className="m-0 mt-5 p-0 list-none grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <Step n={1} t="Share your link" d="Your /ref link tags a wallet to you the first time it arrives — permanent, first referrer wins." />
          <Step n={2} t="They explore pools" d="Discover ranks candidate pools using market data and a risk score; ranking is not certification." />
          <Step n={3} t="Your score grows" d="Referrals count toward your sharing score. They don’t pay rewards or reduce protocol fees." />
        </ol>
      </div>

      <p className="text-[12.5px] mt-5" style={{ color: '#62626F' }}>
        Robinhood Chain testnet · unaudited · external audit gates real value.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function StatCard({ k, v, sub, accent }: { k: string; v: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] p-4" style={INSET}>
      <Label>{k}</Label>
      <div className="font-mono text-[26px] mt-1 tracking-[-0.02em]" style={{ color: accent ? '#4643D1' : '#15151D' }}>{v}</div>
      <div className="text-[12px] mt-0.5" style={{ color: '#62626F' }}>{sub}</div>
    </div>
  )
}

function Step({ n, t, d }: { n: number; t: string; d: string }) {
  return (
    <li className="flex gap-3.5 rounded-[16px] p-4" style={INSET}>
      <span className="flex-none w-8 h-8 rounded-full grid place-items-center text-[13px] font-semibold text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>{n}</span>
      <span>
        <span className="block font-semibold text-[15px]">{t}</span>
        <span className="block text-[13.5px] mt-1 leading-[1.5]" style={{ color: '#454552' }}>{d}</span>
      </span>
    </li>
  )
}
