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
  // MinToken (not the strict @lifi/sdk Token) so both the LI.FI token list and
  // the local config/tokens list are accepted — the selector only reads
  // address / symbol / name / logoURI.
  tokens?: MinToken[]
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

// Fallback icon rendered as a square chip when logoURI is absent/broken
function FallbackIcon({ symbol }: { symbol: string }) {
  return (
    <div className="w-[32px] h-[32px] rounded-full bg-peri flex items-center justify-center font-mono text-[13px] font-semibold text-white shrink-0">
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
      width={32}
      height={32}
      className="rounded-full object-cover shrink-0"
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
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[9999] flex items-end justify-center animate-[ts-fade_0.15s_ease]"
      onClick={onClose}
    >
      <div
        className="bg-white border border-hair rounded-t-[var(--radius-panel)] w-full max-w-[480px] max-h-[76vh] flex flex-col shadow-lift animate-[ts-up_0.22s_ease] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[16px] pt-[16px] pb-[10px] border-b border-hair-soft shrink-0">
          <div className="flex items-center justify-between mb-[12px]">
            <div className="flex items-center gap-[8px]">
              <span className="font-atx-display text-[15px] font-medium text-ink">Select token</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] rounded-full bg-[rgba(108,108,240,0.1)] border border-[rgba(108,108,240,0.28)] text-peri-deep px-2 py-[2px]">
                {chainName}
              </span>
            </div>
            <button
              className="bg-transparent border-0 cursor-pointer text-ink-soft text-[22px] leading-none px-[4px] transition-colors duration-150 hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-soft text-[14px] pointer-events-none">⌕</span>
            <input
              ref={inputRef}
              className="w-full font-mono text-[13px] rounded-full border border-hair py-[8px] pr-[10px] pl-[34px] outline-none text-ink bg-ground-cool box-border transition-[border-color,background] duration-150 placeholder:text-ink-soft focus:border-[rgba(108,108,240,0.5)] focus:bg-white"
              type="text"
              placeholder="Search by name, symbol, or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 pt-[4px] pb-[8px]">
          {filtered.length === 0 ? (
            <div className="px-[16px] py-[36px] text-center text-[13px] text-ink-soft">
              No tokens match "{query}"
            </div>
          ) : (
            filtered.slice(0, 150).map((token) => {
              const isSel = selected?.address?.toLowerCase() === token.address?.toLowerCase()
              return (
                <div
                  key={token.address}
                  className={`flex items-center gap-[10px] px-[16px] py-[8px] cursor-pointer transition-colors duration-100 hover:bg-ground-cool${isSel ? ' bg-ground-cool' : ''}`}
                  onClick={() => { onSelect(token); onClose() }}
                >
                  <TokenIcon token={token} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[13px] font-semibold text-ink">{token.symbol}</div>
                    <div className="text-[11px] text-ink-soft whitespace-nowrap overflow-hidden text-ellipsis">{token.name}</div>
                  </div>
                  {isSel && <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block shrink-0" />}
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}
