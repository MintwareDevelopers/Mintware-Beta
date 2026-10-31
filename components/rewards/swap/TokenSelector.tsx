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
    <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center font-geist-mono text-[13px] font-semibold shrink-0" style={{ background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', color: '#2E2BA8', boxShadow: 'inset 0 1px 0 #fff' }}>
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
      className="fixed inset-0 bg-[rgba(21,21,29,.32)] backdrop-blur-[3px] z-[9999] flex items-end justify-center animate-[ts-fade_0.15s_ease] font-geist"
      onClick={onClose}
    >
      <div
        className="mw-raise-lg rounded-t-[26px] w-full max-w-[480px] max-h-[76vh] flex flex-col animate-[ts-up_0.22s_ease] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[18px] pt-[18px] pb-[12px] shrink-0" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <div className="flex items-center justify-between mb-[12px]">
            <div className="flex items-center gap-[8px]">
              <span className="text-[17px] font-semibold text-ink tracking-[-0.02em]">Select token</span>
              <span className="text-[12px] font-semibold rounded-full px-2.5 py-[3px]" style={{ background: 'var(--mw-band)', color: 'var(--mw-peri-deep)' }}>
                {chainName}
              </span>
            </div>
            <button
              className="mw-btn-quiet !w-9 !h-9 !min-h-0 !px-0 text-[18px] leading-none !text-ink-mid"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg></span>
            <input
              ref={inputRef}
              aria-label="Search tokens"
              className="w-full text-[14px] rounded-[12px] border-0 min-h-[44px] pr-[12px] pl-[38px] outline-none text-ink box-border placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
              style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}
              type="text"
              placeholder="Search by name, symbol, or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 pt-[4px] pb-[8px]">
          {filtered.length === 0 ? (
            <div className="px-[16px] py-[36px] text-center text-[14px] text-ink-soft">
              No tokens match &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.slice(0, 150).map((token) => {
              const isSel = selected?.address?.toLowerCase() === token.address?.toLowerCase()
              return (
                <div
                  key={token.address}
                  className="flex items-center gap-[12px] mx-[8px] px-[10px] py-[9px] rounded-[12px] cursor-pointer transition-colors duration-100 hover:bg-[#F6F6FA]"
                  style={isSel ? { background: 'var(--mw-band)' } : undefined}
                  onClick={() => { onSelect(token); onClose() }}
                >
                  <TokenIcon token={token} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-ink">{token.symbol}</div>
                    <div className="text-[12.5px] text-ink-soft whitespace-nowrap overflow-hidden text-ellipsis">{token.name}</div>
                  </div>
                  {isSel && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mw-peri-deep)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Selected" className="shrink-0"><path d="m5 12 4 4 10-10" /></svg>}
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}
