'use client'

// Referrals — the V1 "invite & earn" surface. Reuses the existing referral system (deterministic mw_ code +
// /ref/[code] link + server-gated referral_stats via useReferral). Presents the CONCRETE program model:
// referrer earns 20% of Mintware's 10% performance fee on referred harvests (→30% Tier 2), referee's perf
// fee drops 10%→9%. Paid in stable at harvest, never from a token or their principal. Dark app skin.
// HONEST: testnet — rewards illustrative, live with the mainnet gateway; browser never writes
// referral_records directly (POST /api/referral/apply, 24h referrer time-gate). Full spec:
// docs/developers/lp-gateway-referrals.md.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useReferral } from '@/lib/rewards/referral/useReferral'

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

// Tier-2 unlock threshold (referred TVL). Illustrative on testnet; the tier engine turns on with mainnet.
const TIER2_TVL = 250_000

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
    const text = encodeURIComponent(`Put idle USDG to work in curated Robinhood-Chain pools with Mintware — earn, and spend from the yield. ${refLink}`)
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  const treeSize = stats?.tree_size ?? 0
  const sharing = stats?.sharing_score ?? 0

  return (
    <div>
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Refer · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[24ch]">
        Bring others to the Gateway —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>share in the yield.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[60ch]" style={{ color: '#9B9BAD' }}>
        Earn <b style={{ color: '#F4F4FA' }}>20% of Mintware&rsquo;s 10% performance fee</b> on the trading fees your referrals harvest — paid in
        stable, from our revenue, <b style={{ color: '#F4F4FA' }}>never from a token or their deposit</b>. They get a fee discount too.{' '}
        <span style={{ color: '#F0B45E' }}>Illustrative on testnet — live with the mainnet gateway.</span>
      </p>

      {!isConnected ? (
        <div className="rounded-[16px] p-8 mt-8 text-center" style={CARD}>
          <p className="text-[15px]" style={{ color: '#9B9BAD' }}>Connect your wallet to get your referral link and track invites.</p>
          <button onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })} className="mt-4 text-[14px] font-semibold px-5 py-3 rounded-[14px] text-white cursor-pointer" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}>
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* share link */}
          <div className="rounded-[16px] p-6 mt-8" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Your referral link</div>
            <div className="flex items-stretch gap-2.5 mt-3 flex-wrap">
              <div className="flex-1 min-w-[180px] rounded-[12px] px-4 py-3 font-mono text-[13.5px] flex items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ ...INNER, color: '#F4F4FA' }}>
                {refLink ?? (isLoading ? 'Loading…' : '—')}
              </div>
              <button onClick={copy} disabled={!refLink} className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] cursor-pointer disabled:cursor-default shrink-0" style={{ background: copied ? 'rgba(52,211,153,0.16)' : 'rgba(138,130,244,0.16)', color: copied ? '#34D399' : '#C9C6FF' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button onClick={share} disabled={!refLink} className="text-[13.5px] font-semibold px-4 py-3 rounded-[12px] text-white cursor-pointer disabled:cursor-default shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>Share on X</button>
            </div>
            <div className="text-[12px] mt-3" style={{ color: '#63636F' }}>
              Your code <span className="font-mono" style={{ color: '#9B9BAD' }}>{refCode ?? '—'}</span> — tied to your wallet, permanent, first-referrer-wins.
            </div>
          </div>

          {/* stats */}
          <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <StatCard k="Referrals" v={String(treeSize)} sub="wallets you brought" />
            <StatCard k="Sharing score" v={`${sharing}`} sub="of 125" accent />
            <StatCard k="Est. earned" v="$0.00" sub="illustrative · live at mainnet" />
          </div>

          {/* tier progress */}
          <div className="rounded-[16px] p-6 mt-4" style={CARD}>
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="text-[13px] font-semibold" style={{ color: '#F4F4FA' }}>Tier 1 · <span style={{ color: '#8A82F4' }}>20% of our fee</span></div>
              <div className="text-[12px]" style={{ color: '#63636F' }}>Unlock Tier 2 (<span style={{ color: '#34D399' }}>30%</span>) at ${TIER2_TVL.toLocaleString()} referred TVL</div>
            </div>
            <div className="h-2.5 rounded-full mt-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div style={{ width: '4%', height: '100%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: '#4A4A55' }}>Progress is illustrative on testnet — the tier engine turns on with the mainnet gateway.</div>
          </div>
        </>
      )}

      {/* the model */}
      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <div className="rounded-[16px] p-5" style={CARD}>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>You earn</div>
          <div className="font-mono font-bold text-[26px] mt-1.5" style={{ color: '#8A82F4' }}>20%<span className="text-[15px]" style={{ color: '#63636F' }}> → 30%</span></div>
          <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#9B9BAD' }}>of our 10% performance fee on your referrals&rsquo; harvested fees (≈2% of their gross fees). 30% once you pass ${TIER2_TVL.toLocaleString()} referred TVL.</div>
        </div>
        <div className="rounded-[16px] p-5" style={CARD}>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>They save</div>
          <div className="font-mono font-bold text-[26px] mt-1.5" style={{ color: '#34D399' }}>10% → 9%</div>
          <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#9B9BAD' }}>their performance fee drops for their referred lifetime — the two-sided hook.</div>
        </div>
      </div>

      {/* how it works */}
      <div className="rounded-[16px] p-6 mt-4" style={CARD}>
        <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>How it works</div>
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <Step n="01" t="Share your link" d="Your /ref link tags a wallet to you the first time they arrive — permanent, first-referrer-wins." />
          <Step n="02" t="They put USDG to work" d="They deposit into a curated pool; the deployed liquidity earns real trading fees." />
          <Step n="03" t="You both share our fee" d="On each harvest we take 10%; you get 20% of that in stable, and their fee is discounted to 9%. Never their principal." />
        </div>
      </div>

      <p className="text-[12px] mt-5" style={{ color: '#63636F' }}>
        Robinhood testnet · rewards are illustrative and go live with the mainnet gateway · paid in stable at
        harvest, from our fee — never a token, never your referral&rsquo;s deposit. One referrer per wallet, 24h
        server-side gate, self-referral excluded.{' '}
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
