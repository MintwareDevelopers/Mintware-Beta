'use client'

import { fmtUSD, iconColor } from '@/lib/web2/api'
import type { ScoreResponse } from '../types'

interface Props {
  data: ScoreResponse | null
  loading: boolean
}

export function PortfolioTab({ data, loading }: Props) {
  return (
    <>
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="mw-accent-card rounded-xl h-[64px] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Holdings ──────────────────────────────────────────────────────────── */}
      {!loading && data && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3">
              On-chain assets
            </span>
            {(data.projects?.length ?? 0) > 0 && (
              <span className="text-[11px] font-bold font-mono text-mw-ink">
                {fmtUSD(data.projects!.reduce((s, p) => s + p.deployed, 0))} total
              </span>
            )}
          </div>

          {(data.projects?.length ?? 0) === 0 ? (
            <div className="mw-accent-card rounded-xl px-5 py-10 flex flex-col items-center text-center gap-2">
              <div className="text-[28px] opacity-20">◆</div>
              <div className="text-[13px] font-semibold text-mw-ink-3">No on-chain assets detected</div>
              <div className="text-[11px] text-mw-ink-4 max-w-[240px] leading-[1.55]">
                Hold tokens, provide liquidity, or bridge to Base — assets appear here once indexed.
              </div>
              <a
                href="/swap"
                className="mt-2 text-[11px] font-semibold text-mw-brand no-underline hover:underline"
              >
                Start with a swap →
              </a>
            </div>
          ) : (
            <div className="mw-accent-card rounded-xl overflow-hidden shadow-[var(--shadow-card)]">
              {data.projects!
                .slice()
                .sort((a, b) => b.deployed - a.deployed)
                .map((p, i, arr) => {
                  const ic = iconColor(p.symbol || p.name)
                  const maxDeployed = arr[0].deployed || 1
                  const barPct = Math.round((p.deployed / maxDeployed) * 100)
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-[rgba(0,0,0,0.02)]"
                      style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--color-mw-border)' : undefined }}
                    >
                      <div
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[13px] font-bold shrink-0"
                        style={{ background: ic.bg, color: ic.fg }}
                      >
                        {p.symbol?.slice(0, 3) ?? p.name?.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-[3px]">
                          <span className="text-[13px] font-semibold text-mw-ink truncate">{p.name}</span>
                          <span className="text-[10px] text-mw-ink-4 shrink-0">{p.cat}</span>
                          {p.stillActive && (
                            <span className="w-[5px] h-[5px] rounded-full bg-mw-live shrink-0" title="Active position" />
                          )}
                        </div>
                        <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--color-mw-border)' }}>
                          <div
                            className="h-full rounded-full transition-[width] duration-700"
                            style={{ width: `${barPct}%`, background: ic.fg }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold font-mono text-mw-ink">{fmtUSD(p.deployed)}</div>
                        {p.pnlPct !== 0 ? (
                          <div
                            className="text-[10px] font-semibold font-mono mt-[1px]"
                            style={{ color: p.pnlPct >= 0 ? 'var(--color-mw-live)' : 'var(--color-mw-red)' }}
                          >
                            {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                          </div>
                        ) : (
                          <div className="text-[10px] text-mw-ink-4 mt-[1px]">deployed</div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* ── Protocol opportunities ────────────────────────────────────────────── */}
      {!loading && data && data.uvOpportunities?.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3">
              Matched protocols
            </span>
            <span className="text-[11px] text-mw-green font-mono font-bold">
              {fmtUSD(data.totalLo)}–{fmtUSD(data.totalHi)} / yr
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {data.uvOpportunities.map((op, i) => (
              <div
                key={i}
                className="mw-accent-card flex items-start gap-3.5 px-[18px] py-4 rounded-[14px] transition-all duration-150 shadow-[var(--shadow-card)] hover:shadow-md hover:-translate-y-px"
              >
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg shrink-0"
                  style={{ background: op.accentColor + '18', color: op.accentColor }}
                >
                  {op.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-bold text-mw-ink">{op.name}</span>
                    <span className="text-[10px] text-mw-ink-3">{op.cat}</span>
                    <span
                      className="text-[9px] font-bold tracking-[0.5px] uppercase px-[7px] py-px rounded"
                      style={{ color: op.typeColor, background: op.typeColor + '18' }}
                    >
                      {op.type}
                    </span>
                  </div>
                  <div className="text-[11px] text-mw-ink-3 mb-1">{op.mechanic}</div>
                  <div className="text-[11px] text-mw-ink-2 leading-[1.55] whitespace-pre-wrap">{op.reason}</div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <div className="text-[13px] font-bold text-mw-green font-mono">${op.lo}–${op.hi}</div>
                  <div className="text-[10px] text-mw-ink-3 mt-0.5">est. / yr</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-12 text-mw-ink-3 text-[13px]">
          Could not load data. The API may be indexing your wallet.
        </div>
      )}
    </>
  )
}
