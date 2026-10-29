// Desktop mockup of the Mintware Markets screen. Illustrative rows — tagged "Simulated" on screen.
const ROWS: [string, string, string, string, string][] = [
  ['NVDA / USDG', 'Stock token', '$4.2M', '$18.6M', '18.4%'],
  ['TSLA / USDG', 'Stock token', '$3.1M', '$14.2M', '16.9%'],
  ['AAPL / USDG', 'Stock token', '$2.4M', '$9.8M', '12.7%'],
  ['SPY / USDG', 'ETF token', '$5.6M', '$21.3M', '9.8%'],
  ['USTB / USDG', 'Treasuries', '$8.9M', '$6.1M', '5.9%'],
]

export function MarketsMockup() {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/60">
        <span className="w-2.5 h-2.5 rounded-full bg-[#F4A183]" /><span className="w-2.5 h-2.5 rounded-full bg-[#F8C6AC]" /><span className="w-2.5 h-2.5 rounded-full bg-[#BAD2FA]" />
        <span className="ml-3 text-[12px] text-ink-mid font-mono">mintware.finance/markets</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">Simulated</span>
      </div>
      <div className="p-6 max-[800px]:p-3">
        <div className="flex items-center justify-between mb-4">
          <span className="font-semibold text-[16px]">Markets · Robinhood Chain</span>
          <span className="live-chip"><span className="dot" />Live</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[560px]">
            <thead><tr className="text-left text-ink-mid text-[12px]">
              <th className="font-medium py-2">Market</th><th className="font-medium">Type</th><th className="font-medium text-right">Liquidity</th><th className="font-medium text-right">24h volume</th><th className="font-medium text-right">Fee yield</th><th />
            </tr></thead>
            <tbody>
              {ROWS.map(([m, t, l, v, y]) => <tr key={m} className="border-t border-white/70">
                <td className="py-3.5 font-semibold">{m}</td>
                <td><span className="rounded-full bg-white/80 border border-hair px-2.5 py-0.5 text-[11.5px] text-ink-mid">{t}</span></td>
                <td className="text-right font-mono">{l}</td>
                <td className="text-right font-mono">{v}</td>
                <td className="text-right font-mono font-semibold text-mw-green">{y}</td>
                <td className="text-right pl-4"><span className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundImage: 'linear-gradient(135deg, var(--color-peri), var(--color-peri-deep))' }}>Add</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
