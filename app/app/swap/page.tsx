'use client'

// =============================================================================
// /swap — cross-chain LI.FI swap, front and centre.
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
import { PageHero } from '@/components/web2/PageHero'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { scoreApiUrl } from '@/lib/web2/api'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

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
    <div className="page-swap bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">

        {/* ── Editorial hero ── */}
        <PageHero
          size="compact"
          eyebrow="On-chain reputation · 100+ chains"
          title={<>TRADE LIKE IT <span className="text-atx-blue">COUNTS.</span></>}
          sub="Every swap builds your Attribution score. Trade tokens across chains here; provide liquidity in the reputation-weighted vaults. One reputation carries across both."
        />

        {/* ── SWAP — dominant, front and centre. Nothing above the widget. ── */}
        <div className="max-w-[760px] mx-auto w-full px-6 pt-8 pb-3 max-[600px]:px-4 max-[600px]:pt-5 mw-reveal">
          <div className="bg-atx-panel border border-atx-ink overflow-hidden">
            <Suspense fallback={<SwapSkeleton />}>
              <SwapWidget />
            </Suspense>
          </div>

          {/* Pre-swap guidance — below the widget, not above */}
          <div className="border border-atx-ink/20 bg-atx-panel px-4 py-3 font-atx-mono text-[11px] text-atx-ink/55 leading-[1.6] mt-3">
            Review the route and fee before confirming · check you’re on the expected chain · keep some native token for the network fee.
          </div>
        </div>

        {/* ── Below & framed: reputation stat band ── */}
        <section className="border-y border-atx-ink mt-9">
          <div className="mx-auto max-w-[1180px] grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr] mw-reveal">
            {[
              {
                l: 'Your score',
                v: wallet ? (swapScore !== null ? <span key="s" className="text-atx-blue">{swapScore}</span> : '…') : '—',
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
              <div key={i} className={`px-7 py-3 max-[600px]:px-4 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
                <div className={`${LABEL} text-[9px] mb-1.5`}>{s.l}</div>
                <div className="font-bold text-[15px] tabular-nums">{s.v}</div>
                <div className="font-atx-mono text-[10px] text-atx-ink/45 mt-0.5 truncate">{s.sub}</div>
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
              className="block border border-atx-ink border-l-[3px] border-l-atx-coral bg-atx-panel px-5 py-4 transition-colors hover:bg-atx-coral/[0.06]"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Star className="w-4 h-4 text-atx-coral" />
                <span className="font-bold text-[15px] tracking-tight">Liquidity vaults</span>
                <span className="ml-auto font-atx-mono text-[16px] text-atx-coral">→</span>
              </div>
              <p className="text-[13px] text-atx-ink/55 leading-[1.5]">
                Reputation-weighted Uniswap V4 vaults — the same position earns more when your
                Attribution score is stronger. In testing on Base — explore the vaults.
              </p>
            </Link>
            <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/40 flex items-center gap-1.5 px-1 mt-6">
              <Star className="w-3 h-3" /> Powered by Attribution
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
    <div className="page-swap bg-atx-bone min-h-screen font-atx-display text-atx-ink flex items-center justify-center text-atx-ink/55 text-[13px] font-atx-mono uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}

function SwapSkeleton() {
  return (
    <div className="bg-atx-panel border border-atx-ink/20 h-[480px] flex items-center justify-center text-atx-ink/55 text-[13px] font-atx-mono uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}
