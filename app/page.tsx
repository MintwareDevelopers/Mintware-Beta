import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { PositionCard } from '@/components/marketing/PositionCard'
import { MarketsMockup } from '@/components/marketing/MarketsMockup'
import { GrowthChart } from '@/components/marketing/GrowthChart'
import { Eyebrow, H2, CTA, wrap } from '@/components/marketing/Story'

const display = 'font-atx-display font-medium tracking-[-0.04em] leading-[1.02]'

const STATS: [string, string][] = [
  ['$300B+', 'stablecoins on-chain'],
  ['$38B+', 'tokenized real-world assets'],
  ['3×', 'tokenized stock growth in 2026'],
]

const MARKETS: { tag: string; title: string; text: string; chips: string[] }[] = [
  { tag: 'Stock tokens', title: 'Equities, around the clock.', text: 'Back the markets for the stocks people trade most.', chips: ['TSLA', 'NVDA', 'AAPL', '+2,000'] },
  { tag: 'Real-world assets', title: 'Real assets, real depth.', text: 'Liquidity for tokenized treasuries, credit and property.', chips: ['Treasuries', 'Credit', 'Property'] },
  { tag: 'Stablecoins', title: 'Dollars that never sit still.', text: 'Back stablecoin markets and spend with your card.', chips: ['USDC', 'USDG'] },
]

const TRUST: [string, string][] = [
  ['Live', 'on Robinhood Chain'],
  ['Instant', 'exits, in kind'],
  ['0', 'custody of your funds'],
  ['100%', 'on-chain and open'],
]

const FAQ: [string, string][] = [
  ['What is Mintware?', 'Mintware is the liquidity layer for on-chain value. It turns capital into always-working liquidity for markets in tokenized stocks, real-world assets and stablecoins — and lets you earn from it.'],
  ['How does my money earn?', 'Your capital earns a share of the fees from every trade in the markets you back, plus yield on whatever the market doesn’t need at that moment. Two sources, one balance.'],
  ['Can I withdraw at any time?', 'Yes. There are no lockups — you’re paid out instantly in your share of the market’s assets.'],
  ['Who holds my funds?', 'You do. Mintware is non-custodial — your shares sit in your own wallet, and every contract and transaction is on-chain.'],
  ['Where does Mintware run?', 'Mintware is live on Robinhood Chain, home of the largest set of tokenized stocks.'],
  ['Are there risks?', 'Yes, as with any market. Providing liquidity carries price risk and impermanent loss, tokenized assets carry issuer risk, and smart contracts carry technical risk. Read the full risk disclosures before you use Mintware.'],
]

export default function HomePage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav />

    {/* Hero */}
    <section className="bg-white">
      <div className={`${wrap} pt-14 pb-20 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center`}>
        <div>
          <Eyebrow>The liquidity layer for on-chain value</Eyebrow>
          <h1 className={`${display} text-[clamp(3rem,7vw,5.6rem)] max-w-[12ch] mt-5`}>Every asset deserves <span className="text-ink-soft">a market.</span></h1>
          <p className="text-ink-mid text-[18px] leading-[1.6] mt-6 max-w-[40ch]">Earn from every trade in tokenized stocks, RWAs and stablecoins. Leave anytime.</p>
          <div className="flex flex-wrap gap-3 mt-9"><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers" className="glass-pill">For issuers</Link></div>
        </div>
        <GradientPanel tone="periwinkle" className="p-8 max-[800px]:p-5 min-h-[420px] flex items-center justify-center"><div className="flex justify-center w-full"><PositionCard /></div></GradientPanel>
      </div>
    </section>

    {/* Stat band */}
    <section className="bg-ground-cool">
      <div className={`${wrap} py-16`}>
        <p className="text-[15px] text-ink-mid text-center">The assets have arrived. The markets haven’t.</p>
        <div className="grid md:grid-cols-3 gap-6 mt-8 text-center">
          {STATS.map(([n, t]) => <div key={t}><div className={`${display} text-[clamp(2.8rem,6vw,4.4rem)]`}>{n}</div><div className="text-[14px] text-ink-mid mt-2">{t}</div></div>)}
        </div>
      </div>
    </section>

    {/* Product: the app */}
    <section className="bg-white">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <div className="max-w-[640px]">
          <Eyebrow>Mintware Markets</Eyebrow>
          <H2 soft="Without the work.">Earn what market makers earn.</H2>
          <p className="text-ink-mid text-[17px] leading-[1.6] mt-5">Add one asset. It works in the market when trading is busy, and in yield when it’s quiet.</p>
          <div className="flex flex-wrap gap-3 mt-8"><Link href="/markets" className="glass-pill-primary">Explore Markets</Link></div>
        </div>
        <GradientPanel tone="lavender" className="mt-12 p-8 max-[800px]:p-3"><MarketsMockup /></GradientPanel>
      </div>
    </section>

    {/* Markets for every asset */}
    <section className="bg-ground-cool">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>Markets for every asset</Eyebrow>
        <H2 soft="from stocks to dollars.">Choose what you back,</H2>
        <div className="grid md:grid-cols-3 gap-5 mt-12">
          {MARKETS.map(m => <Link key={m.tag} href="/markets" className="soft-card p-8 no-underline text-ink flex flex-col min-h-[260px]">
            <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-peri-deep">{m.tag}</span>
            <span className="font-atx-display font-medium text-[1.7rem] tracking-[-0.025em] leading-[1.12] mt-4">{m.title}</span>
            <span className="text-[14.5px] text-ink-mid leading-[1.6] mt-3">{m.text}</span>
            <span className="mt-auto pt-6 flex flex-wrap gap-2">{m.chips.map(c => <span key={c} className="rounded-full bg-white border border-hair px-3 py-1 text-[12px] font-semibold text-ink-mid">{c}</span>)}</span>
          </Link>)}
        </div>
      </div>
    </section>

    {/* Blended yield vs savings */}
    <section className="bg-white">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>Why it earns more</Eyebrow>
        <H2 soft="earns more.">The same $10,000</H2>
        <p className="text-ink-mid text-[17px] leading-[1.6] mt-5 max-w-[52ch]">A Mintware market earns trading fees on the capital in the pool and yield on the rest — two sources where lending, T-bills and savings have one.</p>
        <div className="mt-12"><GrowthChart /></div>
      </div>
    </section>

    {/* Issuers */}
    <section className="bg-white">
      <div className={`${wrap} pb-24 max-[800px]:pb-16`}>
        <GradientPanel tone="coral" className="p-12 max-[800px]:p-6">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
            <div>
              <Eyebrow>For issuers</Eyebrow>
              <h2 className={`${display} text-[clamp(2.2rem,4.6vw,3.6rem)] mt-4`}>Your token. <span className="text-ink-soft">Our liquidity.</span></h2>
              <p className="text-ink-mid text-[17px] leading-[1.6] mt-5 max-w-[44ch]">Deep, fair markets from day one — funded by your holders, not a rented market maker.</p>
              <div className="flex flex-wrap gap-3 mt-8"><Link href="/issuers#talk" className="glass-pill-primary">Bring your asset to market</Link></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[['Day one', 'depth at launch'], ['Tighter', 'spreads'], ['Liquidity', 'that stays'], ['On-chain', 'and in the open']].map(([a, b]) => <div key={a} className="glass-card p-6"><div className="font-atx-display font-medium text-[1.5rem] tracking-[-0.02em]">{a}</div><div className="text-[13px] text-ink-mid mt-1">{b}</div></div>)}
            </div>
          </div>
        </GradientPanel>
      </div>
    </section>

    {/* Trust band */}
    <section className="bg-ground-cool">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>Open by default</Eyebrow>
        <H2 soft="Yours by design.">Built in the open.</H2>
        <div className="grid md:grid-cols-4 gap-5 mt-12">
          {TRUST.map(([n, t]) => <div key={t} className="soft-card p-7"><div className={`${display} text-[clamp(2rem,3.6vw,2.8rem)]`}>{n}</div><div className="text-[14px] text-ink-mid mt-2">{t}</div></div>)}
        </div>
        <Link href="/proof" className="inline-block mt-8 text-[14px] font-semibold text-peri-deep no-underline hover:underline">See it on-chain →</Link>
      </div>
    </section>

    {/* FAQ */}
    <section className="bg-white">
      <div className={`${wrap} py-24 max-[800px]:py-16 grid lg:grid-cols-[1fr_1.6fr] gap-12`}>
        <div><Eyebrow>FAQ</Eyebrow><H2>Questions, answered.</H2></div>
        <div className="divide-y divide-hair-soft border-y border-hair-soft">
          {FAQ.map(([q, a]) => <details key={q} className="group py-5">
            <summary className="flex items-center justify-between cursor-pointer list-none text-[17px] font-semibold">{q}<span className="text-peri-deep text-[22px] leading-none transition-transform group-open:rotate-45">+</span></summary>
            <p className="text-[15px] text-ink-mid leading-[1.65] mt-3 max-w-[62ch]">{a}</p>
          </details>)}
        </div>
      </div>
    </section>

    <CTA title="Liquidity should be" soft="a public good.">
      <Link href="/v1" className="glass-pill-primary">Open the app</Link>
      <Link href="/about" className="glass-pill">Our story</Link>
    </CTA>
    <p className={`${wrap} pb-10 text-[11.5px] text-ink-soft`}>Market data: rwa.xyz, Token Terminal, Robinhood (Oct 2026).</p>
  </main>
}
