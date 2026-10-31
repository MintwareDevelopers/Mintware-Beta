import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { EngineHero } from '@/components/marketing/mineral/EngineHero'
import { MarketScreen } from '@/components/marketing/mineral/MarketScreen'
import { IconIsolated, IconOwned, IconHours, IconFailClosed, IconExit, IconAudited } from '@/components/ui2/MineralIcons'

// Landing (Mineral, 2026-10 redesign). Light and tactile: raised for things you act on, inset for places
// you put something, solid periwinkle buttons, the pastel sheen only on the hero object and soft light.

const wrap = 'mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)]'
const h2 = 'font-semibold tracking-[-0.04em] leading-[1.04] text-[clamp(34px,4.4vw,54px)] mt-3'

const FEATURES: [string, string, ReactNode][] = [
  ['Isolated per asset', 'One market’s trouble stays in that market.', <IconIsolated key="i" size={24} />],
  ['Non‑custodial core', 'Your position is yours, on-chain, the whole time.', <IconOwned key="o" size={24} />],
  ['Market‑hours aware', 'Marks follow the real asset, including when it’s closed.', <IconHours key="h" size={24} />],
]

const JOBS = [
  { name: 'Liquidity', body: 'Provide to an asset’s market. The engine pairs it into that asset’s pool and fees build on your position.', pill: 'Testnet', pillCls: 'bg-[#E3F4EA] text-[#0F7A43]', side: '#6B69E6', top: '#C3C2FD', dot: true },
  { name: 'Collateral', body: 'Use a position as collateral without pulling it out of the market. It keeps providing depth while it backs a loan.', pill: 'In development', pillCls: 'bg-[#EDE9FB] text-[#4B2FA0] mw-tex-dots', side: '#9C8EE6', top: '#E1DBFA', tex: 'dots' },
  { name: 'Credit', body: 'Borrowing that unwinds gradually inside the pool, on fresh marks only. No outside liquidator racing a closed market.', pill: 'Roadmap', pillCls: 'bg-[#F2F2F5] text-[#454552] mw-tex-hatch', side: '#E08A62', top: '#FAD3C1', tex: 'hatch' },
]

const FLOW: [string, string, string][] = [
  ['01', 'Provide', 'Pick an asset’s market.'],
  ['02', 'Engine pairs it', 'Into that asset’s own pool.'],
  ['03', 'Fees accrue', 'Compounded into your share.'],
  ['04', 'Exit pro‑rata', 'No lockups, no tiers.'],
]

const WHY: [string, string, string][] = [
  ['One asset fails', 'Every lender feels it', 'Contained to that market'],
  ['Market is closed', 'Stale prices, bad liquidations', 'Marks pause, nothing forced'],
  ['Permissioned token', 'Outside liquidators can’t hold it', 'Unwinds inside the pool'],
  ['Last resort', 'Hope there’s a buyer', 'Issuer mint & redeem'],
]

const ROADMAP = [
  { when: 'Now', name: 'Stocks', body: 'Tokenized equities on Robinhood Chain and Base.', status: 'Testnet', lead: true, h: 'min-h-[260px]' },
  { when: 'Now', name: 'Property', body: 'A real-property market with issuer-checked ownership.', status: 'Testnet demo', h: 'min-h-[230px]' },
  { when: 'Next', name: 'Gold', body: 'A gold engine, with first credit through an integrated lending market.', h: 'min-h-[200px]', tex: 'mw-tex-dots' },
  { when: 'Later', name: 'Credit & vaults', body: 'Curated credit modules on top of proven engines.', h: 'min-h-[170px]', well: true, tex: 'mw-tex-hatch' },
]

const TRUST: [string, string, ReactNode][] = [
  ['Fail closed by default', 'Anything unset or unreadable stops, rather than guessing.', <IconFailClosed key="f" />],
  ['Exits stay open', 'Pausing blocks new liquidity, never withdrawals.', <IconExit key="e" />],
  ['Contained per asset', 'Each market has its own caps, marks and controls.', <IconIsolated key="c" />],
  ['Audited before real value', 'An external audit gates mainnet. Until then: testnet only.', <IconAudited key="a" />],
]

const FAQ: [string, string][] = [
  ['What is Mintware?', 'Mintware is the liquidity layer for on-chain value. It turns capital into always-working liquidity for markets in tokenized stocks, real-world assets and stablecoins — and lets you earn from it.'],
  ['How does my money earn?', 'Your capital earns a share of the fees from every trade in the markets you back, plus yield on whatever the market doesn’t need at that moment. Two sources, one balance.'],
  ['Can I withdraw at any time?', 'There are no lockups. You can withdraw whenever you choose and you’re paid in your share of the market’s assets. An exit can be delayed if a token’s issuer pauses it or the market is short of liquidity.'],
  ['Who holds my funds?', 'You do. Mintware is non-custodial — your shares sit in your own wallet, and every contract and transaction is on-chain.'],
  ['Where does Mintware run?', 'Markets run on Robinhood Chain and Base testnets today, ahead of an external audit.'],
  ['Are there risks?', 'Yes, as with any market. Providing liquidity carries price risk and impermanent loss, tokenized assets carry issuer risk, and smart contracts carry technical risk. Read the full risk disclosures before you use Mintware.'],
]

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>{children}</div>
}

function Arrow({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}

function StatusLegend() {
  const chip = 'inline-block w-3.5 h-3.5 rounded-[4px] align-[-2px] mr-2'
  return <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]" style={{ color: 'var(--mw-ink-3)' }} aria-label="Status key">
    <span><span className={chip} style={{ background: '#7C7AF0' }} />Solid: live</span>
    <span><span className={`${chip} mw-tex-dots`} style={{ backgroundColor: '#E1DBFA' }} />Dotted: building</span>
    <span><span className={`${chip} mw-tex-hatch`} style={{ backgroundColor: '#ECECF2' }} />Hatched: planned</span>
  </div>
}

export default function HomePage() {
  return <main className="font-geist min-h-screen overflow-x-hidden antialiased" style={{ background: 'var(--mw-ground)', color: 'var(--mw-ink)' }}>
    <div className="px-4 py-2.5 text-center text-[13px]" style={{ background: 'var(--mw-band)', borderBottom: '1px solid var(--mw-line)', color: 'var(--mw-ink-2)' }}>
      Testnet preview on Robinhood Chain and Base. Mock tokens only, unaudited. <Link href="/risk-disclosures" className="font-medium" style={{ color: 'var(--mw-peri-deep)' }}>What that means</Link>
    </div>
    <V2Nav />

    {/* Hero */}
    <section className="relative">
      <svg aria-hidden="true" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-x-0 -top-10 w-full h-[calc(100%+40px)] pointer-events-none" style={{ maskImage: 'linear-gradient(to bottom, #000 72%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)' }}>
        <defs><radialGradient id="halo" cx="70%" cy="62%" r="40%"><stop offset="0" stopColor="#C9C0F4" stopOpacity=".55" /><stop offset=".55" stopColor="#F2CBC2" stopOpacity=".18" /><stop offset="1" stopColor="#F6F6FA" stopOpacity="0" /></radialGradient></defs>
        <rect width="1400" height="900" fill="url(#halo)" />
        <g fill="none" stroke="#5B5BE6" strokeOpacity="0.07">
          {[[160, 48], [260, 80], [370, 114], [490, 152], [620, 192], [760, 236], [910, 282]].map(([rx, ry]) => <ellipse key={rx} cx="980" cy="640" rx={rx} ry={ry} />)}
        </g>
      </svg>
      <div className={`${wrap} relative pt-[clamp(40px,6vw,88px)] pb-[clamp(40px,5vw,72px)] flex flex-wrap items-center gap-10`}>
        <div className="flex-[1_1_460px] min-w-0 flex flex-col gap-7">
          <div className="mw-raise-sm self-start inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-[13px]" style={{ color: 'var(--mw-ink-2)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#22A45D', boxShadow: '0 0 0 4px rgba(34,164,93,.15)' }} />
            Stock markets live on testnet
          </div>
          <h1 className="m-0 font-semibold text-[clamp(52px,7.4vw,96px)] leading-[0.96] tracking-[-0.05em]">
            One engine<br />
            <span style={{ backgroundImage: 'linear-gradient(100deg,#4643D1 0%,#7A4FD0 55%,#C9572B 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>per asset.</span>
          </h1>
          <p className="m-0 max-w-[500px] text-[clamp(17px,1.6vw,20px)] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>Liquidity, collateral and credit for tokenized stocks, gold and property. Each asset gets its own isolated, non‑custodial market.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/markets" className="mw-btn !min-h-[54px] !px-[26px] !rounded-[14px] text-[16px]">Explore markets <Arrow /></Link>
            <a href="#how" className="mw-btn-quiet !min-h-[54px] !px-[22px] !rounded-[14px] text-[16px]">How it works</a>
          </div>
          <div className="flex flex-wrap gap-[18px] text-[14px]" style={{ color: 'var(--mw-ink-3)' }}>
            {['Never idle', 'Never locked', 'Always yours'].map((t) => (
              <span key={t} className="inline-flex items-center gap-[7px]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0F7A43" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>{t}</span>
            ))}
          </div>
        </div>
        <div className="flex-[1_1_460px] min-w-0"><EngineHero /></div>
      </div>

      <div className={`${wrap} relative pb-[clamp(56px,7vw,96px)]`}>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {FEATURES.map(([t, b, icon]) => (
            <div key={t} className="mw-raise-sm rounded-[18px] px-[22px] py-5 flex gap-3.5 items-start">
              <span className="flex-none w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{icon}</span>
              <div><div className="font-semibold">{t}</div><div className="text-[14px] mt-1 leading-[1.45]" style={{ color: 'var(--mw-ink-3)' }}>{b}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* The model */}
    <section id="how" className="bg-white" style={{ borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-col gap-12`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div className="max-w-[620px]"><Eyebrow>The model</Eyebrow><h2 className={h2}>Three jobs. One market.</h2></div>
          <p className="m-0 max-w-[420px] text-[17px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>Most protocols split trading, borrowing and lending across systems that never talk. Mintware keeps them in the same pool, so the same capital does all three.</p>
        </div>
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          {JOBS.map((j) => (
            <div key={j.name} className="mw-lift rounded-[24px] p-8 flex flex-col gap-5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-raise)' }}>
              <div className="flex justify-between items-center">
                <svg width="64" height="40" viewBox="0 0 64 40" aria-hidden="true">
                  <defs>
                    <pattern id={`jt-${j.name}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform={j.tex === 'hatch' ? 'rotate(45)' : undefined}>
                      {j.tex === 'hatch' ? <line x1="0" y1="0" x2="0" y2="5" stroke="#15151D" strokeOpacity=".22" strokeWidth="1.4" /> : <circle cx="2.5" cy="2.5" r=".9" fill="#2E1F7A" fillOpacity=".35" />}
                    </pattern>
                  </defs>
                  <path d="M4,16 A28 9 0 0 0 60,16 L60,24 A28 9 0 0 1 4,24 Z" fill={j.side} />
                  <ellipse cx="32" cy="16" rx="28" ry="9" fill={j.top} />
                  {j.tex && <><path d="M4,16 A28 9 0 0 0 60,16 L60,24 A28 9 0 0 1 4,24 Z" fill={`url(#jt-${j.name})`} /><ellipse cx="32" cy="16" rx="28" ry="9" fill={`url(#jt-${j.name})`} /></>}
                </svg>
                <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-[5px] rounded-full ${j.pillCls}`}>{j.dot && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{j.pill}</span>
              </div>
              <div><h3 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">{j.name}</h3><p className="mt-2.5 mb-0 text-[15px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>{j.body}</p></div>
            </div>
          ))}
        </div>
        <div className="mw-inset rounded-[24px] p-[clamp(20px,3vw,36px)] grid items-center gap-4 grid-cols-1 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          {FLOW.map(([n, t, b], i) => (
            <div key={n} className="contents">
              {i > 0 && <span className="hidden min-[1100px]:block" style={{ color: 'var(--mw-ink-3)' }}><Arrow size={24} /></span>}
              <div className="mw-raise-sm h-full rounded-2xl px-5 py-[18px]">
                <div className="font-geist-mono text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>{n}</div>
                <div className="font-semibold mt-1.5">{t}</div>
                <div className="text-[14px] mt-1" style={{ color: 'var(--mw-ink-3)' }}>{b}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Inside a market */}
    <section>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-wrap gap-[clamp(32px,5vw,72px)] items-center`}>
        <div className="flex-[1_1_340px] min-w-0">
          <Eyebrow>Inside a market</Eyebrow>
          <h2 className={h2}>Everything on one screen.</h2>
          <ol className="mt-8 p-0 list-none flex flex-col gap-[22px]">
            {[
              ['A live mark that knows the hours', 'See when the real market is open, and when the engine is holding still.'],
              ['Provide in one step', 'Type an amount. See your shares and your slippage floor before you sign.'],
              ['Your position, plainly', 'Value, what you put in and fees earned. Exit any share of it, pro‑rata.'],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex-none w-8 h-8 rounded-full grid place-items-center text-[14px] font-semibold text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>{i + 1}</span>
                <div><div className="font-semibold">{t}</div><div className="mt-1 text-[15px] leading-[1.5]" style={{ color: 'var(--mw-ink-2)' }}>{b}</div></div>
              </li>
            ))}
          </ol>
          <Link href="/markets" className="mw-btn-quiet mt-8 !min-h-[48px] !rounded-[14px] font-semibold">Browse live markets <Arrow size={16} /></Link>
        </div>

        <div className="flex-[1.3_1_480px] min-w-0"><MarketScreen /></div>
      </div>
    </section>

    {/* Why per asset */}
    <section style={{ background: 'var(--mw-band)', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-col gap-11`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div className="max-w-[640px]"><Eyebrow>Why per asset</Eyebrow><h2 className={h2}>Real assets break in real ways.</h2></div>
          <p className="m-0 max-w-[420px] text-[17px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>An issuer freezes. A market closes for the weekend. A deed takes weeks. A shared pool spreads that damage. A per‑asset engine keeps it where it started.</p>
        </div>
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <div className="mw-inset rounded-[26px] p-[clamp(22px,3vw,32px)]">
            <div className="flex justify-between items-center"><div className="font-semibold" style={{ color: 'var(--mw-ink-2)' }}>One shared pool</div><span className="text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>How most lending works</span></div>
            <div className="mt-[18px]">{WHY.map(([k, a]) => <div key={k} className="grid grid-cols-[1fr_1.2fr] gap-3 py-3.5 text-[15px]" style={{ borderTop: '1px solid var(--mw-line)' }}><span style={{ color: 'var(--mw-ink-3)' }}>{k}</span><span style={{ color: 'var(--mw-ink-2)' }}>{a}</span></div>)}</div>
          </div>
          <div className="mw-raise-lg relative rounded-[26px] p-[clamp(22px,3vw,32px)]" style={{ outline: '2px solid rgba(91,91,230,.28)', outlineOffset: -2 }}>
            <div className="flex justify-between items-center"><div className="font-semibold">One engine per asset</div><span className="text-[12px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'var(--mw-btn)' }}>Mintware</span></div>
            <div className="mt-[18px]">{WHY.map(([k, , b]) => <div key={k} className="grid grid-cols-[1fr_1.2fr] gap-3 py-3.5 text-[15px]" style={{ borderTop: '1px solid var(--mw-line)' }}><span style={{ color: 'var(--mw-ink-3)' }}>{k}</span><span className="font-medium">{b}</span></div>)}</div>
          </div>
        </div>
      </div>
    </section>

    {/* Roadmap */}
    <section>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-col gap-11`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div className="max-w-[640px]">
            <Eyebrow>Roadmap</Eyebrow><h2 className={h2}>Asset by asset.</h2>
            <p className="mt-4 mb-0 text-[17px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>Each asset class gets its own engine, tuned to how that asset actually trades and settles.</p>
          </div>
          <StatusLegend />
        </div>
        <div className="grid gap-4 items-end [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
          {ROADMAP.map((r) => (
            <div key={r.name} className={`${r.well ? 'mw-inset' : r.lead ? 'mw-raise-lg' : 'mw-raise-sm'} rounded-[22px] p-[26px] ${r.h} ${r.tex ?? ''} flex flex-col justify-between`} style={r.lead ? { outline: '2px solid rgba(91,91,230,.3)', outlineOffset: -2 } : undefined}>
              <div className="flex justify-between items-center">
                <span className="font-geist-mono text-[13px]" style={{ color: 'var(--mw-ink-3)' }}>{r.when}</span>
                {r.status && <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F7A43]"><span className="w-[7px] h-[7px] rounded-full bg-[#22A45D]" />{r.status}</span>}
              </div>
              <div><div className="text-[26px] font-semibold tracking-[-0.03em]">{r.name}</div><div className="text-[14px] mt-2 leading-[1.5]" style={{ color: 'var(--mw-ink-3)' }}>{r.body}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Issuers */}
    <section className="pb-[clamp(64px,8vw,120px)]">
      <div className={wrap}>
        <div className="mw-raise-lg relative overflow-hidden rounded-[28px] p-[clamp(28px,5vw,56px)] grid gap-10 items-center lg:grid-cols-[1.1fr_1fr]">
          <div aria-hidden="true" className="absolute -left-32 -bottom-40 w-[420px] h-[420px] rounded-full opacity-30 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
          <div className="relative">
            <Eyebrow>For issuers</Eyebrow>
            <h2 className={h2}>Your token. <span style={{ color: 'var(--mw-ink-3)' }}>Real liquidity.</span></h2>
            <p className="mt-5 mb-0 text-[17px] leading-[1.6] max-w-[44ch]" style={{ color: 'var(--mw-ink-2)' }}>Deep, fair markets from day one — funded by your holders, not a rented market maker.</p>
            <Link href="/issuers#talk" className="mw-btn mt-8 !min-h-[52px] !px-6 !rounded-[14px]">Bring your asset to market <Arrow size={16} /></Link>
          </div>
          <div className="relative grid grid-cols-2 gap-3">
            {[['Day one', 'depth at launch'], ['Tighter', 'spreads'], ['Liquidity', 'that stays'], ['On-chain', 'and in the open']].map(([a, b]) => (
              <div key={a} className="rounded-[18px] p-6" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><div className="text-[22px] font-semibold tracking-[-0.02em]">{a}</div><div className="text-[13px] mt-1" style={{ color: 'var(--mw-ink-3)' }}>{b}</div></div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* Trust */}
    <section className="bg-white" style={{ borderTop: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] flex flex-wrap gap-12 items-start`}>
        <div className="flex-[1_1_340px] min-w-0">
          <Eyebrow>Trust</Eyebrow><h2 className={h2}>Boring where it counts.</h2>
          <p className="mt-4 mb-0 text-[17px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>The parts that hold your money are built to be predictable, and to stop rather than guess.</p>
          <Link href="/proof" className="inline-block mt-6 text-[15px] font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>See it on-chain →</Link>
        </div>
        <div className="mw-raise-sm flex-[2_1_520px] min-w-0 grid gap-px rounded-[22px] overflow-hidden [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]" style={{ background: 'var(--mw-line)' }}>
          {TRUST.map(([t, b, icon]) => <div key={t} className="bg-white p-[26px]"><div className="mb-4 w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{icon}</div><div className="font-semibold">{t}</div><div className="text-[14px] mt-1.5 leading-[1.5]" style={{ color: 'var(--mw-ink-3)' }}>{b}</div></div>)}
        </div>
      </div>
    </section>

    {/* FAQ */}
    <section style={{ borderTop: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] grid gap-12 lg:grid-cols-[1fr_1.6fr]`}>
        <div><Eyebrow>FAQ</Eyebrow><h2 className={h2}>Questions, answered.</h2></div>
        <div className="mw-raise rounded-[24px] px-6 max-[640px]:px-4">
          {FAQ.map(([q, a], i) => (
            <details key={q} className="group py-5" style={i ? { borderTop: '1px solid var(--mw-line)' } : undefined}>
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-[17px] font-semibold min-h-[44px]">{q}<span className="text-[22px] leading-none transition-transform group-open:rotate-45" style={{ color: 'var(--mw-peri-deep)' }}>+</span></summary>
              <p className="text-[15px] leading-[1.65] mt-2 mb-0 max-w-[62ch]" style={{ color: 'var(--mw-ink-2)' }}>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>

    {/* CTA */}
    <section className="px-[clamp(16px,4vw,40px)] pb-[clamp(56px,7vw,96px)]">
      <div className="mw-raise-lg mx-auto max-w-[1200px] relative overflow-hidden rounded-[28px] p-[clamp(32px,5vw,64px)] flex flex-wrap items-center justify-between gap-7">
        <div aria-hidden="true" className="absolute -right-[120px] -top-[120px] w-[420px] h-[420px] rounded-full opacity-35 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
        <div className="relative max-w-[560px]">
          <h2 className="m-0 font-semibold text-[clamp(30px,3.6vw,44px)] tracking-[-0.035em] leading-[1.08]">See a market up close.</h2>
          <p className="mt-3 mb-0 text-[17px] leading-[1.55]" style={{ color: 'var(--mw-ink-2)' }}>Browse the live markets on testnet, with mock tokens and no real funds.</p>
        </div>
        <Link href="/app/markets" className="mw-btn relative !min-h-[54px] !px-[26px] !rounded-[14px]">Launch app <Arrow /></Link>
      </div>
      <p className="mx-auto max-w-[1200px] mt-8 text-[13px] leading-[1.55]" style={{ color: 'var(--mw-ink-3)' }}>Testnet software, not an offer. Tokenized assets carry issuer, market, liquidity and smart‑contract risk, and you bear impermanent loss on liquidity you provide. Figures in the market illustration are examples. <Link href="/risk-disclosures" style={{ color: 'var(--mw-peri-deep)' }}>Risk disclosures</Link></p>
    </section>
  </main>
}
