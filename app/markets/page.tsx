import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'
import { PositionCard } from '@/components/marketing/PositionCard'
import { MarketScreen } from '@/components/marketing/mineral/MarketScreen'
import { Page, Section, SectionHead, Hero, IconTile, Arrow, CTA, wrap } from '@/components/marketing/Story'
import { IconTrade, IconOwned, IconDepth, IconCurated, IconPrice, IconHours, IconIsolated, IconFailClosed, IconAudited } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Markets — Mintware', description: 'Provide liquidity to markets in tokenized stocks and real-world assets, and earn a share of every trade.' }

// The page argues one thing in order: trades pay fees → you can be the one they pay → here are the markets →
// here is what holding a position looks like → here is what can go wrong. Each band hands off to the next.

const FEE_STEPS: [string, string, ReactNode][] = [
  ['A trader swaps', 'Someone buys or sells the stock token in its market, at any hour.', <IconTrade key="t" size={22} />],
  ['The pool takes a fee', 'A small fee on every swap stays in the pool that made the trade possible.', <IconDepth key="d" size={22} />],
  ['Your share grows', 'Fees build on the position, split pro‑rata between everyone providing it.', <IconOwned key="o" size={22} />],
]

const CHECKS: [string, ReactNode][] = [
  ['Depth and volume', <IconDepth key="d" size={18} />],
  ['Price behaviour', <IconPrice key="p" size={18} />],
  ['Issuer and token controls', <IconCurated key="c" size={18} />],
  ['Market hours', <IconHours key="h" size={18} />],
]

const RISKS: [string, string, string, ReactNode][] = [
  ['The price moves', 'Providing liquidity carries impermanent loss. You can end up with more of the asset that fell.', 'Yours to judge. Exit any share of your position, with no lockup.', <IconPrice key="p" size={20} />],
  ['The issuer acts', 'Tokenized assets can be paused, frozen or changed by their issuer.', 'Contained to that one market. Every market runs its own engine.', <IconIsolated key="i" size={20} />],
  ['Something is unreadable', 'Prices go stale, a feed drops, a market closes for the weekend.', 'The engine stops rather than guesses. Withdrawals stay open.', <IconFailClosed key="f" size={20} />],
  ['The code has a bug', 'Smart contracts carry technical risk, and these are not yet audited.', 'Testnet with mock tokens only, until an external audit is done.', <IconAudited key="a" size={20} />],
]

export default function MarketsPage() {
  return <Page>
    <V2Nav active="markets" />

    <Hero
      eyebrow="Markets · live on testnet"
      title="Earn what"
      soft="market makers earn."
      lede="Every trade in a tokenized stock pays a fee to the people who provide its market. Mintware lets you be one of them, with a single asset, no lockups, and your position in your own wallet."
      actions={<><a href="#live" className="mw-btn mw-btn-lg">See the markets <Arrow /></a><a href="#how" className="mw-btn-quiet mw-btn-lg">Where the fees come from</a></>}
      aside={<PositionCard />}
    />

    {/* 1 — where the money comes from */}
    <Section id="how" tint>
      <SectionHead
        eyebrow="Where the fees come from"
        title="Every trade pays"
        soft="the market."
        aside="A market can only trade if someone has put liquidity in it. That liquidity is paid for every trade it makes possible. Today that's mostly professional market makers. It doesn't have to be."
      />
      <div className="mt-12 mw-inset rounded-[26px] p-[clamp(16px,3vw,32px)] grid gap-4 items-center grid-cols-1 min-[900px]:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {FEE_STEPS.map(([t, b, icon], i) => (
          <div key={t} className="contents">
            {i > 0 && <span className="justify-self-center text-ink-soft"><span className="max-[899px]:hidden"><Arrow size={24} /></span><span className="min-[900px]:hidden"><Arrow size={22} down /></span></span>}
            <div className="mw-raise-sm h-full rounded-[20px] p-6">
              <div className="flex items-center justify-between"><IconTile>{icon}</IconTile><span className="font-geist-mono text-[12px] text-ink-soft">0{i + 1}</span></div>
              <div className="font-semibold text-[18px] tracking-[-0.02em] mt-5">{t}</div>
              <div className="text-[14.5px] text-ink-mid leading-[1.5] mt-1.5">{b}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 mb-0 text-[15px] text-ink-mid max-w-[70ch]">Tokenized stocks trade around the clock, so the fees do too. You provide <b className="text-ink font-semibold">one asset</b>; the engine pairs it into the market for you.</p>
    </Section>

    {/* 2 — pick a market */}
    <Section id="live">
      <SectionHead
        eyebrow="Pick a market"
        title="Only markets"
        soft="worth backing."
        aside="Discover watches every market on Robinhood Chain and ranks the ones worth your capital. A person reviews each one before it can take a dollar."
      />
      <div className="mt-8 flex flex-wrap gap-2.5" aria-label="What every market is checked for">
        {CHECKS.map(([t, icon]) => <span key={t} className="mw-raise-sm inline-flex items-center gap-2 rounded-full pl-2.5 pr-3.5 py-2 text-[14px] text-ink-mid"><span style={{ color: 'var(--mw-peri-deep)' }}>{icon}</span>{t}</span>)}
      </div>
      <div className="mt-8"><DiscoverMarkets mode="list" /></div>
    </Section>

    {/* 3 — what holding a position looks like */}
    <section style={{ background: 'var(--mw-band)', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-wrap gap-[clamp(32px,5vw,72px)] items-center`}>
        <div className="flex-[1_1_340px] min-w-0">
          <SectionHead eyebrow="Your position" title="Everything" soft="on one screen." />
          <ol className="mt-8 p-0 list-none flex flex-col gap-[22px]">
            {[
              ['A live mark that knows the hours', 'See when the real market is open, and when the engine is holding still.'],
              ['Provide in one step', 'Type an amount. See your shares and your slippage floor before you sign.'],
              ['Leave on your terms', 'Value, what you put in and fees earned. Exit any share of it, pro‑rata, in both assets.'],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex-none w-8 h-8 rounded-full grid place-items-center text-[14px] font-semibold text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>{i + 1}</span>
                <div><div className="font-semibold">{t}</div><div className="mt-1 text-[15px] leading-[1.5] text-ink-mid">{b}</div></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex-[1.3_1_480px] min-w-0"><MarketScreen /></div>
      </div>
    </section>

    {/* 4 — what can go wrong */}
    <Section>
      <SectionHead
        eyebrow="What can go wrong"
        title="The risks,"
        soft="and where they stop."
        aside="Every market has risk. What matters is whether it stays where it started. Here is each one, and how the engine handles it."
      />
      <div className="mt-12 mw-raise rounded-[26px] overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.1fr_1.4fr_1.4fr] gap-6 px-7 py-3.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft" style={{ background: 'var(--mw-ground)' }}>
          <span>If</span><span>What it means</span><span>How it’s handled</span>
        </div>
        {RISKS.map(([t, a, b, icon]) => (
          <div key={t} className="grid md:grid-cols-[1.1fr_1.4fr_1.4fr] gap-x-6 gap-y-2 px-7 py-6 items-start" style={{ borderTop: '1px solid var(--mw-line)' }}>
            <div className="flex items-center gap-3 font-semibold"><IconTile>{icon}</IconTile>{t}</div>
            <div className="text-[15px] leading-[1.55] text-ink-mid">{a}</div>
            <div className="text-[15px] leading-[1.55] font-medium">{b}</div>
          </div>
        ))}
      </div>
      <Link href="/risk-disclosures" className="inline-flex items-center gap-1.5 mt-6 text-[15px] font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>Read the full risk disclosures <Arrow size={16} /></Link>
    </Section>

    <CTA title="See a market" soft="up close.">
      <Link href="/app/markets" className="mw-btn mw-btn-lg">Open the app <Arrow /></Link>
      <Link href="/cards" className="mw-btn-quiet mw-btn-lg">Spend with the card</Link>
    </CTA>
  </Page>
}
