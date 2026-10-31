// The "inside a market" illustration: one market screen with numbered callouts (1 live mark, 2 provide,
// 3 your position). Shared by the landing and /markets so both show the same product moment. Figures are examples.

function Badge({ n }: { n: number }) {
  return <span className="absolute -top-3 -right-2.5 w-[26px] h-[26px] rounded-full grid place-items-center text-[12px] font-bold text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>{n}</span>
}

export function MarketScreen() {
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute inset-[8%_-6%_-6%_10%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
      <div className="mw-raise-lg relative rounded-[28px] p-[22px] flex flex-col gap-4" aria-label="Illustration of a market screen" role="img">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex">
              <span className="relative z-[1] w-10 h-10 rounded-full grid place-items-center text-[13px] font-bold" style={{ background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', boxShadow: 'inset 0 1px 0 #fff, 0 0 0 3px #fff', color: '#2E2BA8' }}>TS</span>
              <span className="-ml-2.5 w-10 h-10 rounded-full grid place-items-center text-[11px] font-bold" style={{ background: '#E9F3EE', boxShadow: '0 0 0 3px #fff', color: '#0F5F37' }}>$G</span>
            </div>
            <div><div className="font-semibold text-[18px] tracking-[-0.02em]">TSLA <span className="font-medium" style={{ color: 'var(--mw-ink-3)' }}>/ USDG</span></div><div className="text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>Illustration</div></div>
          </div>
          <div className="relative"><span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[12px] font-semibold bg-[#E3F4EA] text-[#0F7A43]"><span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />Market open · mark live</span><Badge n={1} /></div>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex-[1.4_1_220px] min-w-0">
            <div className="font-geist-mono text-[28px] tracking-[-0.03em]">$248.31 <span className="text-[14px] tracking-normal text-[#0F7A43]">+1.80%</span></div>
            <svg aria-hidden="true" viewBox="0 0 300 110" preserveAspectRatio="none" className="block w-full h-[110px] mt-2">
              <defs><linearGradient id="pvl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5B5BE6" /><stop offset="1" stopColor="#E8794F" /></linearGradient><linearGradient id="pva" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A9A7FA" stopOpacity=".35" /><stop offset="1" stopColor="#A9A7FA" stopOpacity="0" /></linearGradient></defs>
              <path d="M0,86 L20,80 L40,84 L60,70 L80,74 L100,60 L120,66 L140,52 L160,58 L180,44 L200,48 L220,36 L240,40 L260,28 L280,30 L300,18 L300,110 L0,110 Z" fill="url(#pva)" />
              <path d="M0,86 L20,80 L40,84 L60,70 L80,74 L100,60 L120,66 L140,52 L160,58 L180,44 L200,48 L220,36 L240,40 L260,28 L280,30 L300,18" fill="none" stroke="url(#pvl)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="relative flex-[1_1_200px] min-w-0 rounded-[20px] p-3.5 flex flex-col gap-2.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            <Badge n={2} />
            <div className="text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>You provide</div>
            <div className="font-geist-mono text-[26px] tracking-[-0.03em]">1,000.00 <span className="text-[13px]" style={{ color: 'var(--mw-ink-3)' }}>USDG</span></div>
            <div className="text-[12px] flex justify-between" style={{ color: 'var(--mw-ink-3)' }}><span>Shares</span><span className="font-geist-mono" style={{ color: 'var(--mw-ink)' }}>979.14</span></div>
            <div className="min-h-[40px] rounded-xl grid place-items-center font-semibold text-[14px] text-white" style={{ background: 'var(--mw-btn)', boxShadow: 'var(--mw-glow)' }}>Add liquidity</div>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 px-3.5 py-3 rounded-2xl text-[13px]" style={{ background: 'var(--mw-band)' }}>
          <Badge n={3} />
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Value</div><div className="font-geist-mono mt-0.5">$2,431.20</div></div>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Put in</div><div className="font-geist-mono mt-0.5">$2,300.00</div></div>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Fees</div><div className="font-geist-mono mt-0.5 text-[#0F7A43]">+$58.42</div></div>
        </div>
      </div>
    </div>
  )
}
