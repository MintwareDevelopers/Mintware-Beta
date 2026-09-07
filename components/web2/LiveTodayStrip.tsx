'use client'

// A slim, tasteful "what's live" pointer — the one honest bridge from the V2 vision to the live V1
// product (the LP Gateway at /v1). Purely ADDITIVE: it sits between sections and never replaces any
// page content. Idle-buffer framing, testnet-honest, one click to the live app.

import Link from 'next/link'

export function LiveTodayStrip() {
  return (
    <section className="bg-ground border-y border-hair-soft">
      <Link
        href="/v1"
        className="group mx-auto max-w-[1120px] px-7 max-[640px]:px-[18px] py-[13px] flex items-center justify-center gap-x-3 gap-y-1.5 flex-wrap text-center no-underline"
      >
        <span className="live-chip shrink-0"><span className="dot" aria-hidden />Live now</span>
        <span className="text-[13.5px] text-ink-mid leading-[1.5]">
          The first piece is on-chain — the <b className="text-ink font-semibold">LP Gateway</b>: put USDG to
          work in curated Robinhood Chain pools.<span className="text-ink-soft"> In testing · testnet.</span>
        </span>
        <span className="text-[13.5px] font-semibold text-peri-deep whitespace-nowrap group-hover:underline">
          Explore →
        </span>
      </Link>
    </section>
  )
}
