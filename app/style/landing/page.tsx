import { notFound } from 'next/navigation'

// Gated preview — only in dev, or when NEXT_PUBLIC_ATX_PREVIEW=true. Not linked in nav.
// This is the reframed marketing landing (Phase-3). Promote to app/page.tsx once approved.
const ALLOW =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const CORAL_INK = '#5a1e12'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

const STATS = [
  { n: '24,817', k: 'Wallets scored' },
  { n: '100+', k: 'Chains indexed' },
  { n: '138K', k: 'Referral links' },
  { n: '$3.5M', k: 'Total value locked' },
]

const AUDIENCES = [
  {
    tag: 'Protocols', star: 'text-atx-blue', sq: 'bg-atx-blue',
    tagCls: 'border-atx-blue bg-atx-blue text-white',
    h: 'You’ve been rewarding the wrong people.',
    p: 'Most emissions go to mercenary farmers. Attribution changes who gets rewarded — and why.',
    bullets: ['Reward contributors, not bots', 'Score-weighted distributions', 'One call: getScore(wallet)'],
  },
  {
    tag: 'People', star: 'text-atx-coral', sq: 'bg-atx-coral',
    tagCls: 'bg-atx-coral',
    h: 'You show up every day. DeFi should reward that.',
    p: 'Every LP position, every vote, every referral — invisible to protocols until now.',
    bullets: ['One score across 100+ chains', 'Public profile per wallet', 'Referral network builds rank'],
  },
  {
    tag: 'Agents', star: 'text-atx-mesquite', sq: 'bg-atx-mesquite',
    tagCls: 'border-atx-mesquite bg-atx-mesquite text-atx-bone',
    h: 'Agents transact. Attribution makes them trustworthy.',
    p: 'AI agents are major DeFi participants. Attribution gives them a reputation that compounds.',
    bullets: ['Machine-readable manifests', 'On-chain EAS attestations', 'Reputation that compounds'],
  },
]

const SIGNALS = [
  { n: 'Liquidity', w: '74%', v: '111', c: '#006FCC' },
  { n: 'Volume', w: '41%', v: '41', c: '#006FCC' },
  { n: 'Sharing', w: '58%', v: '232', c: '#FF8574' },
  { n: 'Holding', w: '39%', v: '39', c: '#006FCC' },
]

const ACTIONS = [
  { b: 'Swap', fd: 'Every trade feeds Volume + Trading', pts: 'Volume · Trading', hot: false },
  { b: 'Provide liquidity', fd: 'Real LP positions, held', pts: 'Liquidity · 150', hot: true },
  { b: 'Refer a friend', fd: 'Their activity grows your tree, for life', pts: 'Sharing · 400', hot: true },
  { b: 'Hold quality', fd: 'Conviction — positions over 7 days', pts: 'Holding · 100', hot: false },
  { b: 'Govern', fd: 'Votes and proposals across protocols', pts: 'Governance · 100', hot: false },
  { b: 'Run an agent', fd: 'Machines earn reputation — ERC-8004', pts: 'Agent trust', hot: false },
]

const STEPS = [
  { n: '01', t: 'Deposit USDC', d: 'Any amount. No accreditation, no minimum, no upfront KYC.' },
  { n: '02', t: 'Receive vRWA', d: 'A bearer token, 1:1 with your share. It’s yours to hold or move.' },
  { n: '03', t: 'Earn + trade', d: 'Real-world yield accrues automatically. Trade vRWA on Uniswap, 24/7.' },
  { n: '04', t: 'Redeem — if you want', d: 'Only here does KYC apply, and only if you redeem the underlying.' },
]

const TRAD = ['$50k–$250k minimum', 'KYC before you can invest', 'Locked — phone calls to exit', 'You own a database entry']
const MW = ['Any amount', 'KYC only if you redeem', 'Trade on Uniswap, 24/7', 'You hold a bearer token']

export default function LandingPreview() {
  if (!ALLOW) notFound()

  const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* NAV */}
      <header className="sticky top-0 z-20 bg-atx-bone border-b border-atx-ink">
        <div className="mx-auto max-w-[1220px] px-6 h-[56px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Star className="w-5 h-5 text-atx-blue" />
            <b className="text-[15px] font-bold tracking-[0.06em]">MINTWARE</b>
          </div>
          <nav className="hidden md:flex gap-6 font-atx-mono text-[11px] uppercase tracking-[0.14em] text-atx-ink/55">
            <span>Vaults</span><span>Attribution</span><span>Agents</span><span>Docs</span>
          </nav>
          <div className="flex gap-2.5">
            <button className="font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-ink bg-atx-bone">✴ Check score</button>
            <button className="font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-blue bg-atx-blue text-white">Launch app →</button>
          </div>
        </div>
      </header>

      {/* HERO 1 */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="mx-auto max-w-[1180px] px-6 py-[52px]">
          <div className={ey}>✴ On-chain reputation · 100+ chains</div>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.96] text-[clamp(40px,7vw,96px)] max-w-[18ch] mt-4">
            Your Contribution should mean <span className="text-atx-blue">something.</span>
          </h1>
          <p className="text-[clamp(15px,1.9vw,21px)] leading-[1.5] text-atx-ink/70 max-w-[46ch] mt-6">
            {'Mintware reads everything you’ve done on-chain, turns it into a score, and pays you more for it — across vaults, referrals, and every action you take.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <button className="font-atx-mono text-[12px] uppercase tracking-[0.08em] px-4 py-3 border border-atx-blue bg-atx-blue text-white">Launch app →</button>
            <button className="font-atx-mono text-[12px] uppercase tracking-[0.08em] px-4 py-3 border border-atx-ink bg-atx-bone">Check your score</button>
          </div>
        </div>
      </section>

      {/* HERO 2 — product */}
      <section
        className="border-b border-atx-ink grid [grid-template-columns:1.05fr_0.95fr] max-[720px]:[grid-template-columns:1fr]"
        style={{ backgroundImage: GRID_BG }}
      >
        <div className="px-6 py-[44px] border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink">
          <div className={ey}>✴ Two-surface vaults · reputation-weighted yield</div>
          <h2 className="font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(28px,3.4vw,44px)] mt-3.5">
            Real estate, credit, crypto — one vault, <span className="text-atx-blue">no walls.</span>
          </h2>
          <p className="text-[16px] leading-[1.5] text-atx-ink/70 max-w-[34ch] mt-4">
            No KYC. No minimums. DeFi and real-world yield in one deposit — and your score sets the rate.
          </p>
        </div>
        <div className="px-6 py-[30px] bg-atx-panel relative">
          <span className="absolute top-[30px] right-6 font-atx-mono text-[9px] uppercase tracking-[0.14em] text-atx-ink/55 border border-atx-ink/20 px-1.5 py-1">Preview</span>
          <div className={ey}>A vault, up close</div>
          <div className="border border-atx-ink bg-atx-bone mt-3">
            <div className="grid grid-cols-2 border-b border-atx-ink font-atx-mono text-[11px] uppercase tracking-[0.12em] text-center">
              <div className="py-3 border-r border-atx-ink text-atx-ink/55">DeFi</div>
              <div className="py-3 bg-atx-ink text-atx-bone">RWA</div>
            </div>
            <div className="p-4">
              <div className="flex items-baseline justify-between border border-atx-ink px-3.5 py-3.5">
                <span className="text-[24px] font-bold tracking-tight">5,000</span>
                <span className="font-atx-mono text-[11px] text-atx-ink/55">USDC</span>
              </div>
              <div className="mt-3 border-t border-atx-ink/20">
                <Bdr k="Asset yield" v="9.0%" />
                <Bdr k="vRWA swap fees" v="+0.8%" />
                <div className="flex items-center justify-between py-2 border-b border-atx-ink/10 text-[12px] text-atx-ink/80">
                  <span className="flex items-center gap-2">
                    Your multiplier
                    <span className="font-atx-mono text-[9px] bg-atx-acid border border-atx-ink px-1.5 py-0.5">Builder · 82</span>
                  </span>
                  <span className="font-atx-mono">×1.3</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3.5">
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/55">Effective APY</span>
                <span className="font-atx-mono font-bold text-[26px] tracking-tight" style={{ color: CORAL_INK }}>10.4%</span>
              </div>
              <button className="w-full mt-3 py-3 font-atx-mono text-[11px] uppercase tracking-[0.12em] bg-atx-ink text-atx-bone border border-atx-ink">
                Launch app to deposit →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-b border-atx-ink grid grid-cols-4 max-[720px]:grid-cols-2">
        {STATS.map((s, i) => (
          <div key={s.k} className={`px-5 py-6 ${i < 3 ? 'border-r border-atx-ink' : ''} max-[720px]:border-b max-[720px]:border-atx-ink`}>
            <div className="font-atx-mono text-[28px] font-bold tracking-[-0.03em]">{s.n}</div>
            <div className="font-atx-mono text-[9px] uppercase tracking-[0.14em] text-atx-ink/55 mt-1.5">{s.k}</div>
          </div>
        ))}
      </section>

      {/* 01 — THREE AUDIENCES */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[52px]">
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-blue">01</span>
            <span className={ey}>Built for everyone</span>
          </div>
          <h2 className="font-bold tracking-[-0.02em] text-[clamp(24px,3vw,38px)] mt-3.5">One score. Three audiences.</h2>
          <div className="grid grid-cols-3 border border-atx-ink mt-7 max-[720px]:grid-cols-1">
            {AUDIENCES.map((a, i) => (
              <div
                key={a.tag}
                className={`p-[22px] ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}
              >
                <div className="flex items-center justify-between mb-[18px]">
                  <Star className={`w-5 h-5 ${a.star}`} />
                  <span
                    className={`font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2.5 py-1.5 border ${a.tagCls}`}
                    style={a.tag === 'People' ? { color: CORAL_INK, borderColor: CORAL_INK } : undefined}
                  >
                    {a.tag}
                  </span>
                </div>
                <h3 className="text-[19px] font-bold tracking-[-0.01em] leading-[1.18]">{a.h}</h3>
                <p className="text-[14px] leading-[1.5] text-atx-ink/55 mt-3">{a.p}</p>
                <div className="mt-[18px] border-t border-atx-ink/20 pt-3.5 flex flex-col gap-1.5">
                  {a.bullets.map((b) => (
                    <div key={b} className="flex items-center gap-2.5 text-[13.5px] py-1.5">
                      <span className={`w-[9px] h-[9px] border border-atx-ink inline-block shrink-0 ${a.sq}`} />
                      {b}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 02 — HOW IT WORKS */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[52px]">
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-blue">02</span>
            <span className={ey}>How it works</span>
          </div>
          <h2 className="font-bold tracking-[-0.03em] text-[clamp(24px,3vw,38px)] leading-[1.05] max-w-[22ch] mt-3.5">
            Every swap, every referral, <span className="text-atx-blue">every position — rewarded.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-atx-ink/70 max-w-[58ch] mt-3.5">
            {'Your score isn’t a black box. It’s six signals, and everything you already do on-chain feeds them. Do more, score higher, earn a bigger multiplier — automatically.'}
          </p>
          <div className="grid [grid-template-columns:0.85fr_1.15fr] gap-[26px] mt-7 items-start max-[720px]:grid-cols-1">
            {/* score card */}
            <div className="border border-atx-ink bg-atx-bone">
              <div className="flex items-end justify-between p-[18px] border-b border-atx-ink">
                <div>
                  <div className={ey}>Attribution</div>
                  <div className="font-atx-mono text-[52px] font-bold tracking-[-0.04em] leading-[0.9]">82</div>
                </div>
                <span className="font-atx-mono text-[10px] tracking-[0.06em] bg-atx-acid border border-atx-ink px-2 py-1">Builder · top 5%</span>
              </div>
              <div className="px-[18px] py-4 flex flex-col gap-2.5">
                {SIGNALS.map((s) => (
                  <div key={s.n} className="flex items-center gap-2.5">
                    <span className="font-atx-mono text-[10px] text-atx-ink/55 w-[74px]">{s.n}</span>
                    <span className="flex-1 h-2 border border-atx-ink bg-atx-bone">
                      <span className="block h-full" style={{ width: s.w, background: s.c }} />
                    </span>
                    <span className="font-atx-mono text-[10px] w-7 text-right">{s.v}</span>
                  </div>
                ))}
              </div>
              <div className="font-atx-mono text-[10px] text-atx-mesquite px-[18px] py-3 border-t border-atx-ink/20">
                vaultking.mintware · scored across 6 chains
              </div>
            </div>
            {/* actions */}
            <div>
              <div className={`${ey} mb-2.5`}>Six signals · everything you do feeds them</div>
              <div className="border-t border-atx-ink/20">
                {ACTIONS.map((a) => (
                  <div key={a.b} className="flex items-center gap-3.5 py-3.5 border-b border-atx-ink/10">
                    <b className="text-[15px] min-w-[132px] max-[720px]:min-w-[110px]">{a.b}</b>
                    <span className="font-atx-mono text-[10.5px] text-atx-ink/55 flex-1 leading-[1.4]">{a.fd}</span>
                    <span
                      className={`font-atx-mono text-[10px] whitespace-nowrap ${
                        a.hot ? 'bg-atx-acid border border-atx-ink px-1.5 py-1 text-atx-ink' : 'text-atx-blue'
                      }`}
                    >
                      {a.pts}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="font-atx-mono text-[12px] text-atx-mesquite mt-[22px] tracking-[0.02em]">
            <b className="text-atx-blue">↳</b> All six roll into one multiplier — the same ×1.3 you saw on the vault. Nothing you do on-chain is wasted.
          </div>
        </div>
      </section>

      {/* 03 — RWA (blue tentpole) */}
      <section className="border-b border-atx-ink bg-atx-blue text-white">
        <div className="mx-auto max-w-[1180px] px-6 py-[56px]">
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-acid">03</span>
            <span className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-white/70">Real-world yield, no gatekeepers</span>
          </div>
          <h2 className="font-bold tracking-[-0.03em] text-[clamp(24px,3vw,38px)] leading-[1.05] max-w-[22ch] mt-3.5">
            Real estate yield, <span className="text-atx-acid">without the $50k door.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-white/90 max-w-[58ch] mt-3.5">
            Tokenized real-world assets have always been walled off — accreditation checks, six-figure minimums, capital locked behind phone calls. Mintware opens the door: deposit any amount, hold a bearer token, earn automatically.
          </p>
          <div className="grid grid-cols-4 border border-white/40 mt-8 max-[720px]:grid-cols-1">
            {STEPS.map((s, i) => (
              <div key={s.n} className={`p-[18px] ${i < 3 ? 'border-r border-white/40 max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-white/40' : ''}`}>
                <div className="font-atx-mono text-[11px] text-atx-acid tracking-[0.08em]">{s.n}</div>
                <div className="text-[15px] font-bold mt-2.5 mb-1.5">{s.t}</div>
                <div className="font-atx-mono text-[10.5px] leading-[1.5] text-white/85">{s.d}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 border border-white/40 mt-4 max-[720px]:grid-cols-1">
            <div className="p-[18px] border-r border-white/40 max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-white/40">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] opacity-75 mb-3">Traditional RWA</div>
              {TRAD.map((r, i) => (
                <div key={r} className={`py-2.5 text-[13px] ${i < TRAD.length - 1 ? 'border-b border-white/20' : ''}`}>{r}</div>
              ))}
            </div>
            <div className="p-[18px]">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-acid mb-3">✴ Mintware</div>
              {MW.map((r, i) => (
                <div key={r} className={`py-2.5 text-[13px] ${i < MW.length - 1 ? 'border-b border-white/20' : ''}`}>{r}</div>
              ))}
            </div>
          </div>
          <div className="text-[19px] font-bold leading-[1.3] max-w-[30ch] mt-7 tracking-[-0.01em]">
            Your real-estate position trades at 3am on a Sunday. <span className="text-atx-acid">Try that with a REIT.</span>
          </div>
        </div>
      </section>

      {/* LAUNCH BAND */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[34px] flex items-center justify-between flex-wrap gap-4">
          <div className="text-[24px] font-bold tracking-[-0.01em] max-w-[24ch]">
            Your wallet already has a history. Come get paid for it.
          </div>
          <button className="font-atx-mono text-[12px] uppercase tracking-[0.08em] px-4 py-3 border border-atx-blue bg-atx-blue text-white">
            Launch app →
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-atx-ink text-atx-bone">
        <div className="mx-auto max-w-[1180px] px-6 py-[30px] flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2.5">
            <Star className="w-5 h-5 text-atx-acid" />
            <b className="text-[15px] tracking-[0.06em]">MINTWARE</b>
          </div>
          <div className="flex gap-5 font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-bone/70 flex-wrap">
            {['Vaults', 'Attribution', 'Agents', 'Issuers', 'Docs'].map((x) => <span key={x}>{x}</span>)}
          </div>
          <div className="font-atx-mono text-[10px] text-atx-bone/55">© 2026 Mintware ✴ Contribution is identity</div>
        </div>
      </footer>
    </div>
  )
}

function Bdr({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-atx-ink/10 text-[12px] text-atx-ink/80">
      <span>{k}</span>
      <span className="font-atx-mono">{v}</span>
    </div>
  )
}
