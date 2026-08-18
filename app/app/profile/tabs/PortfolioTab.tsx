'use client'

import { fmtUSD, iconColor } from '@/lib/web2/api'
import type { ScoreResponse } from '../types'

interface Props {
  data: ScoreResponse | null
  loading: boolean
  hasWallet: boolean
}

// Common tokens shown even at zero balance so the holdings grid always looks
// populated (DeBank-style). Real holdings render above; zero balances are
// clearly labelled — nothing fabricated. Design v2.
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
            <div key={n} className="rounded-2xl bg-ground-cool h-[64px] mw-shimmer" />
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
              <span className="uppercase tracking-[0.08em] text-[11px] font-semibold text-ink-soft">
                On-chain assets
              </span>
              <span className="text-[11px] font-semibold text-ink tabular-nums">{fmtUSD(total)} total</span>
            </div>

            <div className="soft-card overflow-hidden">
              {rows.map((p, i) => {
                const ic = iconColor(p.symbol || p.name)
                const barPct = p.held ? Math.round((p.deployed / maxDeployed) * 100) : 0
                return (
                  <div
                    key={`${p.symbol ?? p.name}-${i}`}
                    className={`flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-ground-cool ${p.held ? '' : 'opacity-[0.55]'} ${i < rows.length - 1 ? 'border-b border-hair-soft' : ''}`}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-semibold shrink-0 font-mono"
                      style={{ background: ic.bg, color: ic.fg }}
                    >
                      {p.symbol?.slice(0, 3) ?? p.name?.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-[3px]">
                        <span className="text-[13px] font-semibold text-ink truncate">{p.name}</span>
                        <span className="text-[10px] text-ink-soft shrink-0">{p.cat}</span>
                        {p.stillActive && (
                          <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block shrink-0" title="Active position" />
                        )}
                      </div>
                      <div className="h-[6px] rounded-full bg-ground-cool overflow-hidden relative">
                        <div
                          className="h-full bg-peri absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {p.held ? (
                        <>
                          <div className="text-[13px] font-semibold text-ink tabular-nums">{fmtUSD(p.deployed)}</div>
                          {p.pnlPct !== 0 ? (
                            <div
                              className="text-[10px] font-semibold mt-[1px] tabular-nums"
                              style={{ color: p.pnlPct >= 0 ? 'var(--color-coral2-deep)' : '#D14343' }}
                            >
                              {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                            </div>
                          ) : (
                            <div className="text-[10px] text-ink-soft mt-[1px]">deployed</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-[13px] font-semibold text-ink-soft">—</div>
                          <div className="text-[10px] text-ink-soft mt-[1px]">0 balance</div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {held.length === 0 && (
              <div className="text-[11px] text-ink-soft mt-2.5 leading-[1.55]">
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
            <span className="uppercase tracking-[0.08em] text-[11px] font-semibold text-ink-soft">
              Matched protocols
            </span>
            <span className="text-[11px] text-coral2-deep font-semibold tabular-nums">
              {fmtUSD(data.totalLo)}–{fmtUSD(data.totalHi)} / yr
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {data.uvOpportunities.map((op, i) => (
              <div
                key={i}
                className="soft-card flex items-start gap-3.5 px-[18px] py-4"
              >
                <div
                  className="w-10 h-10 rounded-xl border border-hair bg-ground-cool flex items-center justify-center text-lg shrink-0"
                  style={{ color: op.accentColor }}
                >
                  {op.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-semibold text-ink">{op.name}</span>
                    <span className="text-[10px] text-ink-soft">{op.cat}</span>
                    <span
                      className="text-[9px] font-semibold tracking-[0.08em] uppercase px-2 py-px rounded-full border border-hair"
                      style={{ color: op.typeColor }}
                    >
                      {op.type}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-mid mb-1">{op.mechanic}</div>
                  <div className="text-[11px] text-ink-mid leading-[1.55] whitespace-pre-wrap">{op.reason}</div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <div className="text-[13px] font-semibold text-coral2-deep tabular-nums">${op.lo}–${op.hi}</div>
                  <div className="text-[10px] text-ink-soft mt-0.5">est. / yr</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-12 text-ink-mid text-[13px]">
          {hasWallet
            ? 'Couldn’t load your data. The API may still be indexing your wallet.'
            : 'Connect your wallet to see your Attribution score.'}
        </div>
      )}
    </>
  )
}
