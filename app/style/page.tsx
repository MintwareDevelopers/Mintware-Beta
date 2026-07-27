import { notFound } from 'next/navigation'

// Gated: only in dev, or when NEXT_PUBLIC_ATX_PREVIEW=true. Not linked in nav.
const ALLOW =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

function Star({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

const PALETTE = [
  ['Texas Blue', '#006FCC'], ['Mission Coral', '#FF8574'], ['Acid Sun', '#F4FF00'],
  ['Ink', '#111111'], ['Bone', '#F1F0E9'], ['Clay', '#C95E43'], ['Mesquite', '#384D35'],
]

export default function StylePage() {
  if (!ALLOW) notFound()

  const label = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
  const line = 'border-atx-ink/20'

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Masthead */}
      <header className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1120px] px-7 flex items-center justify-between h-[62px]">
          <div className="flex items-center gap-3">
            <Star className="w-6 h-6 text-atx-blue" />
            <b className="text-[16px] font-bold tracking-tight">MINTWARE × ATX SETTLEMINT</b>
          </div>
          <span className="font-atx-mono text-[11px] uppercase tracking-[0.1em] border border-atx-ink bg-atx-acid px-2.5 py-1.5">
            Design Foundation · /style
          </span>
        </div>
      </header>

      {/* Blueprint hero */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="mx-auto max-w-[1120px] px-7 py-8 grid gap-7 items-center [grid-template-columns:1.5fr_0.8fr] max-[860px]:[grid-template-columns:1fr]">
          <div>
            <h1 className="font-bold tracking-[-0.03em] leading-[0.82] text-[clamp(56px,11vw,132px)]">
              VAULT<span className="text-atx-grey">S</span>
            </h1>
            <p className="text-[clamp(19px,2.4vw,26px)] font-semibold tracking-tight mt-4">
              Deposit once. The vault does the rest.
            </p>
            <p className="text-atx-ink/55 text-[15px] max-w-[56ch] mt-3.5">
              A Mintware vault is a Uniswap&nbsp;V4 pool with a mint at its core — MEV protection, range
              optimization, idle-capital routing, and attribution-boosted fee share. Two surfaces on one
              ERC-4626 base: permissionless DeFi and legal-wrapped RWA.
            </p>
            <p className="font-atx-mono text-atx-blue uppercase tracking-[0.16em] text-[13px] font-medium mt-[18px]">
              MEV. FEES. IDLE CAPITAL. ATTRIBUTION.
            </p>
          </div>
          <figure className="border border-atx-ink bg-atx-bone m-0">
            <svg viewBox="0 0 300 220" className="block w-full h-auto" aria-hidden="true">
              <circle cx="150" cy="104" r="82" fill="none" stroke="#111111" strokeOpacity="0.35" strokeDasharray="3 5" />
              <circle cx="150" cy="104" r="50" fill="#F4FF00" stroke="#111111" />
              <use href="#atxstar" x="112" y="66" width="76" height="76" fill="none" stroke="#111111" strokeWidth="1.5" />
              <line x1="20" y1="104" x2="280" y2="104" stroke="#111111" strokeOpacity="0.3" />
              <line x1="150" y1="18" x2="150" y2="190" stroke="#111111" strokeOpacity="0.3" />
              <circle cx="150" cy="104" r="3" fill="#006FCC" />
            </svg>
            <figcaption className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/55 px-3 py-2.5 border-t border-atx-ink/20">
              FIG 01 · Two-Surface Vault · MINTWARE-V4
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Title-block */}
      <div className="border-b border-atx-ink grid [grid-template-columns:1.5fr_1fr_1.2fr_1fr_0.9fr] max-[720px]:[grid-template-columns:1fr_1fr]">
        {[
          ['Drawing', 'Vaults — Overview'], ['Surfaces', '002'], ['Base', 'ERC-4626 · UNI V4'], ['Datum', 'MW-001'],
        ].map(([k, v]) => (
          <div key={k} className="px-7 py-3 border-r border-atx-ink/20">
            <div className={label + ' text-[9px] mb-1.5'}>{k}</div>
            <div className="font-bold text-[15px]">{v}</div>
          </div>
        ))}
        <div className="px-7 py-3">
          <div className={label + ' text-[9px] mb-1.5'}>Status</div>
          <div className="font-bold text-[15px] flex items-center">
            <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink inline-block mr-[7px]" />Active
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1120px] px-7">
        {/* Palette */}
        <section className="py-9 border-b border-atx-ink/20">
          <div className="flex items-baseline gap-3.5 mb-6">
            <span className="font-atx-mono text-[12px] text-atx-ink/55">01</span>
            <h2 className="text-[22px] font-bold tracking-tight">Palette</h2>
            <span className={label + ' ml-auto'}>Duotone on Bone or Ink</span>
          </div>
          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 border border-atx-ink">
            {PALETTE.map(([name, hex]) => (
              <div key={name} className="border-r border-b border-atx-ink">
                <div className="h-24" style={{ background: hex }} />
                <div className="px-3 py-2.5">
                  <div className="font-atx-mono text-[12px] uppercase tracking-[0.06em]">{name}</div>
                  <div className="font-atx-mono text-[12px] text-atx-ink/55">{hex}</div>
                </div>
              </div>
            ))}
            <div className="border-r border-b border-atx-ink">
              <div className="h-24 flex items-center justify-center"><Star className="w-10 h-10 text-atx-coral" /></div>
              <div className="px-3 py-2.5">
                <div className="font-atx-mono text-[12px] uppercase tracking-[0.06em]">The Glyph</div>
                <div className="font-atx-mono text-[12px] text-atx-ink/55">✴ eight-point</div>
              </div>
            </div>
          </div>
        </section>

        {/* Type */}
        <section className="py-9 border-b border-atx-ink/20">
          <div className="flex items-baseline gap-3.5 mb-6">
            <span className="font-atx-mono text-[12px] text-atx-ink/55">02</span>
            <h2 className="text-[22px] font-bold tracking-tight">Typography</h2>
            <span className={label + ' ml-auto'}>Space Grotesk · JetBrains Mono</span>
          </div>
          {[
            ['Display / 56', <span className="text-[56px] font-bold tracking-[-0.02em] leading-none">Settlemint</span>],
            ['Heading / 34', <span className="text-[34px] font-bold tracking-tight">Social Liquidity Vaults</span>],
            ['Body / 15', <span className="text-[15px] max-w-[60ch] block">Lock tiers raise your FeeVault multiplier; longer commitment earns a disproportionate share of swap fees over time.</span>],
            ['Data / mono', <span className="font-atx-mono text-[15px] tracking-[0.02em]">TVL $2,412,900 · APY 11.0% · EPOCH T−3d · 50 / 25 / 25</span>],
          ].map(([tag, node], i) => (
            <div key={i} className={`flex items-baseline gap-[18px] py-3.5 ${i ? 'border-t ' + line : ''}`}>
              <span className={label + ' w-[120px] shrink-0'}>{tag}</span>
              {node}
            </div>
          ))}
        </section>

        {/* Primitives */}
        <section className="py-9 border-b border-atx-ink/20">
          <div className="flex items-baseline gap-3.5 mb-6">
            <span className="font-atx-mono text-[12px] text-atx-ink/55">03</span>
            <h2 className="text-[22px] font-bold tracking-tight">Primitives</h2>
            <span className={label + ' ml-auto'}>Square · Hairline · Flat</span>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            <button className="font-semibold text-[14px] px-[18px] py-[11px] border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">Deposit</button>
            <button className="font-semibold text-[14px] px-[18px] py-[11px] border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em]">Request Redeem</button>
            <button className="font-semibold text-[14px] px-[18px] py-[11px] border border-atx-ink bg-atx-acid text-atx-ink uppercase tracking-[0.04em]">Attest Score</button>
            <button className="font-semibold text-[14px] px-[18px] py-[11px] border border-atx-ink bg-transparent uppercase tracking-[0.04em]">Connect Wallet</button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 font-atx-mono text-[11px] uppercase tracking-[0.07em]">
            <span className="px-2 py-1 border border-atx-blue bg-atx-blue text-white">BLUE_CHIP</span>
            <span className="px-2 py-1 border border-atx-ink bg-atx-coral text-atx-ink">RWA · KYC AT REDEEM</span>
            <span className="px-2 py-1 border border-atx-mesquite bg-atx-mesquite text-atx-bone">CORE · 180d</span>
            <span className="px-2 py-1 border border-atx-ink">FLEX</span>
          </div>
        </section>

        {/* Applied vault cards */}
        <section className="py-9">
          <div className="flex items-center gap-3.5 mb-4.5">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">04</span>
            <span className={label}>Two surfaces · one base</span>
          </div>
          <div className="grid grid-cols-2 gap-[22px] max-[800px]:grid-cols-1">
            {/* DeFi */}
            <div className="border border-atx-ink bg-atx-bone">
              <div className="p-[16px_18px] flex items-start justify-between gap-3">
                <div>
                  <p className="text-[19px] font-bold tracking-tight m-0">Social Blue-Chip</p>
                  <p className="text-atx-ink/55 text-[13px] mt-0.5 font-atx-mono">DeFi · ETH/USDC · V4 hook-gated LP</p>
                </div>
                <Star className="w-5 h-5 text-atx-blue" />
              </div>
              <div className={`grid grid-cols-3 border-t ${line}`}>
                {[['TVL', '$2.41M', ''], ['Net APY', '11.0%', 'text-atx-blue'], ['Epoch', 'T−3d', '']].map(([k, v, c], i) => (
                  <div key={k} className={`px-[18px] py-3.5 ${i < 2 ? 'border-r ' + line : ''}`}>
                    <div className={label}>{k}</div>
                    <div className={`font-atx-mono text-[20px] ${c}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div className={`p-[14px_18px] border-t ${line}`}>
                <div className={label + ' mb-2'}>Swap fee · 50 / 25 / 25</div>
                <div className="flex h-7 border border-atx-ink font-atx-mono text-[11px]">
                  <span className="flex items-center justify-center bg-atx-blue text-white border-r border-atx-ink" style={{ flex: 50 }}>DEPOSITORS</span>
                  <span className="flex items-center justify-center bg-atx-coral text-atx-ink border-r border-atx-ink" style={{ flex: 25 }}>MINTWARE</span>
                  <span className="flex items-center justify-center bg-atx-acid text-atx-ink" style={{ flex: 25 }}>PROVIDER</span>
                </div>
              </div>
              <div className={`p-[14px_18px] border-t ${line} flex items-center justify-between`}>
                <span className="font-atx-mono text-[11px] uppercase tracking-[0.07em] px-2 py-1 border border-atx-blue bg-atx-blue text-white">BLUE_CHIP ±6%</span>
                <button className="font-semibold text-[14px] px-4 py-2.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">Deposit</button>
              </div>
            </div>
            {/* RWA */}
            <div className="border border-atx-ink bg-atx-bone">
              <div className="p-[16px_18px] flex items-start justify-between gap-3">
                <div>
                  <p className="text-[19px] font-bold tracking-tight m-0">LiquidHectar Note</p>
                  <p className="text-atx-ink/55 text-[13px] mt-0.5 font-atx-mono">RWA · vRWA/USDC · oracle-banded</p>
                </div>
                <Star className="w-5 h-5 text-atx-coral" />
              </div>
              <div className={`grid grid-cols-3 border-t ${line}`}>
                {[['Underlying', '12.0%', 'text-atx-coral'], ['Net to LP', '~9.0%', ''], ['Settle', '30d', '']].map(([k, v, c], i) => (
                  <div key={k} className={`px-[18px] py-3.5 ${i < 2 ? 'border-r ' + line : ''}`}>
                    <div className={label}>{k}</div>
                    <div className={`font-atx-mono text-[20px] ${c}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div className={`p-[14px_18px] border-t ${line} flex gap-[22px]`}>
                {[['Band', '±15/±45'], ['Reserve', '40/60'], ['vRWA', 'bearer']].map(([k, v]) => (
                  <div key={k}><div className={label}>{k}</div><div className="font-atx-mono text-[15px]">{v}</div></div>
                ))}
              </div>
              <div className={`p-[14px_18px] border-t ${line} flex items-center justify-between`}>
                <span className="font-atx-mono text-[11px] uppercase tracking-[0.07em] px-2 py-1 border border-atx-ink bg-atx-coral text-atx-ink">KYC AT REDEEM</span>
                <button className="font-semibold text-[14px] px-4 py-2.5 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em]">Request Redeem</button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* shared star symbol for <use> */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <symbol id="atxstar" viewBox="0 0 100 100">
          <path d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
        </symbol>
      </svg>
    </div>
  )
}
