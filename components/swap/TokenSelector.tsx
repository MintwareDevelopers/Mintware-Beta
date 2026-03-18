'use client'

// =============================================================================
// components/swap/TokenSelector.tsx
//
// Full-overlay bottom-sheet modal for token selection.
// Receives tokens from parent (fetched via @lifi/sdk getTokens).
// Filters by symbol / name / address; shows up to 150 results.
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import type { Token } from '@lifi/sdk'

// Minimal shape required for display/comparison — compatible with both
// the @lifi/sdk Token and the local config/tokens Token.
type MinToken = Pick<Token, 'address' | 'symbol' | 'name'> & { logoURI?: string }

interface TokenSelectorProps {
  tokens?: Token[]
  selected: MinToken | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelect: (token: any) => void
  onClose: () => void
  chainName?: string
  /** @deprecated — accepted for backward compatibility, unused */
  excludeAddress?: string
  /** @deprecated — accepted for backward compatibility, unused */
  balances?: Record<string, string>
}

// Fallback icon rendered as a colored circle when logoURI is absent/broken
function FallbackIcon({ symbol }: { symbol: string }) {
  const palette = ['#3A5CE8', '#2A9E8A', '#C27A00', '#7B6FCC', '#C2537A']
  const color   = palette[symbol.charCodeAt(0) % palette.length]
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700,
      color: '#fff', flexShrink: 0,
    }}>
      {symbol[0]}
    </div>
  )
}

function TokenIcon({ token }: { token: MinToken }) {
  const [err, setErr] = useState(false)
  if (err || !token.logoURI) return <FallbackIcon symbol={token.symbol} />
  return (
    <img
      src={token.logoURI}
      alt={token.symbol}
      width={32} height={32}
      style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      onError={() => setErr(true)}
    />
  )
}

export function TokenSelector({ tokens = [], selected, onSelect, onClose, chainName = '' }: TokenSelectorProps) {
  const [query, setQuery]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus search input
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  // Escape key closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const q        = query.trim().toLowerCase()
  const filtered = q
    ? tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q)   ||
          t.address.toLowerCase() === q
      )
    : tokens

  return (
    <>
      <style>{`
        .ts-overlay {
          position: fixed;
          inset: 0;
          background: rgba(26, 26, 46, 0.48);
          z-index: 9999;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: ts-fade 0.15s ease;
        }
        @keyframes ts-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ts-sheet {
          background: #fff;
          border-radius: 20px 20px 0 0;
          width: 100%;
          max-width: 480px;
          max-height: 76vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 -4px 40px rgba(58,92,232,0.14);
          animation: ts-up 0.22s ease;
          overflow: hidden;
        }
        @keyframes ts-up {
          from { transform: translateY(40px); opacity: 0.5; }
          to   { transform: translateY(0);    opacity: 1;   }
        }
        .ts-header {
          padding: 16px 16px 10px;
          border-bottom: 1px solid #F0EFFF;
          flex-shrink: 0;
        }
        .ts-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .ts-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px;
          font-weight: 700;
          color: #1A1A2E;
        }
        .ts-chain-badge {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          font-weight: 700;
          background: #EEF1FF;
          color: #3A5CE8;
          border-radius: 4px;
          padding: 2px 6px;
        }
        .ts-close {
          background: none;
          border: none;
          cursor: pointer;
          color: #8A8C9E;
          font-size: 22px;
          line-height: 1;
          padding: 0 4px;
          transition: color 0.15s;
        }
        .ts-close:hover { color: #1A1A2E; }
        .ts-search-wrap { position: relative; }
        .ts-search {
          width: 100%;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px;
          border: 1.5px solid #E0DFFF;
          border-radius: 10px;
          padding: 8px 10px 8px 32px;
          outline: none;
          color: #1A1A2E;
          background: #F7F6FF;
          box-sizing: border-box;
          transition: border-color 0.15s, background 0.15s;
        }
        .ts-search:focus { border-color: #3A5CE8; background: #fff; }
        .ts-search::placeholder { color: #8A8C9E; }
        .ts-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: #8A8C9E;
          font-size: 14px;
          pointer-events: none;
        }
        .ts-list {
          overflow-y: auto;
          flex: 1;
          padding: 4px 0 8px;
        }
        .ts-token-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          cursor: pointer;
          transition: background 0.1s;
        }
        .ts-token-row:hover   { background: #F7F6FF; }
        .ts-token-row.sel     { background: #EEF1FF; }
        .ts-token-info        { flex: 1; min-width: 0; }
        .ts-symbol {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          color: #1A1A2E;
        }
        .ts-name {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          color: #8A8C9E;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ts-check { font-size: 16px; color: #3A5CE8; flex-shrink: 0; }
        .ts-empty {
          padding: 36px 16px;
          text-align: center;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px;
          color: #8A8C9E;
        }
      `}</style>

      {/* Backdrop — click to dismiss */}
      <div className="ts-overlay" onClick={onClose}>
        {/* Sheet — stop propagation */}
        <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>

          <div className="ts-header">
            <div className="ts-title-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="ts-title">Select token</span>
                <span className="ts-chain-badge">{chainName}</span>
              </div>
              <button className="ts-close" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="ts-search-wrap">
              <span className="ts-search-icon">⌕</span>
              <input
                ref={inputRef}
                className="ts-search"
                type="text"
                placeholder="Search by name, symbol, or address…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="ts-list">
            {filtered.length === 0 ? (
              <div className="ts-empty">No tokens match "{query}"</div>
            ) : (
              filtered.slice(0, 150).map((token) => {
                const isSel = selected?.address?.toLowerCase() === token.address?.toLowerCase()
                return (
                  <div
                    key={token.address}
                    className={`ts-token-row${isSel ? ' sel' : ''}`}
                    onClick={() => { onSelect(token); onClose() }}
                  >
                    <TokenIcon token={token} />
                    <div className="ts-token-info">
                      <div className="ts-symbol">{token.symbol}</div>
                      <div className="ts-name">{token.name}</div>
                    </div>
                    {isSel && <span className="ts-check">✓</span>}
                  </div>
                )
              })
            )}
          </div>

        </div>
      </div>
    </>
  )
}
