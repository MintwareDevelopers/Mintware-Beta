import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Page, Section, SectionHead, Hero, GlassList, IconTile, Arrow, CTA } from '@/components/marketing/Story'
import { IconRules, IconStocks, IconCurated, IconDepth, IconHolders, IconTrade } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Issuers — Mintware', description: 'Your token. Real liquidity. Deep, fair markets for tokenized stocks and real-world assets, funded by your own holders.' }

// The page argues: a thin market makes a good asset look bad → the usual fix is rented, ours is owned → here is
// how a market goes live → your compliance comes with you → talk to us.

// Two order books side by side: a thin one (inset, hollow) against a deep one (raised, full). Illustrative.
const THIN = [26, 16, 10, 6, 4]
const DEEP = [92, 80, 70, 62, 54]
function Book({ rows, deep }: { rows: number[]; deep?: boolean }) {
  return <div className="flex flex-col gap-1.5">
    {rows.map((w, i) => <div key={i} className="h-3 rounded-full" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
      <div className={`h-full rounded-full ${deep ? '' : 'mw-tex-hatch'}`} style={{ width: `${w}%`, backgroundColor: deep ? '#7C7AF0' : '#D9D9E2' }} />
    </div>)}
  </div>
}
function DepthCompare() {
  return <div role="img" aria-label="Illustration: a thin market with little depth beside a deep market with depth on every level" className="grid grid-cols-2 gap-4">
    <div className="mw-inset rounded-[22px] p-5">
      <div className="text-[13px] font-semibold text-ink-mid">Thin market</div>
      <div className="text-[13px] text-ink-soft mt-1">Wide spread, little depth</div>
      <div className="mt-5"><Book rows={THIN} /></div>
    </div>
    <div className="mw-raise-lg rounded-[22px] p-5" style={{ outline: '2px solid rgba(91,91,230,.28)', outlineOffset: -2 }}>
      <div className="text-[13px] font-semibold">With Mintware</div>
      <div className="text-[13px] mt-1" style={{ color: 'var(--mw-gain)' }}>Tight spread, depth on every level</div>
      <div className="mt-5"><Book rows={DEEP} deep /></div>
    </div>
  </div>
}

// Renting depth vs owning it. Rows are deliberately qualitative: no invented spreads or costs.
const COMPARE: [string, string, string][] = [
  ['Who provides the depth', 'A hired market maker, with your tokens on loan', 'Your own holders, with their own capital'],
  ['Who earns the trading fees', 'The market maker', 'The people providing the market'],
  ['When it ends', 'When the contract does, all at once', 'One holder at a time, whenever each chooses'],
  ['What the public can see', 'Very little', 'Every position, on-chain'],
]

const STAGES: { t: string; d: string; icon: ReactNode }[] = [
  { t: 'Tell us about it', d: 'Your asset, its token and where it already trades.', icon: <IconStocks key="s" size={20} /> },
  { t: 'Curation review', d: 'A person checks the token’s rules, the issuer’s controls and the market’s depth.', icon: <IconCurated key="c" size={20} /> },
  { t: 'Market deployed', d: 'A dedicated engine for your pool, deployed and verified on-chain.', icon: <IconDepth key="d" size={20} /> },
  { t: 'Live for holders', d: 'Holders back the market and earn from its trading.', icon: <IconHolders key="h" size={20} /> },
]

export default function IssuersPage() {
  return <Page>
    <V2Nav active="issuers" />

    <Hero
      eyebrow="For issuers of tokenized assets"
      title="Your token."
      soft="Real liquidity."
      lede="You did the hard part: a real asset, tokenized and compliant. Mintware makes sure it trades like one, with a market funded by your own holders instead of a rented market maker."
      actions={<><a href="#talk" className="mw-btn mw-btn-lg">Bring your asset to market <Arrow /></a><a href="#problem" className="mw-btn-quiet mw-btn-lg">Why it matters</a></>}
      aside={<GlassList title="What your market gets" items={['Depth from the first day', 'Tighter spreads and fairer prices', 'Holders who earn from its trading', 'Every position visible on-chain']} />}
    />

    {/* 1 — the problem */}
    <Section id="problem" tint>
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 items-center">
        <div>
          <SectionHead eyebrow="The launch problem" title="A thin market" soft="makes a good asset look bad." />
          <p className="mt-6 mb-0 text-[17px] leading-[1.6] text-ink-mid max-w-[52ch]">Wide spreads scare off buyers. One sale moves the price. Holders who can’t get out at a fair price stop trusting the token, and the asset never gets the valuation it deserves.</p>
        </div>
        <DepthCompare />
      </div>
    </Section>

    {/* 2 — rented vs owned */}
    <Section>
      <SectionHead
        eyebrow="Two ways to get depth"
        title="Rent it,"
        soft="or let your holders own it."
        aside="Most issuers hire a market maker and hope the depth outlasts the contract. Mintware turns the people who already believe in your asset into its market."
      />
      <div className="mt-12 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="mw-inset rounded-[26px] p-[clamp(22px,3vw,32px)]">
          <div className="flex justify-between items-center"><div className="font-semibold text-ink-mid">Rented market maker</div><span className="text-[12px] text-ink-soft">The usual fix</span></div>
          <div className="mt-[18px]">{COMPARE.map(([k, a]) => <div key={k} className="grid grid-cols-[1fr_1.2fr] gap-3 py-3.5 text-[15px]" style={{ borderTop: '1px solid var(--mw-line)' }}><span className="text-ink-soft">{k}</span><span className="text-ink-mid">{a}</span></div>)}</div>
        </div>
        <div className="mw-raise-lg rounded-[26px] p-[clamp(22px,3vw,32px)]" style={{ outline: '2px solid rgba(91,91,230,.28)', outlineOffset: -2 }}>
          <div className="flex justify-between items-center"><div className="font-semibold">Your holders as the market</div><span className="text-[12px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'var(--mw-btn)' }}>Mintware</span></div>
          <div className="mt-[18px]">{COMPARE.map(([k, , b]) => <div key={k} className="grid grid-cols-[1fr_1.2fr] gap-3 py-3.5 text-[15px]" style={{ borderTop: '1px solid var(--mw-line)' }}><span className="text-ink-soft">{k}</span><span className="font-medium">{b}</span></div>)}</div>
        </div>
      </div>
    </Section>

    {/* 3 — going live */}
    <section style={{ background: 'var(--mw-band)', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className="mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)] py-[clamp(64px,8vw,120px)]">
        <SectionHead
          eyebrow="Going live"
          title="From tokenized"
          soft="to traded."
          aside="We work with a small number of issuers at a time, and every market is reviewed by a person before it opens."
        />
        <ol className="mt-12 p-0 list-none grid gap-4 grid-cols-1 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {STAGES.map((s, i) => (
            <li key={s.t} className="mw-raise rounded-[22px] p-6 flex flex-col">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${(i + 1) * 25}%`, background: '#7C7AF0' }} /></div>
              <div className="flex items-center justify-between mt-5"><IconTile>{s.icon}</IconTile><span className="font-geist-mono text-[12px] text-ink-soft">Step {i + 1}</span></div>
              <div className="font-semibold text-[18px] tracking-[-0.02em] mt-5">{s.t}</div>
              <div className="text-[14.5px] text-ink-mid leading-[1.5] mt-1.5">{s.d}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>

    {/* 4 — compliance + where */}
    <Section>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="mw-raise rounded-[26px] p-[clamp(24px,3.4vw,40px)]">
          <IconTile><IconRules /></IconTile>
          <h3 className="font-semibold text-[clamp(24px,2.6vw,32px)] tracking-[-0.03em] leading-[1.12] mt-6 mb-0">Your rules travel with your token.</h3>
          <p className="text-[15.5px] text-ink-mid leading-[1.6] mt-4">Identity and transfer rules stay with the token, so only verified holders take part, and the market unwinds inside its own pool instead of relying on outside liquidators.</p>
          <Link href="/app/rwas" className="mw-btn-quiet mt-4">See it with a tokenized property <Arrow size={16} /></Link>
        </div>
        <div className="mw-raise rounded-[26px] p-[clamp(24px,3.4vw,40px)]">
          <IconTile><IconTrade /></IconTile>
          <h3 className="font-semibold text-[clamp(24px,2.6vw,32px)] tracking-[-0.03em] leading-[1.12] mt-6 mb-0">Built where tokenized stocks trade.</h3>
          <p className="text-[15.5px] text-ink-mid leading-[1.6] mt-4">Mintware runs on Robinhood Chain, where tokenized equities already trade in on-chain pools, and on Base. Both on testnet today, ahead of an external audit.</p>
          <Link href="/markets" className="mw-btn-quiet mt-4">See the markets <Arrow size={16} /></Link>
        </div>
      </div>
    </Section>

    <section id="talk" className="scroll-mt-20">
      <CTA title="Launch" soft="with depth.">
        <div className="w-full max-w-[520px] mx-auto text-left">
          <p className="text-[15px] text-ink-mid text-center mb-5">Tell us about your asset and we’ll be in touch.</p>
          <WaitlistForm source="issuer" button="Bring your asset to market" />
        </div>
      </CTA>
    </section>
  </Page>
}
