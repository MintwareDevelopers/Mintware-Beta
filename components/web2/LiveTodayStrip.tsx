'use client'

// "Live today" strip for the V2 vision pages — surfaces what is actually SHIPPED (the LP Gateway on
// Robinhood Chain testnet) beneath each page's forward-looking hero. Idle-buffer framing (the spendable
// buffer is funded by yield, never the whole position), testnet-honest, IL disclosed. Register A voice.

import Link from 'next/link'
import { useLaunch } from '@/components/web2/LaunchModal'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

export function LiveTodayStrip() {
  const { launch } = useLaunch()
  return (
    <section className="bg-ground-cool border-y border-hair-soft">
      <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[30px]">
        <div className="soft-card p-[22px] max-[640px]:p-[18px] flex items-start justify-between gap-6 max-[760px]:flex-col">
          <div className="min-w-0">
            <div className={ey}>Live today · Robinhood Chain testnet</div>
            <p className="text-ink text-[15px] leading-[1.55] mt-2 max-w-[62ch] font-medium">
              The first piece is on-chain: the <span className="text-peri-deep font-semibold">LP Gateway</span> —
              deposit USDG, it earns as curated-pool liquidity while a spendable buffer stays liquid. You spend
              from the yield, not your position.
            </p>
            <p className="text-[12px] text-ink-soft leading-[1.5] mt-2.5 max-w-[62ch]">
              In testing on Robinhood Chain testnet, unaudited. Not a deposit or a guaranteed return; a
              liquidity position carries impermanent loss. External audit gates real value.
            </p>
          </div>
          <div className="flex gap-2.5 shrink-0 max-[760px]:w-full">
            <button onClick={() => launch()} className="glass-pill-primary whitespace-nowrap">Launch →</button>
            <Link href="/proof" className="glass-pill whitespace-nowrap no-underline">See the proof →</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
