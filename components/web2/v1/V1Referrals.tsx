'use client'

// Referrals — the V1 "invite & earn" surface. Reuses the existing referral system verbatim: the
// deterministic ref code + /ref/[code] share link, and the server-gated stats (useReferral → GET
// /api/referral, which reads the referral_stats view). Dark app skin. HONEST: testnet — no real rewards
// yet; the fee-share is framed as illustrative/coming, never a promise. The browser never writes
// referral_records directly (that stays behind POST /api/referral/apply with its 24h referrer time-gate).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useReferral } from '@/lib/rewards/referral/useReferral'

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

export function V1Referrals() {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const { refCode, stats, isLoading } = useReferral(address ?? undefined)
  const [copied, setCopied] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'
  const refLink = useMemo(() => (refCode ? `${origin}/ref/${refCode}` : null), [origin, refCode])

  const copy = async () => {
    if (!refLink) return
    try {
      await navigator.clipboard.writeText(refLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — the link is still selectable in the field */ }
  }

  const share = () => {
    if (!refLink) return
    const text = encodeURIComponent(`Put idle USDG to work in curated Robinhood-Chain pools with Mintware — earn, and spend from the yield. ${refLink}`)
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  const treeSize = stats?.tree_size ?? 0
  const sharing = stats?.sharing_score ?? 0
  const quality = stats?.tree_quality != null ? Math.round(stats.tree_quality * 100) : null

  return (
    <div>
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Refer · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[24ch]">
        Bring others to the Gateway —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>share in the yield.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[56ch]" style={{ color: '#9B9BAD' }}>
        Share your link. When someone you refer puts USDG to work in a curated pool, you both earn a slice of
        the fees it generates. <span style={{ color: '#F0B45E' }}>Illustrative on testnet — rewards go live with the mainnet gateway.</span>
      </p>

      {!isConnected ? (
        <div className="rounded-[16px] p-8 mt-8 text-center" style={CARD}>
          <p className="text-[15px]" style={{ color: '#9B9BAD' }}>Connect your wallet to get your referral link and track invites.</p>
          <button
            onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })}
            className="mt-4 text-[14px] font-semibold px-5 py-3 rounded-[14px] text-white cursor-pointer"
            style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* share link */}
          <div className="rounded-[16px] p-6 mt-8" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Your referral link</div>
            <div className="flex items-stretch gap-2.5 mt-3 flex-wrap">
              <div className="flex-1 min-w-0 rounded-[12px] px-4 py-3 font-mono text-[13.5px] flex items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ ...INNER, color: '#F4F4FA' }}>
                {refLink ?? (isLoading ? 'Loading…' : '—')}
              </div>
              <button
                onClick={copy}
                disabled={!refLink}
                className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] cursor-pointer disabled:cursor-default shrink-0"
                style={{ background: copied ? 'rgba(52,211,153,0.16)' : 'rgba(138,130,244,0.16)', color: copied ? '#34D399' : '#C9C6FF' }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button
                onClick={share}
                disabled={!refLink}
                className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] text-white cursor-pointer disabled:cursor-default shrink-0"
                style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}
              >
                Share on X
              </button>
            </div>
            <div className="text-[12px] mt-3" style={{ color: '#63636F' }}>
              Your code <span className="font-mono" style={{ color: '#9B9BAD' }}>{refCode ?? '—'}</span> — it&rsquo;s tied to your wallet and never changes.
            </div>
          </div>

          {/* stats */}
          <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <StatCard k="Referrals" v={String(treeSize)} sub="wallets you brought" />
            <StatCard k="Sharing score" v={`${sharing}`} sub="of 125" accent />
            <StatCard k="Network quality" v={quality != null ? `${quality}%` : '—'} sub="active vs pending" />
          </div>
        </>
      )}

      {/* how it works */}
      <div className="rounded-[16px] p-6 mt-4" style={CARD}>
        <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>How it works</div>
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <Step n="01" t="Share your link" d="Send your /ref link to anyone. It tags their wallet to you the first time they arrive." />
          <Step n="02" t="They put USDG to work" d="When they deposit into a curated pool, the pool earns real trading fees." />
          <Step n="03" t="You both share the yield" d="A slice of those fees routes to you and to them — illustrative on testnet, live with the mainnet gateway." />
        </div>
      </div>

      <p className="text-[12px] mt-5" style={{ color: '#63636F' }}>
        Robinhood testnet · no real rewards yet — referral incentives are illustrative and go live with the
        mainnet gateway. One referrer per wallet, applied server-side with a 24h gate.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function StatCard({ k, v, sub, accent }: { k: string; v: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[24px] mt-1.5" style={{ color: accent ? '#8A82F4' : '#F4F4FA' }}>{v}</div>
      <div className="text-[11.5px] mt-0.5" style={{ color: '#63636F' }}>{sub}</div>
    </div>
  )
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#8A82F4' }}>{n}</span>
      <span>
        <span className="font-semibold text-[13.5px]">{t}</span>
        <div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#9B9BAD' }}>{d}</div>
      </span>
    </div>
  )
}
