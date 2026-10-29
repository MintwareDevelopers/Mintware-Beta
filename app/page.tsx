import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'

const wrap = 'mx-auto max-w-[1080px] px-6 max-[800px]:px-4'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.8rem,4vw,2.7rem)]'
const body = 'text-ink-mid text-[15px] leading-[1.65] max-w-[70ch]'

export default function HomePage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav />
    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <h1 className="font-atx-display font-semibold tracking-[-0.045em] leading-[1.02] text-[clamp(2.7rem,7vw,5rem)] max-w-[16ch]">The liquidity layer for on-chain value.</h1>
        <p className="font-atx-display text-[clamp(1.1rem,2.2vw,1.5rem)] font-medium mt-5">Never idle. Never locked. Always yours.</p>
        <p className={`${body} mt-5`}>Stocks, property, treasuries and dollars are moving on-chain. Mintware gives them deep, fair markets — built from capital that keeps working and never stops being yours.</p>
        <div className="flex flex-wrap gap-3 mt-8"><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers" className="glass-pill">For issuers</Link></div>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-mid items-center"><DiscoverMarkets mode="proof" /><span>Built on Uniswap v4</span><span>Robinhood Chain</span><span>USDG</span></div>
      </div>
    </section>
    <section className="border-b border-hair-soft"><div className={`${wrap} py-16`}><h2 className={h2}>Tokenizing is easy. Liquidity is hard.</h2><p className={`${body} mt-4`}>A token nobody can trade at a fair price isn&apos;t an asset — it&apos;s a receipt. The capital that could fix that sits idle, because providing liquidity has always meant choosing between earning and being free to leave. Mintware ends that trade-off.</p></div></section>
    <section className="bg-ground-cool border-b border-hair-soft"><div className={`${wrap} py-16`}><h2 className={h2}>How it works</h2><div className="grid md:grid-cols-3 gap-7 mt-8">{[['Add one asset','A stablecoin, a stock token, a real-world asset. One deposit, one share.'],['It never sits idle','It works in the market, earning on every trade, or in yield until the market needs it.'],['Leave whenever you want','Your share of the market, paid out in the actual assets. Instantly.']].map(([title, text], i) => <div key={title}><span className="font-mono text-[13px] text-peri-deep">0{i + 1}</span><h3 className="font-semibold text-[17px] mt-2">{title}</h3><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{text}</p></div>)}</div><div className="mt-9"><DiscoverMarkets mode="top" /><Link className="ml-4 text-[14px] font-semibold text-peri-deep no-underline hover:underline" href="/markets">See all markets →</Link></div></div></section>
    <section className="border-b border-hair-soft"><div className={`${wrap} py-16`}><h2 className={h2}>One yield engine. Three ways to use it.</h2><div className="grid md:grid-cols-3 gap-4 mt-8">{[['Markets','Back the markets for tokenized stocks, RWAs and stablecoins you believe in.','/markets'],['Earn','Put stablecoins to work and spend them when you need to.','/earn'],['Card',"Spend what you've earned. Your card tops itself up; the rest keeps working.",'/cards']].map(([title, text, href]) => <Link key={title} href={href} className="rounded-[var(--radius-card)] border border-hair bg-white p-6 no-underline text-ink hover:shadow-card"><h3 className="font-semibold text-[17px]">{title}</h3><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{text}</p></Link>)}</div></div></section>
    <section className="bg-ground-cool border-b border-hair-soft"><div className={`${wrap} py-16`}><h2 className={h2}>Built for</h2><div className="grid md:grid-cols-3 gap-7 mt-8">{[['Holders','Your assets, working for you, every hour, in every market.','Explore markets','/markets'],['Issuers','Launch with depth from day one, backed by holders, not rented market makers.','Talk to us','/issuers#talk'],['Investors','Tokenization is the trend. Liquidity is the bottleneck. Mintware is the liquidity layer.','About','/about']].map(([title, text, cta, href]) => <div key={title}><h3 className="font-semibold text-[17px]">{title}</h3><p className="text-[14px] text-ink-mid leading-[1.6] mt-2">{text}</p><Link className="inline-block mt-3 text-[14px] font-semibold text-peri-deep no-underline hover:underline" href={href}>{cta} →</Link></div>)}</div></div></section>
    <section className="border-b border-hair-soft"><div className={`${wrap} py-16`}><h2 className={h2}>Open by default</h2><div className="grid md:grid-cols-2 gap-4 mt-7 text-[14px] text-ink-mid">{['Non-custodial — Your share is yours.','Exit in kind, anytime — No queues, no lockups.','Curated markets — Every market is chosen with care.','Open contracts — Every transaction on-chain, for anyone to see.'].map(x => <p key={x} className="border-b border-hair-soft py-3">{x}</p>)}</div></div></section>
    <section><div className={`${wrap} py-16 flex flex-wrap items-center justify-between gap-5`}><h2 className={h2}>Liquidity should be a public good.</h2><Link href="/v1" className="glass-pill-primary">Open the app</Link></div></section>
  </main>
}
