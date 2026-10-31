'use client'

// Team · Swap — treasury swap inside the terminal shell. Reuses the REAL LI.FI
// <SwapWidget/> (same fee-injecting router as the retail app), so unlike the rest
// of the terminal this surface is genuinely LIVE, not illustrative. A treasury
// rebalances assets here; larger moves route through Policy & Approvals.

import Link from 'next/link'
import { Suspense } from 'react'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { PageHead, Note, IconTile, IconSwap, IconGrow, IconShield, IconPeople } from '@/components/web2/TeamKit'

export default function TeamSwap() {
  return (
    <>
      <PageHead
        icon={<IconSwap size={24} />}
        title="Swap"
        status={{ tone: 'live', label: 'Live' }}
        lede={<>Rebalance treasury assets across chains with best-execution routing (LI.FI). This is the same live router as the retail app; larger moves and new destinations belong in <Link href="/app/team/policy" className="font-semibold no-underline" style={{ color: 'var(--mw-peri-deep)' }}>Policy &amp; approvals</Link>.</>}
      />

      <div className="grid grid-cols-[minmax(0,460px)_1fr] max-[880px]:grid-cols-1 gap-6 mt-7 items-start">
        <div className="mw-raise-lg rounded-[28px] p-4">
          <Suspense fallback={<div className="h-[420px] rounded-[20px] mw-shimmer" style={{ background: 'var(--mw-well)' }} />}>
            <SwapWidget />
          </Suspense>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { t: 'Best-execution routing', d: 'Quotes aggregate across DEXs and bridges (LI.FI); you see the route and fee before you confirm.', icon: <IconGrow />, tone: 'mw-raise' },
            { t: 'From your connected wallet', d: 'Today this swaps from the wallet you are signed in with, not from the org treasury address.', icon: <IconPeople />, tone: 'mw-raise' },
            { t: 'Treasury-signer swaps · planned', d: 'Swapping straight from the treasury under its role caps and multisig is planned, not built yet.', icon: <IconShield />, tone: 'mw-inset mw-tex-hatch' },
          ].map((c) => (
            <div key={c.t} className={`${c.tone} rounded-[20px] p-4 flex items-start gap-3.5`}>
              <IconTile>{c.icon}</IconTile>
              <div>
                <div className="font-semibold text-[15px] text-ink">{c.t}</div>
                <p className="m-0 text-[14px] text-ink-mid leading-[1.5] mt-1">{c.d}</p>
              </div>
            </div>
          ))}
          <Note>The swap router is live. Treasury-level policy gating (approvals on large moves) is illustrated in Policy &amp; approvals and lands with the governance stack.</Note>
        </div>
      </div>
    </>
  )
}
