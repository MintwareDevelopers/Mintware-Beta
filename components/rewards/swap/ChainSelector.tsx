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
        className="inline-flex items-center gap-[6px] px-[12px] py-[6px] rounded-sm bg-[rgba(26,26,46,0.05)] border border-[rgba(26,26,46,0.10)] font-sans text-[13px] font-medium text-[#1A1A2E] cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-[rgba(26,26,46,0.09)] hover:border-[rgba(26,26,46,0.18)] disabled:opacity-50 disabled:cursor-not-allowed"
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
        <span className="text-[10px] text-mw-ink-4 ml-[2px]">▾</span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[500] bg-white border border-[rgba(26,26,46,0.10)] rounded-[10px] shadow-[0_8px_30px_rgba(26,26,46,0.12)] overflow-hidden min-w-[160px]">
          {SUPPORTED_CHAINS.map(cfg => (
            <div
              key={cfg.chain.id}
              className={`flex items-center gap-[8px] px-[14px] py-[10px] font-sans text-[13px] font-medium text-[#1A1A2E] cursor-pointer transition-colors duration-100 hover:bg-[rgba(0,82,255,0.06)]${cfg.chain.id === chainId ? ' text-mw-brand bg-[rgba(0,82,255,0.06)]' : ''}`}
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
                <span className="ml-auto text-mw-brand text-[11px]">✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
