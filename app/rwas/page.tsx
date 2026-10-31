import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { Page, Section, SectionHead, Hero, IconTile, Arrow, CTA } from '@/components/marketing/Story'
import { IconStocks, IconLand, IconTreasury, IconHours, IconFailClosed, IconRules, IconOwned, IconExit, IconPrice } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Real-world assets — Mintware', description: 'Tokenizing an asset makes it divisible, not liquid. Mintware gives each real asset its own market.' }

// The page argues: tokenized isn't liquid → real assets break in ways a shared pool can't absorb → so each asset
// gets its own engine, rolled out asset by asset (status shown honestly) → see one running → bring yours.

// Hero object: the asset roster, carrying status in its material like the landing roadmap.
// solid = on testnet, dotted = next, hatched = later.
const ASSETS: { t: string; d: string; icon: ReactNode; tint: string; status: string; tex?: 'dots' | 'hatch' }[] = [
  { t: 'Stocks', d: 'Tokenized equities, trading around the clock', icon: <IconStocks key="s" size={22} />, tint: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', status: 'Testnet' },
  { t: 'Property', d: 'A land parcel with issuer-checked ownership', icon: <IconLand key="l" size={22} />, tint: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', status: 'Installation pending', tex: 'dots' },
  { t: 'Gold', d: 'A gold engine, with first credit', icon: <IconTreasury key="g" size={22} />, tint: 'linear-gradient(160deg,#FBF1D6,#E8C979)', status: 'Next', tex: 'dots' },
  { t: 'Land & water', d: 'More real assets, one engine each', icon: <IconLand key="w" size={22} />, tint: 'linear-gradient(160deg,#E2F0FB,#A9CDEE)', status: 'Later', tex: 'hatch' },
]

function AssetRoster() {
  return <div className="relative w-full max-w-[470px]">
    <div aria-hidden="true" className="absolute inset-[12%_-6%_-4%_6%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
    <div className="relative grid grid-cols-2 gap-4">
      {ASSETS.map((a, i) => {
        const live = !a.tex
        return <div key={a.t} className={`${live ? 'mw-raise-lg' : a.tex === 'hatch' ? 'mw-inset' : 'mw-raise-sm'} rounded-[24px] p-5 ${i % 2 ? 'translate-y-7' : ''} ${a.tex ? `mw-tex-${a.tex}` : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <span className="w-11 h-11 rounded-[13px] grid place-items-center" style={{ background: a.tint, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)', color: '#15151D' }}>{a.icon}</span>
            <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-1 rounded-full ${live ? 'bg-[#E3F4EA] text-[#0F7A43]' : 'bg-white text-ink-mid'}`}>{live && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{a.status}</span>
          </div>
          <div className="font-semibold text-[21px] tracking-[-0.03em] mt-5">{a.t}</div>
          <div className="text-[13px] text-ink-mid leading-[1.45] mt-1.5">{a.d}</div>
        </div>
      })}
    </div>
  </div>
}

const GIVES: [string, boolean][] = [
  ['Divisible into units eligible holders can own', true],
  ['Programmable, with rules built in', true],
  ['Held in your own wallet', true],
  ['A buyer at a fair price, when you want one', false],
  ['A price you can trust, every minute', false],
]

const BREAKS: [string, string, string, ReactNode][] = [
  ['The market closes', 'The real stock exchange shuts for the weekend while the token keeps trading.', 'Marks pause. Nothing is forced to sell on a stale price.', <IconHours key="h" size={22} />],
  ['The issuer freezes a token', 'An issuer can pause or freeze a regulated token at any time.', 'Only that asset’s market is affected. Exit delivery still follows the token’s transfer rules.', <IconFailClosed key="f" size={22} />],
  ['Only verified holders allowed', 'Outside liquidators can’t hold a permissioned token, so they can’t step in.', 'Positions unwind inside the asset’s own pool instead.', <IconRules key="r" size={22} />],
]

export default function RwasPage() {
  return <Page>
    <V2Nav active="rwas" />

    <Hero
      eyebrow="Real-world assets"
      title="The world’s real assets,"
      soft="finally liquid."
      lede="Stocks, property, gold. The most valuable assets on earth have always been the hardest to buy, sell and borrow against. Tokenization makes them programmable. Mintware gives each one a market."
      actions={<><Link href="/markets" className="mw-btn mw-btn-lg">Explore markets <Arrow /></Link><a href="#demo" className="mw-btn-quiet mw-btn-lg">See the property demo</a></>}
      aside={<AssetRoster />}
    />

    {/* 1 — tokenized isn't liquid */}
    <Section tint>
      <div className="grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
        <div>
          <SectionHead eyebrow="The ownership trap" title="Tokenized" soft="isn’t the same as liquid." />
          <p className="mt-6 mb-0 text-[17px] leading-[1.6] text-ink-mid max-w-[50ch]">A tokenized acre or share is only as useful as the market behind it. Without depth, owners can’t sell at a fair price and buyers can’t get in. Tokenization solved who owns it. It didn’t solve how to trade it.</p>
        </div>
        <div className="mw-raise-lg rounded-[26px] p-[clamp(20px,3vw,30px)]">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Tokenizing an asset gives you</div>
          <ul className="mt-4 p-0 list-none flex flex-col gap-2.5">
            {GIVES.map(([t, ok]) => (
              <li key={t} className="flex items-center gap-3 rounded-[14px] px-4 py-3 text-[15px]" style={ok ? { background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' } : { background: '#fff', outline: '1.5px dashed rgba(91,91,230,.4)', outlineOffset: -1.5 }}>
                {ok
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F7A43" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Yes" className="shrink-0"><path d="m5 12 4 4 10-10" /></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B42318" strokeWidth="2.2" strokeLinecap="round" aria-label="No" className="shrink-0"><path d="M6 6l12 12M18 6 6 18" /></svg>}
                <span className={ok ? 'text-ink-mid' : 'font-semibold'}>{t}</span>
                {!ok && <span className="ml-auto text-[12px] font-semibold whitespace-nowrap" style={{ color: 'var(--mw-peri-deep)' }}>What a market adds</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>

    {/* 2 — real assets break in real ways */}
    <Section>
      <SectionHead
        eyebrow="Why each asset gets its own engine"
        title="Real assets break"
        soft="in real ways."
        aside="A shared pool spreads one asset’s problem to everyone in it. A per‑asset engine is tuned to how that asset actually trades, and keeps trouble where it started."
      />
      <div className="mt-12 grid gap-5 grid-cols-1 md:grid-cols-3">
        {BREAKS.map(([t, what, handled, icon]) => (
          <div key={t} className="mw-raise rounded-[24px] p-7 flex flex-col">
            <IconTile>{icon}</IconTile>
            <div className="font-semibold text-[20px] tracking-[-0.02em] mt-6">{t}</div>
            <p className="text-[15px] text-ink-mid leading-[1.55] mt-2 mb-0">{what}</p>
            <div className="mt-auto pt-5">
              <div className="rounded-[14px] px-4 py-3 text-[14.5px] font-medium flex gap-2.5 items-start" style={{ background: 'var(--mw-band)' }}>
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--mw-peri-deep)' }}><Arrow size={16} /></span>{handled}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>

    {/* 3 — see one running */}
    <section id="demo" className="scroll-mt-20" style={{ background: 'var(--mw-band)', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className="mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)] py-[clamp(64px,8vw,120px)] grid lg:grid-cols-[1fr_1.1fr] gap-12 items-center">
        <div>
          <SectionHead eyebrow="The property engine" title="A tokenized property," soft="with a market of its own." />
          <p className="mt-6 mb-0 text-[17px] leading-[1.6] text-ink-mid max-w-[50ch]">The owned property engine is awaiting installation on Base Sepolia. Qualified holders contribute property tokens and USDC for non-transferable shares. A dated appraisal and issuer permissions govern trading. The earlier model’s transaction proof remains in the archive.</p>
          <Link href="/app/rwas" className="mw-btn mw-btn-lg mt-8">Open the property demo <Arrow /></Link>
        </div>
        <GradientPanel tone="lavender" className="p-[clamp(16px,3vw,32px)]">
          <div className="mw-raise-lg rounded-[24px] p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-[12px] grid place-items-center" style={{ background: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)' }}><IconLand size={20} /></span>
                <span><span className="block text-[15px] font-semibold">Willow Creek Parcel 7</span><span className="block text-[12px] text-ink-soft">Fictional land parcel · Base Sepolia</span></span>
              </span>
              <span className="text-[12px] font-semibold text-ink-mid">Installation pending</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5 text-[13px]">
              {([['Priced against', 'Dated appraisal', <IconPrice key="p" size={16} />], ['Outside the band', 'Gap-closing trades only', <IconFailClosed key="f" size={16} />], ['Who can hold it', 'Qualified holders', <IconOwned key="o" size={16} />], ['Leaving', 'Assets paid in kind', <IconExit key="e" size={16} />]] as [string, string, ReactNode][]).map(([k, v, icon]) => (
                <div key={k} className="rounded-[16px] p-4" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                  <div className="flex items-center gap-1.5 text-ink-soft"><span style={{ color: 'var(--mw-peri-deep)' }}>{icon}</span>{k}</div>
                  <div className="font-semibold text-[16px] tracking-[-0.01em] mt-1.5">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </GradientPanel>
      </div>
    </section>

    <CTA title="Bring a real asset" soft="to market.">
      <Link href="/issuers#talk" className="mw-btn mw-btn-lg">Talk to us <Arrow /></Link>
      <Link href="/issuers" className="mw-btn-quiet mw-btn-lg">How it works for issuers</Link>
    </CTA>
  </Page>
}
