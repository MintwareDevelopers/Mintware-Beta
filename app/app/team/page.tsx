// Team · Treasury Overview — the terminal's home. Design-forward preview: NAV hero,
// KPI row (available-to-spend / yield / allocation), a live-authorization feed
// (our edge-auth differentiator, framed "preview"), and allocation breakdown.
// All figures ILLUSTRATIVE — the ULV/cards stack is in testing, nothing here is live.

const KPIS = [
  { k: 'Available to spend', v: '$2.41M', s: 'credit against NAV' },
  { k: '30-day net APY', v: '6.2%', s: 'Aave + v4 capture' },
  { k: 'Allocated to vaults', v: '$5.80M', s: '73% of treasury' },
  { k: 'Unencumbered', v: '$1.14M', s: 'free of card holds' },
]

const FEED = [
  { who: 'AWS · us-east-1', amt: '$4,182.00', t: '2s ago', ms: '118 ms', ok: true },
  { who: 'Meta Ads', amt: '$12,500.00', t: '1m ago', ms: '104 ms', ok: true },
  { who: 'Delta Air Lines', amt: '$2,340.55', t: '4m ago', ms: '131 ms', ok: true },
  { who: 'Figma', amt: '$960.00', t: '12m ago', ms: '—', ok: false },
]

const ALLOC = [
  { name: 'USDC · Growth ULV', pct: 52, color: 'var(--color-peri)' },
  { name: 'ETH / USDC pair', pct: 21, color: 'var(--color-coral2)' },
  { name: 'Aave idle buffer', pct: 20, color: 'var(--color-peri-deep)' },
  { name: 'Reserve (unallocated)', pct: 7, color: 'var(--color-ink-soft)' },
]

export default function TreasuryOverview() {
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-medium text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Treasury Overview</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Preview · illustrative</span>
      </div>

      {/* NAV hero */}
      <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-6 mt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Total treasury NAV</div>
            <div className="font-atx-display font-medium text-[clamp(2.2rem,5vw,3.4rem)] tracking-[-0.03em] text-ink leading-none mt-2 tabular-nums">$7,943,204</div>
            <div className="text-[12px] text-ink-mid mt-2"><span className="text-mw-green font-semibold">▲ $48,102</span> · +0.61% · past 30 days</div>
          </div>
          <div className="inline-flex rounded-full bg-ground-cool p-0.5 text-[11px] font-semibold">
            {['7D', '30D', '1Y'].map((t, i) => (
              <span key={t} className={`px-3 py-1.5 rounded-full ${i === 1 ? 'bg-white text-ink shadow-card' : 'text-ink-soft'}`}>{t}</span>
            ))}
          </div>
        </div>
        {/* sparkline placeholder */}
        <div className="mt-5 h-[64px] rounded-xl bg-gradient-to-b from-peri/[0.08] to-transparent border border-hair-soft flex items-end overflow-hidden">
          <svg viewBox="0 0 400 64" preserveAspectRatio="none" className="w-full h-full">
            <polyline points="0,48 40,44 80,46 120,38 160,40 200,30 240,33 280,24 320,26 360,16 400,18" fill="none" stroke="var(--color-peri)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 max-[880px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-4">
        {KPIS.map((k) => (
          <div key={k.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{k.k}</div>
            <div className="font-atx-display font-medium text-[22px] tracking-tight text-ink mt-1.5 tabular-nums">{k.v}</div>
            <div className="text-[11px] text-ink-soft mt-0.5">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Feed + allocation */}
      <div className="grid grid-cols-[1.3fr_1fr] max-[880px]:grid-cols-1 gap-4 mt-4">
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
            <span className="font-atx-display font-semibold text-[14px] text-ink">Live authorization feed</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">sub-150ms edge-auth</span>
          </div>
          {FEED.map((f) => (
            <div key={f.who} className="flex items-center gap-3 px-5 py-3 border-b border-hair-soft last:border-0">
              <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${f.ok ? 'bg-mw-green' : 'bg-[#D14343]'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">{f.who}</div>
                <div className="text-[10.5px] text-ink-soft">{f.ok ? 'Approved' : 'Declined · over policy'} · {f.t}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] tabular-nums text-ink">{f.amt}</div>
                <div className="text-[10px] text-ink-soft font-mono">{f.ms}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
          <div className="font-atx-display font-semibold text-[14px] text-ink mb-3.5">Allocation</div>
          <div className="flex h-2.5 rounded-full overflow-hidden mb-4">
            {ALLOC.map((a) => <span key={a.name} style={{ width: `${a.pct}%`, background: a.color }} />)}
          </div>
          <div className="flex flex-col gap-2.5">
            {ALLOC.map((a) => (
              <div key={a.name} className="flex items-center gap-2.5">
                <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: a.color }} />
                <span className="text-[12.5px] text-ink-mid flex-1 truncate">{a.name}</span>
                <span className="text-[12.5px] font-semibold text-ink tabular-nums">{a.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Figures are illustrative. The ULV vault engine is in testing on Base Sepolia; corporate cards and on-chain settlement are in development — nothing here is live or an offer.</p>
    </>
  )
}
