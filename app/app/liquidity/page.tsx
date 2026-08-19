'use client'

// /app/liquidity — the "Get liquidity for your token" destination (team intake routes here).
// Presents the staged-buffer framework for capital-constrained teams: stage your single side, it
// EARNS while it waits, and one-click pair into a live V4 pool when a matching counterparty arrives.
// The matching engine (MintwareMatchedLiquidityVault) + Aave yield adapter are live primitives; the
// yield-while-staging composition + notify/opt-in are wired here as the flow. Honest: testnet, and
// the stage→earn step is live via the treasury/yield vault; auto-match notifications are the next leg.

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'

const STEPS = [
  {
    n: 1, title: 'Stage your single side', tone: 'peri',
    body: 'Hold $50k USDC but no ETH? Deposit the side you have. No 50/50 requirement, no forced swap — zero impermanent-loss risk while you wait.',
  },
  {
    n: 2, title: 'It earns from day one', tone: 'peri',
    body: '100% of your staged capital is routed into Aave v3, earning baseline yield immediately — not sitting idle in a treasury wallet.',
  },
  {
    n: 3, title: 'Pair on a match — your call', tone: 'coral',
    body: 'When a counterparty supplies the other side, you get an alert with the projected LP fee APY vs. your current yield. One passkey click atomically withdraws from Aave, pairs, and mints a live Uniswap v4 position.',
  },
]

export default function GetLiquidity() {
  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[880px] px-6 max-[700px]:px-4 py-[48px]">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep">For capital-constrained teams</div>
        <h1 className="font-atx-display font-bold text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-[-0.03em] mt-3">
          Get liquidity —<br /><span className="text-gradient-accent">even if you only hold one side.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2.1vw,1.2rem)] leading-[1.5] max-w-[62ch] mt-5">
          Most teams can&apos;t seed a pool because they hold one token, not two. Stage the side you have
          here — it earns while it waits, and pairs into a real pool only when you say so.
        </p>

        {/* Why-it's-different chips */}
        <div className="flex flex-wrap gap-2 mt-6">
          {['No dual-asset barrier', 'Zero idle drag', 'No forced conversion', 'Opt-in, never automatic'].map((c) => (
            <span key={c} className="text-[12.5px] font-semibold rounded-full border border-hair bg-white px-3 py-1.5 text-ink">{c}</span>
          ))}
        </div>

        {/* How it works */}
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-11 mb-4">How it works</div>
        <div className="flex flex-col gap-3">
          {STEPS.map((s) => (
            <div key={s.n} className="soft-card p-5 flex items-start gap-4">
              <span className="font-atx-display font-bold text-[15px] text-white w-[34px] h-[34px] rounded-[11px] grid place-items-center shrink-0"
                style={{ background: s.tone === 'coral' ? 'linear-gradient(135deg,var(--color-coral2-mid),var(--color-coral2))' : 'linear-gradient(135deg,var(--color-peri-mid),var(--color-peri))', boxShadow: '0 3px 10px rgba(108,108,240,.3)' }}>
                {s.n}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-[15.5px]">{s.title}</div>
                <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-1">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* The example alert — the opt-in payload */}
        <div className="mt-6 rounded-[16px] border border-[rgba(108,108,240,0.3)] p-5" style={{ background: 'linear-gradient(120deg, rgba(108,108,240,0.06), var(--color-ground-cool))' }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-peri-deep">What a match looks like</div>
          <p className="text-[14px] text-ink leading-[1.5] mt-2">
            &ldquo;Matching liquidity found — <b>50 ETH</b> to pair your <b>50,000 USDC</b> buffer. Projected LP fee yield
            <b className="text-mw-green"> 16.8%</b> vs. your current Aave <b>4.1%</b>. Form the pool?&rdquo;
          </p>
          <p className="text-[12px] text-ink-soft mt-2">You review the ratio, gas, and yield, then approve with one passkey signature — or ignore it and keep earning.</p>
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center gap-3 flex-wrap">
          <Link href="/app/org" className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold no-underline hover:bg-peri-deep transition-colors">Stage your capital →</Link>
          <Link href="/app/vaults" className="rounded-full border border-hair bg-white text-ink px-5 py-3 text-[14px] font-semibold no-underline hover:bg-ground-cool transition-colors">Browse live vaults</Link>
        </div>
        <p className="text-[12px] text-ink-soft mt-5 max-w-[64ch]">
          Testnet. The stage-and-earn step is live today (your treasury&apos;s senior USDC earns via Aave
          from day one); the on-chain match engine is the <span className="font-mono">MintwareMatchedLiquidityVault</span>,
          and auto-match alerts are the next leg. Nothing here is an offer.
        </p>
      </main>
    </div>
  )
}
