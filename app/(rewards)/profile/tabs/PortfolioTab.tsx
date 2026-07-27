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
            <div key={n} className="bg-atx-panel border border-atx-ink/25 h-[64px] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Holdings ──────────────────────────────────────────────────────────── */}
      {!loading && data && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="font-atx-mono uppercase tracking-[0.08em] text-[11px] text-atx-ink/55">
              On-chain assets
            </span>
            {(data.projects?.length ?? 0) > 0 && (
              <span className="text-[11px] font-bold font-atx-mono text-atx-ink">
                {fmtUSD(data.projects!.reduce((s, p) => s + p.deployed, 0))} total
              </span>
            )}
          </div>

          {(data.projects?.length ?? 0) === 0 ? (
            <div className="bg-atx-panel border border-atx-ink/25 px-5 py-10 flex flex-col items-center text-center gap-2">
              <svg viewBox="0 0 100 100" className="w-7 h-7 text-atx-coral" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
              <div className="text-[13px] font-semibold text-atx-ink/60">No on-chain assets detected</div>
              <div className="text-[11px] text-atx-ink/55 max-w-[240px] leading-[1.55]">
                Hold tokens, provide liquidity, or bridge to Base — assets appear here once indexed.
              </div>
              <a
                href="/swap"
                className="mt-2 text-[11px] font-semibold text-atx-blue no-underline hover:underline font-atx-mono uppercase tracking-[0.06em]"
              >
                Start with a swap →
              </a>
            </div>
          ) : (
            <div className="bg-atx-panel border border-atx-ink overflow-hidden">
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
                      className="flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-atx-bone"
                      style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(17,17,17,0.15)' : undefined }}
                    >
                      <div
                        className="w-9 h-9 border border-atx-ink flex items-center justify-center text-[13px] font-bold shrink-0 font-atx-mono"
                        style={{ background: ic.bg, color: ic.fg }}
                      >
                        {p.symbol?.slice(0, 3) ?? p.name?.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-[3px]">
                          <span className="text-[13px] font-semibold text-atx-ink truncate">{p.name}</span>
                          <span className="text-[10px] text-atx-ink/55 shrink-0 font-atx-mono">{p.cat}</span>
                          {p.stillActive && (
                            <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block shrink-0" title="Active position" />
                          )}
                        </div>
                        <div className="h-[6px] border border-atx-ink/40 overflow-hidden relative">
                          <div
                            className="h-full bg-atx-blue absolute inset-y-0 left-0 transition-[width] duration-700"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold font-atx-mono text-atx-ink">{fmtUSD(p.deployed)}</div>
                        {p.pnlPct !== 0 ? (
                          <div
                            className="text-[10px] font-semibold font-atx-mono mt-[1px]"
                            style={{ color: p.pnlPct >= 0 ? 'var(--color-atx-mesquite)' : 'var(--color-atx-clay)' }}
                          >
                            {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                          </div>
                        ) : (
                          <div className="text-[10px] text-atx-ink/55 mt-[1px] font-atx-mono">deployed</div>
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
            <span className="font-atx-mono uppercase tracking-[0.08em] text-[11px] text-atx-ink/55">
              Matched protocols
            </span>
            <span className="text-[11px] text-atx-mesquite font-atx-mono font-bold">
              {fmtUSD(data.totalLo)}–{fmtUSD(data.totalHi)} / yr
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {data.uvOpportunities.map((op, i) => (
              <div
                key={i}
                className="bg-atx-panel border border-atx-ink/25 flex items-start gap-3.5 px-[18px] py-4 transition-shadow duration-150 hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]"
              >
                <div
                  className="w-10 h-10 border border-atx-ink bg-atx-bone flex items-center justify-center text-lg shrink-0"
                  style={{ color: op.accentColor }}
                >
                  {op.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-bold text-atx-ink">{op.name}</span>
                    <span className="text-[10px] text-atx-ink/60 font-atx-mono">{op.cat}</span>
                    <span
                      className="text-[9px] font-bold tracking-[0.08em] uppercase px-[7px] py-px border border-atx-ink/25 font-atx-mono"
                      style={{ color: op.typeColor }}
                    >
                      {op.type}
                    </span>
                  </div>
                  <div className="text-[11px] text-atx-ink/60 mb-1">{op.mechanic}</div>
                  <div className="text-[11px] text-atx-ink/60 leading-[1.55] whitespace-pre-wrap">{op.reason}</div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <div className="text-[13px] font-bold text-atx-mesquite font-atx-mono">${op.lo}–${op.hi}</div>
                  <div className="text-[10px] text-atx-ink/60 mt-0.5 font-atx-mono">est. / yr</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-12 text-atx-ink/60 text-[13px]">
          Could not load data. The API may be indexing your wallet.
        </div>
      )}
    </>
  )
}
