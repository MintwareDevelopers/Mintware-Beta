'use client'

// =============================================================================
// /swap — cross-chain LI.FI swap, front and centre. Design v2 (Privy-esque).
//
//   • The trade core is the real <SwapWidget/> (LI.FI fee-injection).
//   • Editorial hero + reputation stat band wired to the live /score API.
//   • Cross-links to the reputation-weighted /vaults product.
//
// Campaigns were shelved (2026-08-12) — this is a plain swap that still builds
// your Attribution score. No campaign context, points, or reward crediting.
// =============================================================================

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { scoreApiUrl } from '@/lib/web2/api'

const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'

// ─── Swap Page ─────────────────────────────────────────────────────────────────
function SwapContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''

  const [swapScore, setSwapScore] = useState<number | null>(null)
  const [swapTier,  setSwapTier]  = useState<string | null>(null)
  const [swapPct,   setSwapPct]   = useState<number | null>(null)

  // Attribution score for the reputation rail
  useEffect(() => {
    if (!wallet) { setSwapScore(null); setSwapTier(null); setSwapPct(null); return }
    fetch(scoreApiUrl(wallet))
      .then(r => r.json())
      .then(d => {
        setSwapScore(d.score ?? 0)
        setSwapTier(d.tier ? d.tier.charAt(0).toUpperCase() + d.tier.slice(1) : null)
        setSwapPct(typeof d.percentile === 'number' ? d.percentile : null)
      })
      .catch(() => {})
  }, [wallet])

  return (
    <div className="page-swap bg-white min-h-screen font-atx-display text-ink overflow-x-clip">

        {/* ── Editorial hero ── */}
        <section className="bg-ground-cool border-b border-hair-soft">
          <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px] text-center">
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">On-chain reputation · 100+ chains</div>
            <h1 className="font-atx-display font-medium text-ink mt-5 tracking-[-0.04em] leading-[1.02] text-[clamp(2rem,5vw,3.4rem)] max-w-[16ch] mx-auto [text-wrap:balance]">
              Trade like it <span className="text-peri">counts.</span>
            </h1>
            <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.5] mt-5 max-w-[58ch] mx-auto">
              Every swap builds your Attribution score. Trade tokens across chains here; provide liquidity in the reputation-weighted vaults. One reputation carries across both.
            </p>
          </div>
        </section>

        {/* ── SWAP — dominant, front and centre. Nothing above the widget. ── */}
        <div className="max-w-[760px] mx-auto w-full px-6 pt-8 pb-3 max-[600px]:px-4 max-[600px]:pt-5 mw-reveal">
          <div className="soft-card overflow-hidden">
            <Suspense fallback={<SwapSkeleton />}>
              <SwapWidget />
            </Suspense>
          </div>

          {/* Pre-swap guidance — below the widget, not above */}
          <div className="rounded-2xl border border-hair bg-ground-cool px-4 py-3 text-[11px] text-ink-mid leading-[1.6] mt-3">
            Review the route and fee before confirming · check you’re on the expected chain · keep some native token for the network fee.
          </div>
        </div>

        {/* ── Below & framed: reputation stat band ── */}
        <section className="border-y border-hair-soft mt-9 bg-ground-cool">
          <div className="mx-auto max-w-[1180px] grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr] mw-reveal">
            {[
              {
                l: 'Your score',
                v: wallet ? (swapScore !== null ? <span key="s" className="text-peri-deep">{swapScore}</span> : '…') : '—',
                sub: wallet ? (swapTier ?? 'attribution') : 'connect wallet',
              },
              {
                l: 'Tier',
                v: wallet ? (swapTier ?? '…') : '—',
                sub: 'attribution',
              },
              {
                l: 'Percentile',
                v: swapPct !== null ? `top ${Math.max(1, 100 - swapPct)}%` : '—',
                sub: wallet ? 'across all wallets' : 'connect wallet',
              },
              { l: 'Routing', v: 'Aggregated', sub: '0x · LI.FI' },
            ].map((s, i) => (
              <div key={i} className={`px-7 py-4 max-[600px]:px-4 ${i < 3 ? 'border-r border-hair-soft' : ''}`}>
                <div className={`${LABEL} text-[9px] mb-1.5`}>{s.l}</div>
                <div className="font-atx-display font-medium text-[15px] tabular-nums text-ink">{s.v}</div>
                <div className="text-[10px] text-ink-soft mt-0.5 truncate">{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Below & framed: the other surface + attribution ── */}
        <div className="mx-auto max-w-[1180px] px-7 py-8 max-[600px]:px-4">
          <div className="max-w-[520px]">
            <div className={`${LABEL} mb-3`}>The other surface</div>
            <Link
              href="/app/vaults"
              className="block soft-card px-5 py-4 transition-colors hover:border-[rgba(232,138,103,0.4)]"
              style={{ borderLeft: '3px solid var(--color-coral2)' }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-atx-display font-medium text-[15px] tracking-tight text-ink">Liquidity vaults</span>
                <span className="ml-auto text-[16px] text-coral2-deep">→</span>
              </div>
              <p className="text-[13px] text-ink-mid leading-[1.5]">
                Reputation-weighted Uniswap V4 vaults — the same position earns more when your
                Attribution score is stronger. In testing on Base — explore the vaults.
              </p>
            </Link>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft flex items-center gap-1.5 px-1 mt-6">
              ✴ Powered by Attribution
            </div>
          </div>
        </div>
      </div>
  )
}

export default function SwapPage() {
  // View-public: the swap widget renders for everyone; connecting is prompted at
  // trade time (connect-on-action), consistent with the public vault browse.
  return (
    <>
      <MwNav />
      <Suspense fallback={<PageFallback />}>
        <SwapContent />
      </Suspense>
    </>
  )
}

function PageFallback() {
  return (
    <div className="page-swap bg-white min-h-screen font-atx-display text-ink flex items-center justify-center text-ink-soft text-[13px] uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}

function SwapSkeleton() {
  return (
    <div className="bg-ground-cool h-[480px] flex items-center justify-center text-ink-soft text-[13px] uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}
