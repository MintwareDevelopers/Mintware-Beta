'use client'

// Team · Swap — treasury swap inside the terminal shell. Reuses the REAL LI.FI
// <SwapWidget/> (same fee-injecting router as the retail app), so unlike the rest
// of the terminal this surface is genuinely LIVE, not illustrative. A treasury
// rebalances assets here; larger moves route through Policy & Approvals.

import Link from 'next/link'
import { Suspense } from 'react'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'

export default function TeamSwap() {
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-medium text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Swap</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(22,163,74,0.3)] text-mw-green px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-mw-green" />Live</span>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Rebalance treasury assets across chains with best-execution routing (LI.FI). This is the same live router as the retail app — larger moves and new destinations route through <Link href="/app/team/policy" className="text-peri-deep font-medium no-underline">Policy &amp; Approvals</Link> first.</p>

      <div className="grid grid-cols-[minmax(0,440px)_1fr] max-[880px]:grid-cols-1 gap-6 mt-6 items-start">
        <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-4">
          <Suspense fallback={<div className="h-[420px] rounded-xl bg-ground-cool mw-shimmer" />}>
            <SwapWidget />
          </Suspense>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { t: 'Best-execution routing', d: 'Quotes aggregate across DEXs and bridges; the treasury takes the best net route, fees included.' },
            { t: 'Every swap builds Attribution', d: 'Treasury trades count toward your organization’s on-chain reputation — the same signal that ranks contributors.' },
            { t: 'Policy-gated at size', d: 'Swaps within a signer’s limit clear instantly; larger moves collect the quorum before they execute.' },
          ].map((c) => (
            <div key={c.t} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-4">
              <div className="font-atx-display font-semibold text-[14px] text-ink">{c.t}</div>
              <p className="text-[13px] text-ink-mid leading-[1.5] mt-1.5">{c.d}</p>
            </div>
          ))}
          <p className="text-[11px] text-ink-soft mt-1">The swap router is live. Treasury-level policy gating (quorum on large moves) is illustrated in Policy &amp; Approvals and lands with the governance stack.</p>
        </div>
      </div>
    </>
  )
}
