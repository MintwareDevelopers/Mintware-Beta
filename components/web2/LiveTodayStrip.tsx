'use client'

// A slim status pointer from the V2 vision to current MarketEngine testnet work.

import Link from 'next/link'

export function LiveTodayStrip() {
  return (
    <section className="bg-ground border-y border-hair-soft">
      <Link
        href="/proof"
        className="group mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[13px] flex items-center justify-center gap-x-3 gap-y-1.5 flex-wrap text-center no-underline"
      >
        <span className="live-chip shrink-0"><span className="dot" aria-hidden />Testnet · unaudited</span>
        <span className="text-[13.5px] text-ink-mid leading-[1.5]">
          <b className="text-ink font-semibold">MarketEngine</b> is live on Robinhood Chain testnet with tUSDG/tPONS; adapters hold test assets without yield.
        </span>
        <span className="text-[13.5px] font-semibold text-peri-deep whitespace-nowrap group-hover:underline">
          View past testnet runs →
        </span>
      </Link>
    </section>
  )
}
