'use client'

// Referral attribution surface. The former harvest-based fee rewards are retired.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useReferral } from '@/lib/rewards/referral/useReferral'
import { GlassFrame } from './GlassFrame'

const CARD = { background: '#FFFFFF', border: '1px solid rgba(22,22,44,0.08)', boxShadow: '0 1px 2px rgba(20,20,50,0.04), 0 8px 24px -12px rgba(30,30,80,0.10)' }
const INNER = { background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(22,22,44,0.06)' }


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
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#5A57DE' }}>Refer · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[24ch]">
        Bring others to Discover —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>share a pool.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[60ch]" style={{ color: '#494957' }}>
        Referral links attribute invites and support reputation signals. <b style={{ color: '#191923' }}>Harvest-based referral rewards and performance-fee discounts are retired.</b> MarketEngine is testnet-only and unaudited.
      </p>

      {!isConnected ? (
        <div className="rounded-[16px] p-8 mt-8 text-center" style={CARD}>
          <p className="text-[15px]" style={{ color: '#494957' }}>Connect your wallet to get your referral link and track invites.</p>
          <button onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })} className="mt-4 text-[14px] font-semibold px-5 py-3 rounded-[14px] text-white cursor-pointer" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}>
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* share link */}
          <div className="rounded-[16px] p-6 mt-8" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#8A8A9E' }}>Your referral link</div>
            <div className="flex items-stretch gap-2.5 mt-3 flex-wrap">
              <div className="flex-1 min-w-[180px] rounded-[12px] px-4 py-3 font-mono text-[13.5px] flex items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ ...INNER, color: '#191923' }}>
                {refLink ?? (isLoading ? 'Loading…' : '—')}
              </div>
              <button onClick={copy} disabled={!refLink} className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] cursor-pointer disabled:cursor-default shrink-0" style={{ background: copied ? 'rgba(22,163,74,0.16)' : 'rgba(138,130,244,0.16)', color: copied ? '#16A34A' : '#4C4CD6' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button onClick={share} disabled={!refLink} className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] text-white cursor-pointer disabled:cursor-default shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>Share on X</button>
            </div>
            <div className="text-[12px] mt-3" style={{ color: '#8A8A9E' }}>
              Your code <span className="font-mono" style={{ color: '#494957' }}>{refCode ?? '—'}</span> — tied to your wallet, permanent, first-referrer-wins.
            </div>
          </div>

          {/* stats */}
          <GlassFrame className="mt-4" innerClassName="p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <StatCard k="Referrals" v={String(treeSize)} sub="wallets you brought" />
            <StatCard k="Sharing score" v={`${sharing}`} sub="of 125" accent />
            <StatCard k="Fee rewards" v="Retired" sub="no harvest-based payout" />
          </div>

          {/* tier progress */}
          <div className="rounded-[12px] p-5 mt-3" style={INNER}>
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="text-[13px] font-semibold" style={{ color: '#191923' }}>Referral attribution</div>
              <div className="text-[12px]" style={{ color: '#8A8A9E' }}>Reward tiers retired</div>
            </div>
            <div className="h-2.5 rounded-full mt-3 overflow-hidden" style={{ background: 'rgba(22,22,44,0.06)' }}>
              <div style={{ width: '4%', height: '100%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: '#A6A6B8' }}>Referral links can still attribute invitations; no referral fee payout is active.</div>
          </div>
          </GlassFrame>
        </>
      )}

      {/* the model */}
      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <div className="rounded-[16px] p-5" style={CARD}>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>Attribution</div>
          <div className="font-mono font-bold text-[26px] mt-1.5" style={{ color: '#5A57DE' }}>Referral link</div>
          <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#494957' }}>Invitations can be associated with a wallet; no fee share is paid.</div>
        </div>
        <div className="rounded-[16px] p-5" style={CARD}>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>Pool status</div>
          <div className="font-mono font-bold text-[26px] mt-1.5" style={{ color: '#16A34A' }}>Testnet</div>
          <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#494957' }}>Current contracts are unaudited; external audit gates real value.</div>
        </div>
      </div>

      {/* how it works */}
      <div className="rounded-[16px] p-6 mt-4" style={CARD}>
        <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#8A8A9E' }}>How it works</div>
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <Step n="01" t="Share your link" d="Your /ref link tags a wallet to you the first time they arrive — permanent, first-referrer-wins." />
          <Step n="02" t="They explore pools" d="Discover ranks candidate pools using market data and a risk score; ranking is not certification." />
          <Step n="03" t="Rewards are retired" d="Referral links do not pay harvest-based rewards or reduce protocol fees." />
        </div>
      </div>

      <p className="text-[12px] mt-5" style={{ color: '#8A8A9E' }}>
        Robinhood Chain testnet · unaudited · external audit gates real value.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#5A57DE', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function StatCard({ k, v, sub, accent }: { k: string; v: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-[12px] p-4" style={INNER}>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>{k}</div>
      <div className="font-mono font-bold text-[24px] mt-1.5" style={{ color: accent ? '#5A57DE' : '#191923' }}>{v}</div>
      <div className="text-[11.5px] mt-0.5" style={{ color: '#8A8A9E' }}>{sub}</div>
    </div>
  )
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#5A57DE' }}>{n}</span>
      <span>
        <span className="font-semibold text-[13.5px]">{t}</span>
        <div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#494957' }}>{d}</div>
      </span>
    </div>
  )
}
