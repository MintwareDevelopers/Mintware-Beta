'use client'

import { useState, useMemo } from 'react'
import { useChainId } from 'wagmi'
import { useTokenList } from '@/hooks/useTokenList'
import { COMMON_TOKENS } from '@/config/tokens'
import type { Token } from '@/config/tokens'

interface TokenSelectorProps {
  selected: Token | null
  onSelect: (token: Token) => void
  excludeAddress?: string
  balances?: Record<string, string>
  onClose: () => void
}

export function TokenSelector({
  selected,
  onSelect,
  excludeAddress,
  balances = {},
  onClose,
}: TokenSelectorProps) {
  const chainId = useChainId()
  const { tokens, isLoading } = useTokenList(chainId)
  const [search, setSearch] = useState('')

  const commonSymbols = COMMON_TOKENS[chainId] ?? []
  const commonTokens = useMemo(
    () => tokens.filter(t => commonSymbols.includes(t.symbol) && t.address !== excludeAddress),
    [tokens, commonSymbols, excludeAddress]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return tokens.filter(t => t.address !== excludeAddress)
    return tokens.filter(
      t =>
        t.address !== excludeAddress &&
        (t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q))
    )
  }, [tokens, search, excludeAddress])

  return (
    <>
      <style>{`
        .mw-token-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(26,26,46,0.35);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .mw-token-modal {
          background: #fff;
          border-radius: 16px;
          width: 100%; max-width: 420px;
          max-height: 80vh;
          display: flex; flex-direction: column;
          box-shadow: 0 20px 60px rgba(26,26,46,0.18);
          overflow: hidden;
        }
        .mw-token-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 20px 0;
        }
        .mw-token-header h3 {
          font-family: Georgia, serif;
          font-size: 17px; font-weight: 700; color: #1A1A2E;
        }
        .mw-token-close {
          background: none; border: none;
          font-size: 20px; color: #8A8C9E; cursor: pointer; padding: 4px 8px;
          border-radius: 6px; transition: background 0.1s;
        }
        .mw-token-close:hover { background: rgba(26,26,46,0.06); color: #1A1A2E; }
        .mw-token-search {
          margin: 14px 20px 12px;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid rgba(26,26,46,0.12);
          background: rgba(26,26,46,0.03);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; color: #1A1A2E;
          outline: none; width: calc(100% - 40px);
          transition: border-color 0.15s;
        }
        .mw-token-search:focus { border-color: rgba(0,82,255,0.4); }
        .mw-token-search::placeholder { color: #8A8C9E; }
        .mw-common-label {
          padding: 0 20px 8px;
          font-size: 11px; font-weight: 600; color: #8A8C9E;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .mw-common-pills {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 0 20px 14px;
        }
        .mw-common-pill {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px;
          border-radius: 8px;
          border: 1px solid rgba(26,26,46,0.10);
          background: rgba(26,26,46,0.03);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 500; color: #1A1A2E;
          cursor: pointer; transition: all 0.12s;
        }
        .mw-common-pill:hover { background: rgba(0,82,255,0.07); border-color: rgba(0,82,255,0.2); color: #0052FF; }
        .mw-common-pill.selected { background: rgba(0,82,255,0.09); border-color: rgba(0,82,255,0.25); color: #0052FF; }
        .mw-token-divider { height: 1px; background: rgba(26,26,46,0.07); margin: 0 0 4px; }
        .mw-token-list {
          overflow-y: auto; flex: 1;
          padding: 4px 0 8px;
        }
        .mw-token-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 20px;
          cursor: pointer; transition: background 0.1s;
        }
        .mw-token-row:hover { background: rgba(0,82,255,0.04); }
        .mw-token-row.selected { background: rgba(0,82,255,0.06); }
        .mw-token-icon {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #e2e8f0, #cbd5e1);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; color: #64748b;
          flex-shrink: 0; overflow: hidden;
        }
        .mw-token-icon img { width: 100%; height: 100%; object-fit: cover; }
        .mw-token-info { flex: 1; min-width: 0; }
        .mw-token-symbol { font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 600; color: #1A1A2E; }
        .mw-token-name { font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; font-size: 12px; color: #8A8C9E; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mw-token-balance { font-family: var(--font-mono), 'DM Mono', monospace; font-size: 12px; color: #8A8C9E; }
        .mw-token-loading { display: flex; align-items: center; justify-content: center; padding: 40px; color: #8A8C9E; font-size: 14px; }
        .mw-token-empty { display: flex; align-items: center; justify-content: center; padding: 40px; color: #8A8C9E; font-size: 14px; }
      `}</style>

      <div className="mw-token-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="mw-token-modal">
          <div className="mw-token-header">
            <h3>Select a token</h3>
            <button className="mw-token-close" onClick={onClose}>✕</button>
          </div>

          <input
            className="mw-token-search"
            placeholder="Search name or paste address"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />

          {commonTokens.length > 0 && !search && (
            <>
              <div className="mw-common-label">Common tokens</div>
              <div className="mw-common-pills">
                {commonTokens.map(t => (
                  <button
                    key={t.address}
                    className={`mw-common-pill${selected?.address === t.address ? ' selected' : ''}`}
                    onClick={() => { onSelect(t); onClose() }}
                  >
                    {t.logoURI && (
                      <img
                        src={t.logoURI}
                        alt={t.symbol}
                        style={{ width: 14, height: 14, borderRadius: '50%', objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    {t.symbol}
                  </button>
                ))}
              </div>
              <div className="mw-token-divider" />
            </>
          )}

          <div className="mw-token-list">
            {isLoading ? (
              <div className="mw-token-loading">Loading tokens…</div>
            ) : filtered.length === 0 ? (
              <div className="mw-token-empty">No tokens found</div>
            ) : (
              filtered.slice(0, 200).map(t => (
                <div
                  key={t.address}
                  className={`mw-token-row${selected?.address === t.address ? ' selected' : ''}`}
                  onClick={() => { onSelect(t); onClose() }}
                >
                  <div className="mw-token-icon">
                    {t.logoURI ? (
                      <img
                        src={t.logoURI}
                        alt={t.symbol}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                          ;(e.target as HTMLImageElement).parentElement!.textContent = t.symbol.slice(0, 2)
                        }}
                      />
                    ) : (
                      t.symbol.slice(0, 2)
                    )}
                  </div>
                  <div className="mw-token-info">
                    <div className="mw-token-symbol">{t.symbol}</div>
                    <div className="mw-token-name">{t.name}</div>
                  </div>
                  {balances[t.address] && (
                    <span className="mw-token-balance">{balances[t.address]}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}
