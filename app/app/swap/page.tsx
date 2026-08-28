'use client'

// =============================================================================
// /swap — cross-chain LI.FI swap, front and centre. Design v2 (Privy-esque).
//
//   • The trade core is the real <SwapWidget/> (LI.FI fee-injection).
//   • Cross-links to the reputation-weighted /vaults product.
//
// Campaigns were shelved (2026-08-12) — this is a plain swap, no campaign
// context, points, or reward crediting. The human-facing "Attribution score"
// framing/reputation stat band was removed 2026-08-28 (see
// attribution_review_2026_08_28 memory) — the vaults cross-link below still
// accurately describes the real vault-weighted reward mechanic, just without
// branding this page itself around a personal score.
// =============================================================================

import { Suspense } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'

const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'

// ─── Swap Page ─────────────────────────────────────────────────────────────────
function SwapContent() {
  return (
    <div className="page-swap bg-white min-h-screen font-atx-display text-ink overflow-x-clip">

        {/* ── Editorial hero ── */}
        <section className="bg-ground-cool border-b border-hair-soft">
          <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px] text-center">
            <span className="live-chip"><span className="dot" aria-hidden />Cross-chain · 100+ chains</span>
            <h1 className="font-atx-display font-semibold text-ink mt-5 tracking-[-0.04em] leading-[1.02] text-[clamp(2rem,5vw,3.4rem)] max-w-[16ch] mx-auto [text-wrap:balance]">
              Trade like it <span className="text-gradient-accent">counts.</span>
            </h1>
            <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.5] mt-5 max-w-[58ch] mx-auto">
              Best price across chains. Trade here, or provide liquidity in the reputation-weighted vaults.
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

        {/* ── Below & framed: the other surface ── */}
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
                Reputation-weighted Uniswap V4 vaults — the same position earns more as your
                Attribution score climbs. In testing on Base.
              </p>
            </Link>
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
