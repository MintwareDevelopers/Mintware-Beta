'use client'

// =============================================================================
// /app/swap — cross-chain LI.FI swap (Mineral).
//
//   • The trade core is the real <SwapWidget/> (LI.FI fee-injection), front and centre.
//   • Beside it, the three things to know before you sign, then the other way to put a token to work
//     (providing liquidity to a market).
//
// Campaigns were shelved (2026-08-12) — this is a plain swap, no campaign context, points, or reward
// crediting. The human-facing "Attribution score" framing was removed 2026-08-28 (see
// attribution_review_2026_08_28 memory).
// =============================================================================

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { IconTile, Arrow } from '@/components/marketing/Story'
import { IconPrice, IconApprove, IconFailClosed, IconDepth } from '@/components/ui2/MineralIcons'

const STEPS: [string, string, ReactNode][] = [
  ['Pick what you trade', 'Choose the network, the token you pay with and the token you want.', <IconPrice key="p" size={20} />],
  ['Review before signing', 'The route, the platform fee and the network fee show here before your wallet opens.', <IconApprove key="a" size={20} />],
  ['Keep a little gas', 'Leave some of the network’s native token to cover the fee, or the swap can’t complete.', <IconFailClosed key="f" size={20} />],
]

function SwapContent() {
  return (
    <div className="font-geist text-ink overflow-x-clip">
      <div className="max-w-[1120px] mx-auto px-[clamp(16px,4vw,32px)] pt-8 pb-20">
        <div className="max-w-[640px]">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>Swap</div>
          <h1 className="m-0 mt-2 font-semibold text-[clamp(30px,4vw,44px)] leading-[1.04] tracking-[-0.04em]">
            Trade any token, <span className="text-ink-soft">at the best route.</span>
          </h1>
          <p className="mt-3 mb-0 text-[16px] leading-[1.55] text-ink-mid">LI.FI searches routes across chains and DEXs. You see the price, the fees and the network before you sign.</p>
        </div>

        <div className="mt-8 grid gap-6 items-start grid-cols-1 min-[980px]:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── The swap — dominant, front and centre ── */}
          <div className="mw-raise-lg rounded-[26px] overflow-hidden max-w-[640px] w-full mx-auto min-[980px]:mx-0">
            <Suspense fallback={<SwapSkeleton />}>
              <SwapWidget />
            </Suspense>
          </div>

          {/* ── Beside it: what to know, then the other way to use a token ── */}
          <aside className="flex flex-col gap-4">
            <div className="mw-raise rounded-[22px] p-5">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Before you sign</div>
              <ol className="mt-4 p-0 list-none flex flex-col gap-4">
                {STEPS.map(([t, d, icon]) => (
                  <li key={t} className="flex gap-3.5">
                    <IconTile>{icon}</IconTile>
                    <div><div className="font-semibold text-[15px]">{t}</div><div className="text-[13.5px] text-ink-mid leading-[1.5] mt-0.5">{d}</div></div>
                  </li>
                ))}
              </ol>
            </div>

            <Link href="/v1" className="mw-raise mw-lift relative overflow-hidden rounded-[22px] p-5 no-underline text-ink block">
              <div aria-hidden="true" className="absolute -right-16 -bottom-20 w-52 h-52 rounded-full opacity-30 blur-[40px]" style={{ background: 'var(--mw-sheen)' }} />
              <div className="relative flex items-center gap-3"><IconTile><IconDepth size={20} /></IconTile><span className="font-semibold text-[16px]">Or provide liquidity</span></div>
              <p className="relative text-[13.5px] text-ink-mid leading-[1.5] mt-3 mb-0">Put a token into a market instead and earn a share of the fee on every trade. Testnet, with mock tokens.</p>
              <span className="relative inline-flex items-center gap-1.5 mt-3 text-[14px] font-semibold" style={{ color: 'var(--mw-peri-deep)' }}>Browse markets <Arrow size={15} /></span>
            </Link>
          </aside>
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
      <Suspense fallback={<PageFallback />}>
        <SwapContent />
      </Suspense>
    </>
  )
}

function PageFallback() {
  return (
    <div className="min-h-[60vh] font-geist flex items-center justify-center text-ink-soft text-[14px]">
      Loading swap…
    </div>
  )
}

function SwapSkeleton() {
  return (
    <div className="h-[480px] flex items-center justify-center text-ink-soft text-[14px] mw-shimmer" style={{ background: 'var(--mw-well)' }}>
      Loading swap…
    </div>
  )
}
