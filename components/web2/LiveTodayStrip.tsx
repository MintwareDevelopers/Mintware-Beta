'use client'

// A slim pointer from the V2 vision to the current V1 MarketEngine product.

import Link from 'next/link'

export function LiveTodayStrip() {
  return (
    <section className="bg-ground border-y border-hair-soft">
      <Link
        href="/v1"
        className="group mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[13px] flex items-center justify-center gap-x-3 gap-y-1.5 flex-wrap text-center no-underline"
      >
        <span className="live-chip shrink-0"><span className="dot" aria-hidden />Live on testnet</span>
        <span className="text-[13.5px] text-ink-mid leading-[1.5]">
          <b className="text-ink font-semibold">MarketEngine V1</b>: quote-valued shares in curated Robinhood Chain pools.
          <span className="text-ink-soft"> Unaudited.</span>
        </span>
        <span className="text-[13.5px] font-semibold text-peri-deep whitespace-nowrap group-hover:underline">
          Explore →
        </span>
      </Link>
    </section>
  )
}
