import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'
import { PositionCard } from '@/components/marketing/PositionCard'

const wrap = 'mx-auto max-w-[1080px] px-6 max-[800px]:px-4'
const eyebrow = 'font-mono text-[12px] uppercase tracking-[0.14em] text-peri-deep'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4.2vw,2.9rem)] max-w-[22ch]'
const body = 'text-ink-mid text-[16px] leading-[1.7] max-w-[68ch]'

const SHIFT = [
  ['$300B+', 'in stablecoins — the internet’s dollars, mostly sitting still.'],
  ['$38B+', 'in tokenized real-world assets on-chain, up ~66% this year.'],
  ['3×', 'growth in tokenized stocks in 2026 — from under $1B to over $3B.'],
  ['~2,000', 'stock tokens issued by Robinhood. 3 in 4 dollars on Robinhood Chain are tokenized equities.'],
]

const STATES = [
  ['When the market is active', 'Your capital sits in the pool — deepening the book and earning on every trade.'],
  ['When it’s quiet', 'Whatever the market doesn’t need moves into yield and keeps earning.'],
  ['When you want out', 'You leave instantly, with your share of both assets. No queue, no lockup, no waiting for a buyer.'],
]

const UNLOCKS = [
  {
    t: 'For holders — your balance, finally working everywhere.',
    d: 'Put $5,000 of stablecoins behind the stock and RWA markets you believe in. Earn from the trading that flows through them and from yield when they’re quiet — without ever giving up the right to leave. Spend what you earn with a card that tops itself up.',
    cta: 'Explore markets', href: '/markets',
  },
  {
    t: 'For issuers — your token, our liquidity.',
    d: 'Launch with depth, not a market-maker invoice. Your token deserves a market from day one — Mintware brings curated, holder-backed liquidity to your pool: tighter spreads, fairer prices, real price discovery — every position visible on-chain to you, your holders and your regulators. The liquidity stays, because the people providing it never have a reason to leave.',
    cta: 'Bring your asset to market', href: '/issuers#talk',
  },
  {
    t: 'For the market — a flywheel.',
    d: 'Deeper markets mean fairer prices. Fairer prices bring more trading. More trading pays the people providing liquidity — which brings more liquidity. Every market Mintware backs makes the next one easier.',
    cta: 'How markets work', href: '/markets',
  },
]

const MILESTONES = [
  ['Oct 2026', 'Market engine live on Robinhood Chain'],
  ['Oct 2026', 'First deposits and withdrawals through mintware.finance'],
  ['Live', 'Discover tracking Robinhood Chain markets in real time'],
]

const STACK = [
  ['Markets', 'Back curated markets for tokenized stocks, RWAs and stablecoins.', '/markets'],
  ['Earn', 'Put stablecoins to work in one curated yield engine.', '/earn'],
  ['Card', 'Spend what you’ve earned. The rest keeps working.', '/cards'],
  ['Curation', 'Every market reviewed before it opens. Signal, not noise.', '/markets'],
  ['Agents', 'AI agents that pay, earn and build reputation on-chain.', '/agents'],
]

export default function HomePage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav />

    {/* Hero */}
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16 grid lg:grid-cols-[1.25fr_1fr] gap-12 items-center`}>
        <div>
          <p className={eyebrow}>The liquidity layer for on-chain value</p>
          <h1 className="font-atx-display font-semibold tracking-[-0.045em] leading-[1.02] text-[clamp(2.7rem,6.5vw,4.8rem)] max-w-[14ch] mt-4">Every asset deserves a market.</h1>
          <p className="font-atx-display text-[clamp(1.1rem,2.2vw,1.5rem)] font-medium mt-5">Never idle. Never locked. Always yours.</p>
          <p className={`${body} mt-6`}>Stocks, treasuries, property and dollars are being rebuilt as tokens — programmable, global, open around the clock. But a token is only as valuable as the market behind it. Mintware builds those markets out of capital that never stops working: one position that earns when markets are quiet, deepens them when they’re busy, and is yours to take back the moment you want it.</p>
          <div className="flex flex-wrap gap-3 mt-8"><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers#talk" className="glass-pill">Bring your asset to market</Link></div>
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-mid items-center"><DiscoverMarkets mode="proof" /><span>Built on Uniswap v4</span><span>Robinhood Chain</span><span>USDG</span></div>
        </div>
        <PositionCard />
      </div>
    </section>

    {/* 01 The shift */}
    <section className="border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>01 · The shift is already here</p>
        <div className="grid md:grid-cols-4 gap-8 mt-10">
          {SHIFT.map(([n, t]) => <div key={n}><div className="font-atx-display font-semibold tracking-[-0.03em] text-[clamp(2rem,4vw,2.8rem)]">{n}</div><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{t}</p></div>)}
        </div>
        <p className={`${body} mt-12`}>Tesla, Nvidia, Apple and thousands more now exist as tokens, and the largest issuers are bringing them to Robinhood Chain with on-chain pools of their own. Treasuries, credit and real estate are following.</p>
        <p className="font-atx-display font-semibold text-[clamp(1.3rem,2.6vw,1.8rem)] mt-6">The assets have arrived. The markets haven’t. Mintware makes them deep.</p>
      </div>
    </section>

    {/* 02 The bottleneck */}
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>02 · The bottleneck nobody solved</p>
        <h2 className={`${h2} mt-4`}>Tokenizing is easy. Liquidity is hard.</h2>
        <p className={`${body} mt-6`}>A traditional exchange trades more in a few minutes than the entire tokenized stock market is worth. On-chain, most tokens launch into thin pools with wide spreads, where a modest trade moves the price. So buyers stay away, issuers pay market makers to fake depth, and liquidity drifts to wherever it’s loudest — today, a sixth of on-chain stock-token supply sits in memecoin pools.</p>
        <p className={`${body} mt-5`}>Meanwhile, the capital that could fix it sits idle. Providing liquidity has always meant a bad trade: <b className="text-ink font-semibold">lock your money up to earn, or keep it free and earn nothing.</b> Most people choose free. Markets stay thin.</p>
      </div>
    </section>

    {/* 03 The breakthrough */}
    <section className="border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>03 · The breakthrough</p>
        <h2 className={`${h2} mt-4`}>Liquidity that never sits idle — and never locks you in.</h2>
        <p className={`${body} mt-6`}>Mintware’s market engine removes the trade-off. You add a single asset — a stablecoin or the token itself — and the engine manages one living position:</p>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {STATES.map(([t, d], i) => <div key={t} className="rounded-[var(--radius-card)] border border-hair bg-white p-6"><span className="font-mono text-[13px] text-peri-deep">0{i + 1}</span><h3 className="font-semibold text-[17px] mt-2">{t}</h3><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{d}</p></div>)}
        </div>
        <p className="font-atx-display font-semibold text-[clamp(1.2rem,2.4vw,1.6rem)] mt-10 max-w-[40ch]">One deposit. Three states. Always working. For the first time, the most liquid choice and the most productive choice are the same choice.</p>
        <div className="mt-8 flex flex-wrap items-center gap-4"><DiscoverMarkets mode="top" /><Link className="text-[14px] font-semibold text-peri-deep no-underline hover:underline" href="/markets">See all markets →</Link></div>
      </div>
    </section>

    {/* 04 What it unlocks */}
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>04 · What it unlocks</p>
        <div className="mt-8 divide-y divide-hair-soft">
          {UNLOCKS.map(u => <div key={u.t} className="py-8 grid md:grid-cols-[1fr_1.4fr] gap-6"><h3 className="font-atx-display font-semibold text-[clamp(1.25rem,2.3vw,1.6rem)] tracking-[-0.02em] leading-[1.2]">{u.t}</h3><div><p className="text-[15px] text-ink-mid leading-[1.7]">{u.d}</p><Link href={u.href} className="inline-block mt-4 text-[14px] font-semibold text-peri-deep no-underline hover:underline">{u.cta} →</Link></div></div>)}
        </div>
      </div>
    </section>

    {/* 05 The platform */}
    <section className="border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>05 · One engine, a whole financial life</p>
        <div className="grid md:grid-cols-5 gap-4 mt-10">
          {STACK.map(([t, d, href]) => <Link key={t} href={href} className="rounded-[var(--radius-card)] border border-hair bg-white p-5 no-underline text-ink hover:shadow-card"><h3 className="font-semibold text-[16px]">{t}</h3><p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2">{d}</p></Link>)}
        </div>
        <p className="text-[15px] text-ink-mid mt-8">Underneath it all, one yield engine: capital that is never idle, wherever it lives.</p>
      </div>
    </section>

    {/* 06 Built in the open */}
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-20`}>
        <p className={eyebrow}>06 · Built in the open</p>
        <h2 className={`${h2} mt-4`}>Live on Robinhood Chain. Yours by design.</h2>
        <p className={`${body} mt-6`}>Real deposits and real withdrawals, running through mintware.finance today. Non-custodial from the first line of code — your share is yours, and no one can hold it hostage. Every contract open, every transaction on-chain.</p>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {MILESTONES.map(([when, what]) => <div key={what} className="border-t-2 border-peri-deep pt-4"><div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-soft">{when}</div><p className="text-[15px] font-semibold leading-[1.45] mt-2">{what}</p></div>)}
        </div>
        <Link href="/proof" className="inline-block mt-8 text-[14px] font-semibold text-peri-deep no-underline hover:underline">See it on-chain →</Link>
      </div>
    </section>

    {/* 07 Vision */}
    <section>
      <div className={`${wrap} py-24`}>
        <p className={eyebrow}>07 · Where this goes</p>
        <h2 className="font-atx-display font-semibold tracking-[-0.04em] leading-[1.04] text-[clamp(2.2rem,5vw,3.6rem)] max-w-[20ch] mt-4">A world where every asset has a market — and every dollar is working.</h2>
        <p className={`${body} mt-6`}>Every share, building, bond and dollar will live on-chain. The question is whether those markets will be deep and fair, or thin and captured. We believe liquidity should be a public good — owned by the people who provide it, open to anyone, and never idle.</p>
        <div className="flex flex-wrap gap-3 mt-9"><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers#talk" className="glass-pill">Talk to us</Link></div>
        <p className="text-[11.5px] text-ink-soft mt-12">Market data: rwa.xyz, Token Terminal, Robinhood (Oct 2026).</p>
      </div>
    </section>
  </main>
}
