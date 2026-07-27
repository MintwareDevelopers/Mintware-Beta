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
    <div className="relative inline-block">
      <button
        className="inline-flex items-center gap-[6px] px-[12px] py-[6px] bg-atx-bone border border-atx-ink/30 font-atx-mono text-[12px] font-medium text-atx-ink cursor-pointer transition-colors duration-150 whitespace-nowrap uppercase tracking-[0.04em] hover:border-atx-ink disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isPending}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      >
        <img
          src={current.logoUrl}
          alt={current.name}
          className="w-[18px] h-[18px] rounded-full object-cover bg-[#e2e8f0] shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {isPending ? 'Switching…' : current.name}
        <span className="text-[10px] text-atx-ink/45 ml-[2px]">▾</span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[500] bg-atx-panel border border-atx-ink shadow-[4px_4px_0_0_rgba(17,17,17,0.12)] overflow-hidden min-w-[160px]">
          {SUPPORTED_CHAINS.map(cfg => (
            <div
              key={cfg.chain.id}
              className={`flex items-center gap-[8px] px-[14px] py-[10px] font-atx-mono text-[13px] font-medium text-atx-ink cursor-pointer transition-colors duration-100 border-b border-atx-ink/10 last:border-b-0 hover:bg-atx-bone${cfg.chain.id === chainId ? ' text-atx-blue bg-atx-bone' : ''}`}
              tabIndex={0}
              onMouseDown={() => {
                if (cfg.chain.id !== chainId) switchChain({ chainId: cfg.chain.id })
                setOpen(false)
              }}
            >
              <img
                src={cfg.logoUrl}
                alt={cfg.name}
                className="w-[20px] h-[20px] rounded-full object-cover bg-[#e2e8f0] shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              {cfg.name}
              {cfg.chain.id === chainId && (
                <span className="ml-auto w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
