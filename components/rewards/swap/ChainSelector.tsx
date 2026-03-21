'use client'

import { useState } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAINS } from '@/config/chains'

export function ChainSelector() {
  const chainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)

  const current = SUPPORTED_CHAINS.find(c => c.chain.id === chainId) ?? SUPPORTED_CHAINS[0]

  return (
    <>
      <style>{`
        .mw-chain-selector { position: relative; display: inline-block; }
        .mw-chain-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 8px;
          background: rgba(26,26,46,0.05);
          border: 1px solid rgba(26,26,46,0.10);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 500; color: #1A1A2E;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .mw-chain-btn:hover { background: rgba(26,26,46,0.09); border-color: rgba(26,26,46,0.18); }
        .mw-chain-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mw-chain-logo { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; background: #e2e8f0; flex-shrink: 0; }
        .mw-chain-chevron { font-size: 10px; color: #8A8C9E; margin-left: 2px; }
        .mw-chain-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0;
          z-index: 500;
          background: #fff;
          border: 1px solid rgba(26,26,46,0.10);
          border-radius: 10px;
          box-shadow: 0 8px 30px rgba(26,26,46,0.12);
          overflow: hidden;
          min-width: 160px;
        }
        .mw-chain-option {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 500; color: #1A1A2E;
          cursor: pointer; transition: background 0.1s;
        }
        .mw-chain-option:hover { background: rgba(0,82,255,0.06); }
        .mw-chain-option.mw-chain-active { color: #0052FF; background: rgba(0,82,255,0.06); }
        .mw-chain-option-logo { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: #e2e8f0; flex-shrink: 0; }
      `}</style>

      <div className="mw-chain-selector">
        <button
          className="mw-chain-btn"
          disabled={isPending}
          onClick={() => setOpen(o => !o)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        >
          <img
            src={current.logoUrl}
            alt={current.name}
            className="mw-chain-logo"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          {isPending ? 'Switching…' : current.name}
          <span className="mw-chain-chevron">▾</span>
        </button>

        {open && (
          <div className="mw-chain-dropdown">
            {SUPPORTED_CHAINS.map(cfg => (
              <div
                key={cfg.chain.id}
                className={`mw-chain-option${cfg.chain.id === chainId ? ' mw-chain-active' : ''}`}
                tabIndex={0}
                onMouseDown={() => {
                  if (cfg.chain.id !== chainId) switchChain({ chainId: cfg.chain.id })
                  setOpen(false)
                }}
              >
                <img
                  src={cfg.logoUrl}
                  alt={cfg.name}
                  className="mw-chain-option-logo"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                {cfg.name}
                {cfg.chain.id === chainId && (
                  <span style={{ marginLeft: 'auto', color: '#0052FF', fontSize: 11 }}>✓</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
