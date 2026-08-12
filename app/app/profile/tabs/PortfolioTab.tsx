'use client'

import { fmtUSD, iconColor } from '@/lib/web2/api'
import type { ScoreResponse } from '../types'

interface Props {
  data: ScoreResponse | null
  loading: boolean
  hasWallet: boolean
}

// Common tokens shown even at zero balance so the holdings grid always looks
// populated (DeBank-style). Real holdings (data.projects) render above these;
// these fill the rest so the profile never looks empty. Zero balances are
// clearly labelled — nothing fabricated.
const COMMON_TOKENS: { symbol: string; name: string; cat: string }[] = [
  { symbol: 'ETH',   name: 'Ethereum',     cat: 'Token' },
  { symbol: 'USDC',  name: 'USD Coin',     cat: 'Stable' },
  { symbol: 'USDT',  name: 'Tether',       cat: 'Stable' },
  { symbol: 'WBTC',  name: 'Wrapped BTC',  cat: 'Token' },
  { symbol: 'DAI',   name: 'Dai',          cat: 'Stable' },
  { symbol: 'WETH',  name: 'Wrapped ETH',  cat: 'Token' },
  { symbol: 'ARB',   name: 'Arbitrum',     cat: 'Token' },
  { symbol: 'cbETH', name: 'Coinbase ETH', cat: 'LST' },
]

type Row = {
  name: string
  symbol?: string
  cat: string
  deployed: number
  pnlPct: number
  stillActive: boolean
  held: boolean
}

export function PortfolioTab({ data, loading, hasWallet }: Props) {
  return (
    <>
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-atx-panel border border-atx-ink/25 h-[64px] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Holdings — always populated (real first, then common tokens at 0) ──── */}
      {!loading && data && (() => {
        const held: Row[] = (data.projects ?? []).map(p => ({
          name: p.name, symbol: p.symbol, cat: p.cat,
          deployed: p.deployed, pnlPct: p.pnlPct, stillActive: p.stillActive, held: true,
        }))
        const heldSyms = new Set(held.map(p => (p.symbol || p.name).toUpperCase()))
        const filler: Row[] = COMMON_TOKENS
          .filter(t => !heldSyms.has(t.symbol.toUpperCase()))
          .map(t => ({ name: t.name, symbol: t.symbol, cat: t.cat, deployed: 0, pnlPct: 0, stillActive: false, held: false }))
        const rows: Row[] = [...held.slice().sort((a, b) => b.deployed - a.deployed), ...filler]
        const total = held.reduce((s, p) => s + p.deployed, 0)
        const maxDeployed = held[0]?.deployed || 1

        return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="font-atx-mono uppercase tracking-[0.08em] text-[11px] text-atx-ink/55">
                On-chain assets
              </span>
              <span className="text-[11px] font-bold font-atx-mono text-atx-ink">{fmtUSD(total)} total</span>
            </div>

            <div className="bg-atx-panel border border-atx-ink overflow-hidden">
              {rows.map((p, i) => {
                const ic = iconColor(p.symbol || p.name)
                const barPct = p.held ? Math.round((p.deployed / maxDeployed) * 100) : 0
                return (
                  <div
                    key={`${p.symbol ?? p.name}-${i}`}
                    className={`flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-atx-bone ${p.held ? '' : 'opacity-[0.55]'}`}
                    style={{ borderBottom: i < rows.length - 1 ? '1px solid rgba(17,17,17,0.15)' : undefined }}
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
                      {p.held ? (
                        <>
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
                        </>
                      ) : (
                        <>
                          <div className="text-[13px] font-bold font-atx-mono text-atx-ink/45">—</div>
                          <div className="text-[10px] text-atx-ink/40 mt-[1px] font-atx-mono">0 balance</div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {held.length === 0 && (
              <div className="text-[11px] text-atx-ink/50 mt-2.5 font-atx-mono leading-[1.55]">
                Common tokens shown · your balances populate here as your wallet transacts on-chain.
              </div>
            )}
          </div>
        )
      })()}

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
          {hasWallet
            ? 'Could not load data. The API may be indexing your wallet.'
            : 'Connect your wallet to see your Attribution score.'}
        </div>
      )}
    </>
  )
}
